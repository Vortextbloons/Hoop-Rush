import {
  loadEraSimulationProfile,
  loadSeasonDraftCatalog,
  seasonPostseasonWorkerMessageSchema,
  seasonPostseasonWorkerRequestSchema,
  type EraSimulationProfile,
  type SeasonDraftCatalog,
  type SeasonPostseasonWorkerCompleteMessage,
  type SeasonPostseasonWorkerErrorMessage,
  type SeasonPostseasonWorkerProgressMessage,
  type SeasonPostseasonWorkerStartRequest,
  type SeasonPostseasonWorkerWarmAckMessage,
} from '@hoop-rush/data-contracts';
import { SeasonPostseasonInvariantError } from '@hoop-rush/engine';
import {
  seasonPostseasonScorelineOf,
  simulateSeasonPostseasonCommand,
} from '../lib/season/season-postseason-simulation';

/**
 * Season Run postseason worker entry (spec/2.0/07, M2.6). Runs ONE engine
 * advance per start request through the authoritative command handler — the
 * same code the CLI and the main-thread runner execute — with per-game
 * granularity for the one-game-per-commit advance loop or chunk granularity
 * for the eliminated-run fast-forward (target = the Nth upcoming game,
 * N ≤ 8). Never touches IndexedDB: commits happen on the main thread through
 * the repository. The worker fetches and hash-verifies the content-addressed
 * draft catalog and era profile itself, checks cancellation at the request
 * boundary, throttles progress to at most four messages per second, and
 * returns either the accepted commit facts (post-chunk run + summaries) or
 * the typed engine rejection. Invariant failures carry seed/game diagnostics.
 *
 * Wire family: `season-postseason-*` under
 * `SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION` (sibling of the block wire,
 * which stays untouched).
 */

let currentRequestId: string | null = null;
let cancelled = false;

const catalogCache = new Map<string, SeasonDraftCatalog>();
async function loadCatalogCached(url: string, contentHash: string): Promise<SeasonDraftCatalog> {
  const memo = catalogCache.get(contentHash);
  if (memo !== undefined) return memo;
  const catalog = await loadSeasonDraftCatalog(url, contentHash);
  catalogCache.set(contentHash, catalog);
  return catalog;
}

const profileCache = new Map<string, EraSimulationProfile>();
async function loadProfileCached(url: string, contentHash: string): Promise<EraSimulationProfile> {
  const memo = profileCache.get(contentHash);
  if (memo !== undefined) return memo;
  const profile = await loadEraSimulationProfile(url, contentHash);
  profileCache.set(contentHash, profile);
  return profile;
}

function post(
  message:
    | SeasonPostseasonWorkerProgressMessage
    | SeasonPostseasonWorkerCompleteMessage
    | SeasonPostseasonWorkerErrorMessage
    | SeasonPostseasonWorkerWarmAckMessage,
): void {
  // The main thread parses every message at its boundary, so the worker
  // does not re-parse the complete message it just assembled.
  self.postMessage(message);
}

function postError(
  requestId: string,
  code: 'invariant-failure' | 'cancelled' | 'internal',
  message: string,
  diagnostics: { seed?: string | null; gameId?: string | null } = {},
): void {
  const payload: SeasonPostseasonWorkerErrorMessage = {
    schemaVersion: 1,
    type: 'season-postseason-error',
    requestId,
    code,
    message: message.slice(0, 512),
    seed: diagnostics.seed ?? null,
    gameId: diagnostics.gameId ?? null,
  };
  seasonPostseasonWorkerMessageSchema.parse(payload);
  self.postMessage(payload);
}

/** Worker-local cancellation signal; thrown at request boundaries. */
class SeasonPostseasonCancelled extends Error {
  constructor() {
    super('season postseason cancelled');
    this.name = 'SeasonPostseasonCancelled';
  }
}

/** Observes a cancel request at a request boundary (helper keeps the flow
 * analyzable for the lint's no-unnecessary-condition pass). */
function throwIfCancelled(): void {
  if (cancelled) {
    throw new SeasonPostseasonCancelled();
  }
}

async function runPostseason(request: SeasonPostseasonWorkerStartRequest): Promise<void> {
  if (cancelled) {
    throw new SeasonPostseasonCancelled();
  }
  let catalog: SeasonDraftCatalog;
  let profile: EraSimulationProfile;
  try {
    [catalog, profile] = await Promise.all([
      loadCatalogCached(request.catalogUrl, request.catalogHash),
      loadProfileCached(request.profileUrl, request.profileHash),
    ]);
  } catch (error) {
    postError(request.requestId, 'internal', `worker asset load failed: ${errorMessage(error)}`);
    return;
  }
  throwIfCancelled();
  const outcome = simulateSeasonPostseasonCommand({
    commandId: request.commandId,
    runId: request.runId,
    expectedStateRevision: request.expectedStateRevision,
    expectedStateDigest: request.expectedStateDigest,
    targetGameId: request.targetGameId,
    humanFranchiseId: request.humanFranchiseId,
    catalog,
    profile,
    run: request.run,
    effects: request.effects,
    regularSeasonSummaries: request.regularSeasonSummaries,
  });
  // A cancel observed mid-request: the uncommitted result is discarded by
  // the main-thread runner (committed chunks are retained).
  throwIfCancelled();
  if (outcome.kind === 'rejected') {
    post({
      schemaVersion: 1,
      type: 'season-postseason-complete',
      requestId: request.requestId,
      result: {
        status: 'rejected',
        commandId: outcome.commandId,
        rejection: outcome.rejection,
      },
    });
    return;
  }
  const accepted = outcome.accepted;
  const latest = accepted.summaries[accepted.summaries.length - 1];
  post({
    schemaVersion: 1,
    type: 'season-postseason-progress',
    requestId: request.requestId,
    gamesCompleted: accepted.advancedGameIds.length,
    gamesTotal: 0,
    latestGameId: latest?.gameId ?? null,
    latestResult: latest !== undefined ? seasonPostseasonScorelineOf(latest) : null,
  });
  post({
    schemaVersion: 1,
    type: 'season-postseason-complete',
    requestId: request.requestId,
    result: {
      status: 'accepted',
      stage: accepted.stage,
      advancedGameIds: accepted.advancedGameIds,
      summaries: accepted.summaries,
      run: accepted.run,
      nextDecision: accepted.nextDecision,
      nextGameId: accepted.nextGameId,
      aiNextGameId: accepted.aiNextGameId,
    },
  });
}

self.onmessage = (event: MessageEvent<unknown>): void => {
  const parsed = seasonPostseasonWorkerRequestSchema.safeParse(event.data);
  if (!parsed.success) {
    return;
  }
  const request = parsed.data;
  if (request.type === 'season-postseason-warm') {
    // Performance pass: preload and cache the packaged catalog and era
    // profile so the first start request pays no download/parse time.
    void (async () => {
      try {
        await Promise.all([
          loadCatalogCached(request.catalogUrl, request.catalogHash),
          loadProfileCached(request.profileUrl, request.profileHash),
        ]);
        post({
          schemaVersion: 1,
          type: 'season-postseason-warm-ack',
          requestId: request.requestId,
        });
      } catch (error) {
        postError(request.requestId, 'internal', `worker prewarm failed: ${errorMessage(error)}`);
      }
    })();
    return;
  }
  if (request.type === 'season-postseason-cancel') {
    if (request.requestId === currentRequestId) {
      cancelled = true;
    }
    return;
  }
  // A new start supersedes any stale work (the main thread never starts two).
  currentRequestId = request.requestId;
  cancelled = false;
  void runPostseason(request).catch((error: unknown) => {
    if (error instanceof SeasonPostseasonCancelled) {
      postError(request.requestId, 'cancelled', 'postseason run cancelled at a request boundary');
      return;
    }
    if (error instanceof SeasonPostseasonInvariantError) {
      postError(request.requestId, 'invariant-failure', error.message, {
        seed: request.rootSeed,
        gameId: request.targetGameId,
      });
      return;
    }
    postError(request.requestId, 'internal', errorMessage(error), {
      seed: request.rootSeed,
      gameId: request.targetGameId,
    });
  });
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
