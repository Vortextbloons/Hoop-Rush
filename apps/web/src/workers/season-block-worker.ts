import {
  blockIndexForRound,
  blockRoundRange,
  loadEraSimulationProfile,
  loadSeasonDraftCatalog,
  seasonWorkerMessageSchema,
  seasonWorkerRequestSchema,
  SEASON_HEALTH_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  type EraSimulationProfile,
  type SeasonBlockRunContext,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonGamePlayerInput,
  type SeasonGameSummary,
  type SeasonHealthState,
  type SeasonHomeCourtProfile,
  type SeasonInfluenceState,
  type SeasonInvalidRosterInterruption,
  type SeasonRetainedGameDetail,
  type SeasonSchedule,
  type SeasonWorkerCompleteMessage,
  type SeasonWorkerContinueRequest,
  type SeasonWorkerErrorMessage,
  type SeasonWorkerProgressMessage,
  type SeasonWorkerStartRequest,
} from '@hoop-rush/data-contracts';
import {
  assembleSeasonBlockCandidate,
  assembleSeasonPendingBlock,
  auditSeasonBlock,
  createInitialSeasonInfluenceState,
  createSeasonEffectsState,
  expandSeasonRunRosters,
  rosterPlayerIdsOf,
  seasonBlockGamesOf,
  seasonBlockRejection,
  SeasonBlockInvariantError,
  simulateSeasonBlockGame,
  type SeasonBlockSimulationInput,
} from '@hoop-rush/engine';
import { sleep } from '../lib/sleep';

/**
 * Season Run block worker entry (spec/2.0/07 background execution, M2.3,
 * M2.5). Receives one validated block input (the run context at the
 * boundary, schedule, home-court profile, compact summaries — a full reset
 * or a per-block delta into the persistent accumulator — the effects and
 * health states, the resume game id, the locked objective, and the
 * catalog/profile asset urls it fetches and hash-verifies itself), then
 * runs the authoritative block pipeline game by game through the engine's
 * exported pieces — the same code the CLI runs through `simulateSeasonBlock`.
 *
 * The worker never touches IndexedDB or the save database; it fetches the
 * content-addressed draft catalog and era profile itself (hash-verified) and
 * memoizes them for its lifetime. It yields to the
 * event loop between games so cancellation is observed and progress
 * streams; progress posts are throttled to at most four per second and carry
 * fixed-size counters plus the latest game id and compact summary. Invariant
 * failures stop the block with seed/version/game diagnostics. The complete
 * message carries either one bounded candidate checkpoint (≤ 2 MB) for the
 * main thread to validate, accept, and persist, or — M2.5 — an uncommitted
 * pending candidate when the human franchise could not field a legal five
 * (`invalid-roster` interruption); cancelled or failed work never reaches
 * persistence.
 *
 * ## M2.5 state threading
 *
 * Health crosses the wire exactly like effects: `priorHealth` resets the
 * worker's accumulator (full reset), null keeps the accumulated state for a
 * continued worker. `startGameId` resumes mid-block from an interrupted
 * pending candidate: the worker simulates from that game forward and seeds
 * its block-scoped summary list from the summaries the accumulator already
 * holds for this blockIndex (the pending's partial summaries were shipped
 * as `newSummaries`/`priorSummaries`), so the assembled candidate covers the
 * FULL block (partial + resumed) without duplicates.
 *
 * ## M2.5 SEAMS awaiting the health workstream
 *
 * - `simulateSeasonBlockGame` threads the health state and returns either
 *   the game facts or a typed `invalid-roster` interruption marker.
 * - `assembleSeasonBlockCandidate` accepts the post-block health state.
 * - `assembleSeasonPendingBlock` builds the uncommitted pending candidate.
 * - The candidate's `expectedStateRevision`/`expectedStateDigest` (the
 *   pre-block run state facts) are not carried by the frozen wire
 *   (`seasonBlockRunContextSchema` is unchanged per the contract, so the
 *   runner's parse strips them); the worker reads them leniently from the
 *   run context (the runner includes them there), falling back to
 *   revision-aligned zero facts. The RUNNER validates the candidate's
 *   expected state facts against the authoritative submitted run and
 *   rejects mismatches, so an unavailable seam value can never be
 *   committed.
 */

const PROGRESS_MIN_INTERVAL_MS = 250;

let currentRequestId: string | null = null;
let cancelled = false;

/**
 * The worker is persistent and accumulates compact summaries across blocks
 * so the main thread only ships one block's worth of deltas. The runner
 * resets the accumulator with `priorSummaries` whenever this worker has no
 * state for the run (fresh worker or resumed after a route change) and
 * appends `newSummaries` otherwise. The engine folds standings/aggregates on
 * top of the accumulated set, so a stale accumulator would fail the
 * checkpoint audit on the main thread.
 */
let accumulatedRunId: string | null = null;
let accumulatedSummaries: SeasonGameSummary[] = [];
/** M2.4: the authoritative effects state carried across blocks in this worker. */
let accumulatedEffects: SeasonEffectsState | null = null;
/** M2.5: the authoritative health state carried across blocks in this worker. */
let accumulatedHealth: SeasonHealthState | null = null;

/**
 * Wire v5 continuation context: the run-static inputs (schedule, league,
 * rosters, home-court profile) are cached per runId so continuation blocks
 * travel as deltas. A terminated worker loses the cache and the runner falls
 * back to a full start request.
 */
interface WorkerRunContext {
  run: SeasonBlockRunContext;
  schedule: SeasonSchedule;
  homeCourt: SeasonHomeCourtProfile;
  humanFranchiseId: string | null;
}
const contextByRunId = new Map<string, WorkerRunContext>();

/** Rebuilds a full start request from a continuation + the cached run context. */
function synthesizeStart(request: SeasonWorkerContinueRequest): SeasonWorkerStartRequest | null {
  const context = contextByRunId.get(request.runId);
  if (context === undefined) return null;
  const { fromRound } = blockRoundRange(request.blockIndex);
  return {
    ...request,
    type: 'season-block-start',
    // The cached context comes from the first block handled by this
    // persistent worker. Cursor and rotations are block-boundary state, not
    // run-static state: reconstruct them from the continuation or the engine
    // will reject every later block as a stale cursor (and would simulate an
    // old rotation even when the user edited it between blocks).
    run: {
      ...context.run,
      rotations: request.rotations,
      cursor: {
        ...context.run.cursor,
        completedRounds: fromRound - 1,
      },
    },
    schedule: context.schedule,
    homeCourt: context.homeCourt,
    humanFranchiseId: context.humanFranchiseId,
  };
}

function post(
  message: SeasonWorkerProgressMessage | SeasonWorkerCompleteMessage | SeasonWorkerErrorMessage,
): void {
  // The main thread parses every message at its boundary (the runner drops
  // anything that fails the frozen wire schema), so the worker does not
  // re-parse the ≤ 2 MB complete message it just assembled.
  self.postMessage(message);
}

function postError(
  requestId: string,
  code: 'invariant-failure' | 'cancelled' | 'internal',
  message: string,
  diagnostics: { seed?: string | null; gameId?: string | null; blockIndex?: number | null } = {},
): void {
  const payload: SeasonWorkerErrorMessage = {
    schemaVersion: 5,
    type: 'season-block-error',
    requestId,
    code,
    message: message.slice(0, 512),
    seed: diagnostics.seed ?? null,
    gameId: diagnostics.gameId ?? null,
    blockIndex: diagnostics.blockIndex ?? null,
  };
  seasonWorkerMessageSchema.parse(payload);
  self.postMessage(payload);
}

/**
 * The packaged draft catalog is immutable and content-addressed; the module
 * cache makes the fetch + hash verify + Zod parse one-time per worker
 * lifetime (~1 MB brotli with precompress). The worker intentionally does not
 * bundle dexie/IndexedDB for this cache — a direct fetch keeps the worker
 * bundle self-contained.
 */
const catalogCache = new Map<string, SeasonDraftCatalog>();
async function loadCatalogCached(url: string, contentHash: string): Promise<SeasonDraftCatalog> {
  const memo = catalogCache.get(contentHash);
  if (memo !== undefined) return memo;
  const catalog = await loadSeasonDraftCatalog(url, contentHash);
  catalogCache.set(contentHash, catalog);
  return catalog;
}

/** The era profile is immutable and content-addressed; fetch + sha256 + parse once per worker. */
const profileCache = new Map<string, EraSimulationProfile>();
async function loadProfileCached(url: string, contentHash: string): Promise<EraSimulationProfile> {
  const memo = profileCache.get(contentHash);
  if (memo !== undefined) return memo;
  const profile = await loadEraSimulationProfile(url, contentHash);
  profileCache.set(contentHash, profile);
  return profile;
}

/** Trade-window rosters change mid-run, so the expansion cache keys on content. */
function rosterFingerprint(run: SeasonBlockRunContext): string {
  return run.rosters
    .map(
      (roster) =>
        `${roster.franchiseId}:${roster.players.map((player) => player.playerVersionId).join(',')}`,
    )
    .join('|');
}

/** Rosters are static between trade windows; reuse the expanded map across blocks. */
const expandedCache = new Map<string, Map<string, SeasonGamePlayerInput>>();
function expandRostersCached(
  run: SeasonBlockRunContext,
  catalog: SeasonDraftCatalog,
): Map<string, SeasonGamePlayerInput> {
  const key = rosterFingerprint(run);
  const memo = expandedCache.get(key);
  if (memo !== undefined) return memo;
  const expanded = expandSeasonRunRosters(run, catalog);
  expandedCache.set(key, expanded);
  return expanded;
}

/** Yields to the event loop so cancel messages and progress posts interleave. */
async function yieldToEventLoop(): Promise<void> {
  await sleep(0);
}

/** Observes a cancel request at a game boundary (helper keeps CFG honest). */
function throwIfCancelled(): void {
  if (cancelled) {
    throw new SeasonWorkerCancelled();
  }
}

/** M2.5: the league-wide empty health state (block 0 / fresh worker). */
function initialHealth(): SeasonHealthState {
  return {
    schemaVersion: 1,
    healthVersion: SEASON_HEALTH_VERSION,
    injuries: [],
  };
}

/** M2.5: the league-wide initial Influence state (defensive fallback). */
function initialInfluence(run: SeasonBlockRunContext): SeasonInfluenceState {
  return createInitialSeasonInfluenceState(run.league.teams.map((team) => team.franchiseId));
}

/**
 * M2.5 SEAM (health workstream): the per-game simulation outcome is either
 * the game facts (summary, retained detail, next effects, next health) or a
 * typed `invalid-roster` interruption marker. Detection is defensive so the
 * M2.4 outcome shape (no interruption field) also parses.
 */
function isInterruption(
  outcome: unknown,
): outcome is { interruption: SeasonInvalidRosterInterruption } {
  return (
    typeof outcome === 'object' &&
    outcome !== null &&
    (outcome as { interruption?: unknown }).interruption !== undefined
  );
}

async function runBlock(request: SeasonWorkerStartRequest): Promise<void> {
  const run: SeasonBlockRunContext = request.run;
  // Cache the run-static context so wire-v5 continuations can skip it.
  contextByRunId.set(request.runId, {
    run: request.run,
    schedule: request.schedule,
    homeCourt: request.homeCourt,
    humanFranchiseId: request.humanFranchiseId,
  });

  if (request.priorSummaries !== undefined) {
    accumulatedRunId = request.runId;
    accumulatedSummaries = request.priorSummaries;
  } else if (request.newSummaries !== undefined) {
    if (accumulatedRunId !== request.runId) {
      postError(
        request.requestId,
        'internal',
        'summary delta received for a run the worker has no state for',
      );
      return;
    }
    accumulatedSummaries = [...accumulatedSummaries, ...request.newSummaries];
  }
  // M2.4: the effects state follows the same reset/delta convention. A
  // full reset carries the authoritative pre-block state; the delta path
  // keeps the worker's accumulated state (the runner only sends the reset
  // when this worker has no state for the run).
  if (request.priorEffects !== undefined && request.priorEffects !== null) {
    accumulatedEffects = request.priorEffects;
  } else if (accumulatedRunId === null) {
    postError(
      request.requestId,
      'internal',
      'effects state missing for a run the worker has no state for',
    );
    return;
  }
  // M2.5: the health state follows the same convention. A resume ships the
  // pending candidate's mid-block health as a full reset; a fresh worker
  // with no priorHealth (block 0) falls back to the empty state.
  if (request.priorHealth !== undefined && request.priorHealth !== null) {
    accumulatedHealth = request.priorHealth;
  } else if (accumulatedHealth === null) {
    accumulatedHealth = initialHealth();
  }

  let catalog;
  let profile;
  try {
    [catalog, profile] = await Promise.all([
      loadCatalogCached(request.catalogUrl, request.catalogHash),
      loadProfileCached(request.profileUrl, request.profileHash),
    ]);
  } catch (error) {
    postError(request.requestId, 'internal', errorMessage(error));
    return;
  }

  // M2.5: the candidate's expected pre-block run state facts ride the wire
  // (required fields); the runner validates the assembled candidate against
  // the authoritative submitted run at acceptance, so a wrong seam value can
  // never be committed.
  const expectedStateRevision = request.expectedStateRevision;
  const expectedStateDigest = request.expectedStateDigest;

  const expanded = expandRostersCached(run, catalog);
  const input: SeasonBlockSimulationInput = {
    command: {
      schemaVersion: SEASON_RUN_SCHEMA_VERSION,
      blockVersion: run.versions.blockVersion,
      command: 'submit-season-block',
      commandId: request.commandId,
      runId: run.runId,
      expectedRevision: request.expectedRevision,
      blockIndex: request.blockIndex,
      rotationDigest: request.rotationDigest,
      objectiveId: request.objectiveId,
      expectedStateRevision,
      expectedStateDigest,
    },
    run,
    expanded,
    schedule: request.schedule,
    catalog,
    profile,
    humanFranchiseId: request.humanFranchiseId,
    rosterPlayerIds: rosterPlayerIdsOf(run),
    priorSummaries: accumulatedSummaries,
    effects: accumulatedEffects ?? initialEffects(expanded),
    // M2.5: the pre-block health state, the pre-block Influence economy, the
    // authoritative run-scoped transaction log, and the locked objective.
    health: accumulatedHealth,
    influence: request.priorInfluence ?? initialInfluence(run),
    transactions: request.priorTransactions ?? [],
    objectiveId: request.objectiveId,
  };

  const rejection = seasonBlockRejection(input);
  if (rejection !== null) {
    postError(
      request.requestId,
      'internal',
      `block submission rejected by the engine: ${rejection.code}`,
    );
    return;
  }

  const games = seasonBlockGamesOf(request.schedule, request.blockIndex);
  // M2.5: resume mid-block from an interrupted pending candidate — simulate
  // from `startGameId` forward (null = block start). The block-scoped
  // summaries already accumulated (the pending's partial summaries, shipped
  // as the reset/delta) seed the candidate so the assembled block covers
  // the FULL block without duplicates.
  let summaries: SeasonGameSummary[];
  let retainedDetails: SeasonRetainedGameDetail[];
  if (request.startGameId !== null) {
    summaries = accumulatedSummaries.filter(
      (summary) => blockIndexForRound(summary.round) === request.blockIndex,
    );
    retainedDetails = [];
  } else {
    summaries = [];
    retainedDetails = [];
  }
  const startIndex =
    request.startGameId === null
      ? 0
      : games.findIndex((game) => game.gameId === request.startGameId);
  if (startIndex < 0) {
    postError(
      request.requestId,
      'internal',
      `startGameId ${String(request.startGameId)} is not a game of block ${String(request.blockIndex)}`,
    );
    return;
  }
  const remainingGames = games.slice(startIndex);
  // M2.4 recovery cadence mirrors the CLI pipeline: one between-round tick
  // per player, never before the season's first game. M2.5 resume: the tick
  // fires only when the first resumed game crosses a round boundary, so the
  // resume cadence matches the uninterrupted path (the pending's partial
  // summaries already carried their ticks). The engine skips the tick when
  // `skipRecoveryTick` is true (no round advance).
  const { fromRound } = blockRoundRange(request.blockIndex);
  const precedingRound =
    startIndex > 0 ? (games[startIndex - 1]?.round ?? fromRound) : fromRound - 1;
  let previousRound = precedingRound;
  let effects = accumulatedEffects ?? initialEffects(expanded);
  let health = accumulatedHealth;
  let lastProgressAt = 0;
  let latestSummary: SeasonGameSummary | null = null;
  let interruption: SeasonInvalidRosterInterruption | null = null;

  // Run-constant lookup maps: pure functions of the block input, built once
  // here and threaded through every game instead of being rebuilt per game
  // by the engine's per-game fallback (mirror of the whole-block CLI path).
  const gameNumberById = new Map(
    input.schedule.games.map((game, index) => [game.gameId, index + 1]),
  );
  const rotationByFranchise = new Map(
    input.run.rotations.map((rotation) => [rotation.franchiseId, rotation]),
  );
  const rosterByFranchise = new Map(
    input.run.rosters.map((roster) => [roster.franchiseId, roster]),
  );

  for (const game of remainingGames) {
    if (cancelled) {
      throw new SeasonWorkerCancelled();
    }
    await yieldToEventLoop();
    throwIfCancelled();
    // M2.5 SEAM (health workstream): the simulation threads the health
    // state and returns either the game facts or the typed interruption.
    const outcome = simulateSeasonBlockGame(input, game, effects, health, {
      skipRecoveryTick: !(previousRound !== 0 && game.round > previousRound),
      gameNumberById,
      rotationByFranchise,
      rosterByFranchise,
    });
    if (isInterruption(outcome)) {
      interruption = outcome.interruption;
      break;
    }
    effects = outcome.effects;
    health = outcome.health;
    previousRound = game.round;
    summaries.push(outcome.summary);
    latestSummary = outcome.summary;
    if (outcome.retainedDetail !== null) retainedDetails.push(outcome.retainedDetail);

    const now = Date.now();
    const isLast = summaries.length === games.length;
    if (isLast || now - lastProgressAt >= PROGRESS_MIN_INTERVAL_MS) {
      lastProgressAt = now;
      post({
        schemaVersion: 5,
        type: 'season-block-progress',
        requestId: request.requestId,
        blockIndex: request.blockIndex,
        gamesCompleted: summaries.length,
        gamesTotal: games.length,
        latestGameId: latestSummary.gameId,
        // Wire version 5: progress carries only the rendered scoreline; the
        // full compact summary ships inside the complete message.
        latestResult: {
          gameId: latestSummary.gameId,
          homeFranchiseId: latestSummary.homeFranchiseId,
          homeScore: latestSummary.homeScore,
          awayScore: latestSummary.awayScore,
          awayFranchiseId: latestSummary.awayFranchiseId,
        },
      });
    }
  }

  // M2.5: the interruption stops the block BEFORE the candidate assembles:
  // the engine builds the uncommitted pending candidate (the accepted run
  // cursor never advances; the runner persists it and resumes later).
  if (interruption !== null) {
    const pending = assembleSeasonPendingBlock({
      run,
      commandId: request.commandId,
      blockIndex: request.blockIndex,
      expectedRevision: request.expectedRevision,
      expectedStateRevision,
      expectedStateDigest,
      objectiveId: request.objectiveId,
      nextGameId: interruption.nextGameId,
      summaries,
      retainedDetails,
      effects,
      health,
      rotationDigest: request.rotationDigest,
    });
    post({
      schemaVersion: 5,
      type: 'season-block-complete',
      requestId: request.requestId,
      result: { status: 'interrupted', pending },
    });
    return;
  }

  accumulatedEffects = effects;
  accumulatedHealth = health;
  const candidate = assembleSeasonBlockCandidate(
    input,
    summaries,
    retainedDetails,
    effects,
    health,
  );
  const auditFailures = auditSeasonBlock(candidate, input);
  if (auditFailures.length > 0) {
    throw new EngineInvariantFailure(auditFailures.join('; '));
  }
  // Keep the persistent worker's summary accumulator aligned with the
  // finalized checkpoint. `summaries` is block-scoped, while the accumulator
  // contains prior accepted blocks (and may already contain partial games
  // from an interrupted attempt). Replace this block's slice so the next
  // continuation folds standings and aggregates from every accepted game
  // exactly once.
  accumulatedSummaries = [
    ...accumulatedSummaries.filter(
      (summary) => blockIndexForRound(summary.round) !== request.blockIndex,
    ),
    ...summaries,
  ];
  post({
    schemaVersion: 5,
    type: 'season-block-complete',
    requestId: request.requestId,
    result: { status: 'committed', checkpoint: candidate },
  });
}

/** M2.4: the league-wide zero effects state from the expanded rosters. */
function initialEffects(
  expanded: ReadonlyMap<string, import('@hoop-rush/data-contracts').SeasonGamePlayerInput>,
): SeasonEffectsState {
  const staminaInputs = [...expanded.values()].map((player) => {
    if (player.stamina === undefined) {
      throw new Error(`expanded player ${player.playerVersionId} has no stamina profile`);
    }
    return player.stamina;
  });
  return createSeasonEffectsState(staminaInputs);
}

/** Worker-local cancellation signal; thrown at game boundaries. */
class SeasonWorkerCancelled extends Error {
  constructor() {
    super('season block cancelled');
    this.name = 'SeasonWorkerCancelled';
  }
}

class EngineInvariantFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineInvariantFailure';
  }
}

self.onmessage = (event: MessageEvent<unknown>): void => {
  const parsed = seasonWorkerRequestSchema.safeParse(event.data);
  if (!parsed.success) {
    return;
  }
  const request = parsed.data;
  if (request.type === 'season-block-cancel') {
    if (request.requestId === currentRequestId) {
      cancelled = true;
    }
    return;
  }
  // A new start supersedes any stale work (the main thread never starts two).
  currentRequestId = request.requestId;
  cancelled = false;
  // Wire v5 continuation: rebuild the full start request from the cached run
  // context; a worker without context rejects it and the runner re-sends the
  // full start.
  const startRequest =
    request.type === 'season-block-continue' ? synthesizeStart(request) : request;
  if (startRequest === null) {
    postError(
      request.requestId,
      'internal',
      'continuation for a run the worker has no context for',
    );
    return;
  }
  void runBlock(startRequest).catch((error: unknown) => {
    if (error instanceof SeasonWorkerCancelled) {
      postError(request.requestId, 'cancelled', 'block cancelled between games');
      return;
    }
    if (error instanceof SeasonBlockInvariantError) {
      postError(request.requestId, 'invariant-failure', error.message, {
        seed: error.diagnostics.seed ?? request.rootSeed,
        gameId: error.diagnostics.gameId ?? null,
        blockIndex: error.diagnostics.blockIndex ?? request.blockIndex,
      });
      return;
    }
    if (error instanceof EngineInvariantFailure) {
      postError(request.requestId, 'invariant-failure', error.message, {
        seed: request.rootSeed,
        blockIndex: request.blockIndex,
      });
      return;
    }
    postError(request.requestId, 'internal', errorMessage(error), {
      seed: request.rootSeed,
      blockIndex: request.blockIndex,
    });
  });
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
