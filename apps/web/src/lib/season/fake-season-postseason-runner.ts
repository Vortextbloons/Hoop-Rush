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
const catalogCache = new Map<string, SeasonDraftCatalog>();
const profileCache = new Map<string, EraSimulationProfile>();
export interface SeasonPostseasonEngineSimulatorOptions {
  catalog?: SeasonDraftCatalog;
  profile?: EraSimulationProfile;
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
export function createFakeSeasonPostseasonRunner(): ReturnType<
  typeof createSeasonPostseasonRunner
> {
  return createSeasonPostseasonRunner({
    simulate: createSeasonPostseasonEngineSimulator(),
  });
}
