import {
  blockIndexForRound,
  blockRoundRange,
  loadEraSimulationProfile,
  loadSeasonDraftCatalog,
  seasonWorkerMessageSchema,
  seasonWorkerRequestSchema,
  SEASON_HEALTH_VERSION,
  type SeasonBlockRunContext,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonHealthState,
  type SeasonInvalidRosterInterruption,
  type SeasonRetainedGameDetail,
  type SeasonRun,
  type SeasonWorkerCompleteMessage,
  type SeasonWorkerErrorMessage,
  type SeasonWorkerProgressMessage,
  type SeasonWorkerStartRequest,
} from '@hoop-rush/data-contracts';
import { readCachedAsset, writeCachedAsset } from '../lib/pool-cache';
import {
  assembleSeasonBlockCandidate,
  assembleSeasonPendingBlock,
  auditSeasonBlock,
  createSeasonEffectsState,
  expandSeasonRunRosters,
  rosterPlayerIdsOf,
  seasonBlockGamesOf,
  seasonBlockRejection,
  SeasonBlockInvariantError,
  simulateSeasonBlockGame,
  type SeasonBlockSimulationInput,
} from '@hoop-rush/engine';

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
 * The worker never touches the save database; it only reads the shared
 * content-addressed asset cache for the draft catalog. It yields to the
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

function post(
  message: SeasonWorkerProgressMessage | SeasonWorkerCompleteMessage | SeasonWorkerErrorMessage,
): void {
  // The pinned wire contract is enforced at its only emission point; the
  // main thread also parses every message at its boundary.
  seasonWorkerMessageSchema.parse(message);
  self.postMessage(message);
}

function postError(
  requestId: string,
  code: 'invariant-failure' | 'cancelled' | 'internal',
  message: string,
  diagnostics: { seed?: string | null; gameId?: string | null; blockIndex?: number | null } = {},
): void {
  const payload: SeasonWorkerErrorMessage = {
    schemaVersion: 4,
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The packaged draft catalog is immutable and content-addressed; a validated
 * copy in IndexedDB (shared with the main thread) spares a ~10.2 MB
 * re-download + hash verify + Zod parse on every block of a season.
 */
async function loadCatalogCached(url: string, contentHash: string): Promise<SeasonDraftCatalog> {
  const cached = await readCachedAsset<SeasonDraftCatalog>(contentHash);
  if (cached !== null) return cached;
  const catalog = await loadSeasonDraftCatalog(url, contentHash);
  void writeCachedAsset(contentHash, catalog);
  return catalog;
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
      loadEraSimulationProfile(request.profileUrl, request.profileHash),
    ]);
  } catch (error) {
    postError(request.requestId, 'internal', errorMessage(error));
    return;
  }

  // M2.5 SEAM: the candidate's expected pre-block run state facts are not
  // carried by the frozen wire; the runner includes them on the run context
  // and validates the assembled candidate against the authoritative run at
  // acceptance (mismatches are rejected, so an unavailable seam value can
  // never be committed).
  const stateFacts = request.run as SeasonBlockRunContext & {
    stateRevision?: number;
    stateDigest?: string;
  };
  const expectedStateRevision = stateFacts.stateRevision ?? 0;
  const expectedStateDigest = stateFacts.stateDigest ?? '0'.repeat(32);

  const expanded = expandSeasonRunRosters(run, catalog);
  const input: SeasonBlockSimulationInput = {
    command: {
      schemaVersion: 7,
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
    // M2.5: the pre-block health state and the locked block objective.
    health: accumulatedHealth,
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
  // per player, never before the season's first game.
  const { fromRound } = blockRoundRange(request.blockIndex);
  let previousRound = fromRound - 1;
  let effects = accumulatedEffects ?? initialEffects(expanded);
  let health = accumulatedHealth;
  let lastProgressAt = 0;
  let latestSummary: SeasonGameSummary | null = null;
  let interruption: SeasonInvalidRosterInterruption | null = null;

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
        schemaVersion: 4,
        type: 'season-block-progress',
        requestId: request.requestId,
        blockIndex: request.blockIndex,
        gamesCompleted: summaries.length,
        gamesTotal: games.length,
        latestGameId: latestSummary.gameId,
        latestResult: latestSummary,
      });
    }
  }

  // M2.5: the interruption stops the block BEFORE the candidate assembles:
  // the engine builds the uncommitted pending candidate (the accepted run
  // cursor never advances; the runner persists it and resumes later).
  if (interruption !== null) {
    const pending = assembleSeasonPendingBlock({
      run: run as unknown as SeasonRun,
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
      schemaVersion: 4,
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
  post({
    schemaVersion: 4,
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
  void runBlock(request).catch((error: unknown) => {
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
