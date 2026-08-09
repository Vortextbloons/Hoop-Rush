import { buildHumanSeasonRoster, optimizeSeasonRotation } from '@hoop-rush/engine';
import {
  loadEraSimulationProfile,
  loadProjectionModelArtifact,
  loadSeasonDraftCatalog,
  type SeasonDraftCandidate,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import type {
  ProjectionRotationOptimizeRequest,
  ProjectionRosterBuildRequest,
  ProjectionWorkerRequest,
  ProjectionWorkerResponse,
} from '../lib/season/season-projection-wire.ts';

/**
 * Season Run projection worker (projection milestone). Runs the bounded
 * human roster autofill search and the minute-plan optimizer off the main
 * thread so the draft/hub stays responsive while complete candidate rosters
 * and rotations project. Envelope types live in
 * `season-projection-wire.ts`, shared with the runner. Assets are fetched
 * and hash-verified inside the worker (mirror of the season block worker's
 * convention).
 */

/** Candidate -> possession player mapping (mirror of the engine's
 * `attachAiProjectionSummaries` mapping; `stamina`/`durability` ride on the
 * load rows, not the simulation player). */
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

/**
 * Worker-lifetime asset cache (mirror of the season block worker): the
 * hashed URLs are stable for a session, so repeat requests skip the
 * catalog/model/profile fetch, hash verify, and parse entirely.
 */
let cachedAssets: {
  key: string;
  catalog: Awaited<ReturnType<typeof loadSeasonDraftCatalog>>;
  model: Awaited<ReturnType<typeof loadProjectionModelArtifact>>;
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
  if (cachedAssets !== null && cachedAssets.key === key) {
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const SUPPORTED_REQUEST_TYPES = new Set(['build-roster', 'optimize-rotation'] as const);

self.addEventListener('message', (event: MessageEvent<ProjectionWorkerRequest>) => {
  const request = event.data as ProjectionWorkerRequest | null;
  if (request === null || !SUPPORTED_REQUEST_TYPES.has(request.type)) {
    return;
  }

  const respond = (response: ProjectionWorkerResponse): void => {
    self.postMessage(response);
  };

  void (async () => {
    try {
      if (request.type === 'build-roster') {
        await handleBuildRoster(request, respond);
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
  request: ProjectionRosterBuildRequest,
  respond: (response: ProjectionWorkerResponse) => void,
): Promise<void> {
  const [catalog, model, eraProfile] = await loadAssets(request);
  const result = buildHumanSeasonRoster({
    catalog,
    locked: request.locked,
    available: request.available,
    seed: request.seed,
    eraProfile,
    model,
    ...(request.lens !== undefined ? { lens: request.lens } : {}),
  });
  respond({ type: 'complete', requestId: request.requestId, result });
}

async function handleOptimizeRotation(
  request: ProjectionRotationOptimizeRequest,
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
