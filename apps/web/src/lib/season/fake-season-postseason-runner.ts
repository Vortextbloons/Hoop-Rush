import {
  loadEraSimulationProfile,
  loadSeasonDraftCatalog,
  type EraSimulationProfile,
  type SeasonDraftCatalog,
  type SeasonPostseasonWorkerCompleteMessage,
  type SeasonPostseasonWorkerErrorMessage,
  type SeasonPostseasonWorkerStartRequest,
} from '@hoop-rush/data-contracts';
import type { SeasonPostseasonGameResolver } from '@hoop-rush/engine';
import {
  seasonPostseasonScorelineOf,
  simulateSeasonPostseasonCommand,
} from '$lib/season/season-postseason-simulation';
import {
  createSeasonPostseasonRunner,
  type SeasonPostseasonSimulatorFn,
} from '$lib/season/season-postseason-runner';

/**
 * TEST-ONLY deterministic direct engine simulator (e2e seam + unit tests).
 * Runs the EXACT shared engine-advance core the real worker runs — no
 * Worker, no IndexedDB — and returns the same complete/error wire outcomes
 * the worker would post. The e2e spec sets
 * `window.__HOOP_RUSH_E2E_FAKE_POSTSEASON_RUNNER__` before navigation;
 * `getSeasonPostseasonRunner()` then returns a real `SeasonPostseasonRunner`
 * bound to this simulator, so every runner behavior (per-game commits,
 * chunking, re-reads, promotion, cancellation) is exercised without a
 * worker. Never used in production.
 *
 * The simulator consumes NO RNG of its own: the engine's seeded command
 * handler produces the identical output the real worker would produce for
 * the same request.
 */

const catalogCache = new Map<string, SeasonDraftCatalog>();
const profileCache = new Map<string, EraSimulationProfile>();

export interface SeasonPostseasonEngineSimulatorOptions {
  /** Injected packaged assets (unit tests); the e2e seam loads from URLs. */
  catalog?: SeasonDraftCatalog;
  profile?: EraSimulationProfile;
  /** Injected per-game resolver (deterministic fixtures); the engine's
   * real controller is the default. */
  resolver?: SeasonPostseasonGameResolver;
}

export function createSeasonPostseasonEngineSimulator(
  options: SeasonPostseasonEngineSimulatorOptions = {},
): SeasonPostseasonSimulatorFn {
  return async (
    request: SeasonPostseasonWorkerStartRequest,
    onProgress,
  ): Promise<SeasonPostseasonWorkerCompleteMessage | SeasonPostseasonWorkerErrorMessage> => {
    const [catalog, profile] = await Promise.all([
      options.catalog !== undefined
        ? Promise.resolve(options.catalog)
        : loadCatalogCached(request.catalogUrl, request.catalogHash),
      options.profile !== undefined
        ? Promise.resolve(options.profile)
        : loadProfileCached(request.profileUrl, request.profileHash),
    ]);
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
      resolver: options.resolver,
    });
    if (outcome.kind === 'rejected') {
      return {
        schemaVersion: 1,
        type: 'season-postseason-complete',
        requestId: request.requestId,
        result: {
          status: 'rejected',
          commandId: outcome.commandId,
          rejection: outcome.rejection,
        },
      };
    }
    const accepted = outcome.accepted;
    const latest = accepted.summaries[accepted.summaries.length - 1];
    onProgress({
      schemaVersion: 1,
      type: 'season-postseason-progress',
      requestId: request.requestId,
      gamesCompleted: accepted.advancedGameIds.length,
      gamesTotal: 0,
      latestGameId: latest?.gameId ?? null,
      latestResult: latest !== undefined ? seasonPostseasonScorelineOf(latest) : null,
    });
    return {
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
    };
  };
}

async function loadCatalogCached(url: string, contentHash: string): Promise<SeasonDraftCatalog> {
  const memo = catalogCache.get(contentHash);
  if (memo !== undefined) return memo;
  const catalog = await loadSeasonDraftCatalog(url, contentHash);
  catalogCache.set(contentHash, catalog);
  return catalog;
}

async function loadProfileCached(url: string, contentHash: string): Promise<EraSimulationProfile> {
  const memo = profileCache.get(contentHash);
  if (memo !== undefined) return memo;
  const profile = await loadEraSimulationProfile(url, contentHash);
  profileCache.set(contentHash, profile);
  return profile;
}

/** e2e seam: a full runner bound to the direct engine simulator. */
export function createFakeSeasonPostseasonRunner(): ReturnType<
  typeof createSeasonPostseasonRunner
> {
  return createSeasonPostseasonRunner({
    simulate: createSeasonPostseasonEngineSimulator(),
  });
}
