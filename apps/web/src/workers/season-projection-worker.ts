import {
  buildHumanSeasonRoster,
  optimizeSeasonRotation,
  recommendSeasonRotation,
  SEARCH_LENSES,
  type SearchLens,
} from '@hoop-rush/engine';
import {
  loadEraSimulationProfile,
  loadProjectionModelArtifact,
  loadSeasonDraftCatalog,
  projectionWorkerRequestSchema,
  type ProjectionRotationOptimizeRequest as ContractOptimizeRequest,
  type ProjectionRotationRecommendRequest as ContractRecommendRequest,
  type ProjectionRosterBuildRequest as ContractBuildRequest,
  type SeasonDraftCandidate,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import type { ProjectionWorkerResponse } from '../lib/season/season-projection-wire.ts';

function candidateToSimulationPlayer(candidate: SeasonDraftCandidate): SimulationPlayer {
  return {
    playerId: candidate.playerId,
    playerVersionId: candidate.playerVersionId,
    displayName: candidate.displayName,
    positions: candidate.positions.playable,
    heightInches: candidate.heightInches,
    weightLbs: candidate.weightLbs,
    ratings: candidate.detailedRatings,
    tendencies: candidate.tendencies,
    ...(candidate.anchors !== undefined ? { anchors: candidate.anchors } : {}),
    ...(candidate.reconstructedThreePoint !== undefined
      ? { reconstructedThreePoint: candidate.reconstructedThreePoint }
      : {}),
  };
}

let cachedAssets: {
  key: string;
  catalog: Awaited<ReturnType<typeof loadSeasonDraftCatalog>>;
  model: Awaited<ReturnType<typeof loadProjectionModelArtifact>> | null;
  eraProfile: Awaited<ReturnType<typeof loadEraSimulationProfile>>;
} | null = null;

async function loadAssets(request: {
  catalogUrl: string;
  catalogHash: string;
  modelUrl: string;
  modelHash: string;
  eraProfileUrl: string;
  eraProfileHash: string;
}): Promise<
  [
    Awaited<ReturnType<typeof loadSeasonDraftCatalog>>,
    Awaited<ReturnType<typeof loadProjectionModelArtifact>>,
    Awaited<ReturnType<typeof loadEraSimulationProfile>>,
  ]
> {
  const key = [
    request.catalogUrl,
    request.catalogHash,
    request.modelUrl,
    request.modelHash,
    request.eraProfileUrl,
    request.eraProfileHash,
  ].join('|');
  if (cachedAssets !== null && cachedAssets.key === key && cachedAssets.model !== null) {
    return [cachedAssets.catalog, cachedAssets.model, cachedAssets.eraProfile];
  }
  const [catalog, model, eraProfile] = await Promise.all([
    loadSeasonDraftCatalog(request.catalogUrl, request.catalogHash),
    loadProjectionModelArtifact(request.modelUrl, request.modelHash),
    loadEraSimulationProfile(request.eraProfileUrl, request.eraProfileHash),
  ]);
  cachedAssets = { key, catalog, model, eraProfile };
  return [catalog, model, eraProfile];
}

async function loadRecommendAssets(request: {
  catalogUrl: string;
  catalogHash: string;
  modelUrl?: string;
  modelHash?: string;
  eraProfileUrl: string;
  eraProfileHash: string;
}): Promise<
  [
    Awaited<ReturnType<typeof loadSeasonDraftCatalog>>,
    Awaited<ReturnType<typeof loadProjectionModelArtifact>> | null,
    Awaited<ReturnType<typeof loadEraSimulationProfile>>,
  ]
> {
  const key = [
    request.catalogUrl,
    request.catalogHash,
    request.modelUrl ?? 'no-model',
    request.modelHash ?? 'no-model',
    request.eraProfileUrl,
    request.eraProfileHash,
  ].join('|');
  if (cachedAssets !== null && cachedAssets.key === key) {
    return [cachedAssets.catalog, cachedAssets.model, cachedAssets.eraProfile];
  }
  const catalogPromise = loadSeasonDraftCatalog(request.catalogUrl, request.catalogHash);
  const eraPromise = loadEraSimulationProfile(request.eraProfileUrl, request.eraProfileHash);
  if (request.modelUrl === undefined || request.modelHash === undefined) {
    const [catalog, eraProfile] = await Promise.all([catalogPromise, eraPromise]);
    cachedAssets = { key, catalog, model: null, eraProfile };
    return [catalog, null, eraProfile];
  }
  const [catalog, model, eraProfile] = await Promise.all([
    catalogPromise,
    loadProjectionModelArtifact(request.modelUrl, request.modelHash),
    eraPromise,
  ]);
  cachedAssets = { key, catalog, model, eraProfile };
  return [catalog, model, eraProfile];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function searchLensOf(value: unknown): SearchLens | null {
  if (typeof value !== 'string') return null;
  const lenses = SEARCH_LENSES as readonly string[];
  if (!lenses.includes(value)) return null;
  return value as SearchLens;
}

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const parsed = projectionWorkerRequestSchema.safeParse(event.data);
  if (!parsed.success) {
    return;
  }
  const request = parsed.data;
  const respond = (response: ProjectionWorkerResponse): void => {
    self.postMessage(response);
  };
  void (async () => {
    try {
      if (request.type === 'build-roster') {
        await handleBuildRoster(request, respond);
        return;
      }
      if (request.type === 'recommend-rotation') {
        await handleRecommendRotation(request, respond);
        return;
      }
      await handleOptimizeRotation(request, respond);
    } catch (error) {
      respond({
        type: 'error',
        requestId: request.requestId,
        message: errorMessage(error),
      });
    }
  })();
});

async function handleBuildRoster(
  request: ContractBuildRequest,
  respond: (response: ProjectionWorkerResponse) => void,
): Promise<void> {
  const [catalog, model, eraProfile] = await loadAssets(request);
  const lens = searchLensOf(request.lens);
  const result = buildHumanSeasonRoster({
    catalog,
    locked: request.locked,
    available: request.available,
    seed: request.seed,
    eraProfile,
    model,
    ...(lens !== null ? { lens } : {}),
  });
  respond({ type: 'complete', requestId: request.requestId, result });
}

async function handleOptimizeRotation(
  request: ContractOptimizeRequest,
  respond: (response: ProjectionWorkerResponse) => void,
): Promise<void> {
  const [catalog, model, eraProfile] = await loadAssets(request);
  const candidateByVersion = new Map(
    catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]),
  );
  const players = request.roster.map((playerVersionId) => {
    const candidate = candidateByVersion.get(playerVersionId);
    if (candidate === undefined) {
      throw new Error(`projection: catalog has no candidate ${playerVersionId}`);
    }
    return candidateToSimulationPlayer(candidate);
  });
  const load = new Map(request.load.map((row) => [row.playerVersionId, row]));
  const result = optimizeSeasonRotation({
    roster: players.map((player) => ({ player })),
    structure: request.structure,
    eraProfile,
    model,
    load,
    horizon: request.horizon,
  });
  respond({ type: 'complete', requestId: request.requestId, result });
}

async function handleRecommendRotation(
  request: ContractRecommendRequest,
  respond: (response: ProjectionWorkerResponse) => void,
): Promise<void> {
  const [catalog, model, eraProfile] = await loadRecommendAssets(request);
  const candidateByVersion = new Map(
    catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]),
  );
  const loadByVersion = new Map(request.load.map((row) => [row.playerVersionId, row]));
  const overallByVersion = new Map(
    request.overall.map((row) => [row.playerVersionId, row.overall]),
  );
  const roster = request.roster.map((playerVersionId) => {
    const candidate = candidateByVersion.get(playerVersionId);
    if (candidate === undefined) {
      throw new Error(`projection: catalog has no candidate ${playerVersionId}`);
    }
    const load = loadByVersion.get(playerVersionId);
    return {
      playerVersionId,
      playable: [...candidate.positions.playable],
      overall: overallByVersion.get(playerVersionId) ?? candidate.summaryRatings.overallRating,
      staminaRating: load?.staminaRating ?? candidate.stamina.rating,
      durability: load?.durability ?? candidate.durability.rating,
      fatigueBasisPoints: load?.fatigueBasisPoints ?? 0,
      recentLoadBasisPoints: load?.recentLoadBasisPoints ?? 0,
    };
  });
  const players =
    model === null
      ? null
      : request.roster.map((playerVersionId) => {
          const candidate = candidateByVersion.get(playerVersionId);
          if (candidate === undefined) {
            throw new Error(`projection: catalog has no candidate ${playerVersionId}`);
          }
          return candidateToSimulationPlayer(candidate);
        });
  const result = recommendSeasonRotation({
    franchiseId: request.franchiseId,
    roster,
    unavailable: [...request.unavailable],
    current: request.current,
    horizon: request.horizon,
    seed: request.seed,
    scope: request.scope,
    keepActive10: request.keepActive10,
    ...(players !== null && model !== null
      ? { projection: { players, eraProfile, model } }
      : { projection: null }),
    sharedPossessions: null,
  });
  respond({ type: 'complete', requestId: request.requestId, result });
}
