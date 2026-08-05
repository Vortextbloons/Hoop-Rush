import {
  seasonWorkerMessageSchema,
  seasonWorkerRequestSchema,
  type SeasonGameSummary,
  type SeasonRetainedGameDetail,
  type SeasonRun,
  type SeasonWorkerCompleteMessage,
  type SeasonWorkerErrorMessage,
  type SeasonWorkerProgressMessage,
  type SeasonWorkerStartRequest,
} from '@hoop-rush/data-contracts';
import { loadEraSimulationProfile, loadSeasonDraftCatalog } from '@hoop-rush/data-contracts';
import {
  assembleSeasonBlockCandidate,
  auditSeasonBlock,
  expandSeasonRunRosters,
  rosterPlayerIdsOf,
  seasonBlockGamesOf,
  seasonBlockRejection,
  SeasonBlockInvariantError,
  simulateSeasonBlockGame,
  type SeasonBlockSimulationInput,
} from '@hoop-rush/engine';

/**
 * Season Run block worker entry (spec/2.0/07 background execution, M2.3).
 * Receives one validated block input (run snapshot at the boundary, schedule,
 * home-court profile, prior summaries, and the catalog/profile asset urls it
 * fetches and hash-verifies itself), then runs the authoritative block
 * pipeline game by game through the engine's exported pieces — the same code
 * the CLI runs through `simulateSeasonBlock`.
 *
 * The worker never touches IndexedDB. It yields to the event loop between
 * games so cancellation is observed and progress streams; progress posts are
 * throttled to at most four per second and carry fixed-size counters plus
 * the latest game id and compact summary. Invariant failures stop the block
 * with seed/version/game diagnostics. The complete message carries one
 * bounded candidate checkpoint (≤ 2 MB) for the main thread to validate,
 * accept, and persist; cancelled or failed work never reaches persistence.
 */

const PROGRESS_MIN_INTERVAL_MS = 250;

let currentRequestId: string | null = null;
let cancelled = false;

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
    schemaVersion: 2,
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

async function runBlock(request: SeasonWorkerStartRequest): Promise<void> {
  const run: SeasonRun = request.run;

  let catalog;
  let profile;
  try {
    [catalog, profile] = await Promise.all([
      loadSeasonDraftCatalog(request.catalogUrl, request.catalogHash),
      loadEraSimulationProfile(request.profileUrl, request.profileHash),
    ]);
  } catch (error) {
    postError(request.requestId, 'internal', errorMessage(error));
    return;
  }

  const expanded = expandSeasonRunRosters(run, catalog);
  const input: SeasonBlockSimulationInput = {
    command: {
      schemaVersion: 4,
      blockVersion: run.versions.blockVersion,
      command: 'submit-season-block',
      commandId: request.commandId,
      runId: run.runId,
      expectedRevision: request.expectedRevision,
      blockIndex: request.blockIndex,
      rotationDigest: request.rotationDigest,
    },
    run,
    expanded,
    schedule: request.schedule,
    catalog,
    profile,
    humanFranchiseId: request.humanFranchiseId,
    rosterPlayerIds: rosterPlayerIdsOf(run),
    priorSummaries: request.priorSummaries,
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
  const summaries: SeasonGameSummary[] = [];
  const retainedDetails: SeasonRetainedGameDetail[] = [];
  let lastProgressAt = 0;
  let latestSummary: SeasonGameSummary | null = null;

  for (const game of games) {
    if (cancelled) {
      throw new SeasonWorkerCancelled();
    }
    await yieldToEventLoop();
    throwIfCancelled();
    const outcome = simulateSeasonBlockGame(input, game);
    summaries.push(outcome.summary);
    latestSummary = outcome.summary;
    if (outcome.retainedDetail !== null) retainedDetails.push(outcome.retainedDetail);

    const now = Date.now();
    const isLast = summaries.length === games.length;
    if (isLast || now - lastProgressAt >= PROGRESS_MIN_INTERVAL_MS) {
      lastProgressAt = now;
      post({
        schemaVersion: 2,
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

  const candidate = assembleSeasonBlockCandidate(input, summaries, retainedDetails);
  const auditFailures = auditSeasonBlock(candidate, input);
  if (auditFailures.length > 0) {
    throw new EngineInvariantFailure(auditFailures.join('; '));
  }
  post({
    schemaVersion: 2,
    type: 'season-block-complete',
    requestId: request.requestId,
    checkpoint: candidate,
  });
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
