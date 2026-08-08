import { buildHumanSeasonRoster } from '@hoop-rush/engine';
import {
  loadEraSimulationProfile,
  loadProjectionModelArtifact,
  loadSeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import type {
  ProjectionRosterBuildRequest,
  ProjectionRosterBuildResponse,
} from '../lib/season/season-projection-wire.ts';

/**
 * Season Run projection worker (projection milestone). Runs the bounded
 * human roster autofill search off the main thread so the draft/hub stays
 * responsive while complete candidate rosters and rotations project. Envelope
 * types live in `season-projection-wire.ts`, shared with the runner. Assets
 * are fetched and hash-verified inside the worker (mirror of the season block
 * worker's convention).
 */

self.addEventListener('message', (event: MessageEvent<ProjectionRosterBuildRequest>) => {
  const request = event.data as ProjectionRosterBuildRequest | null;
  if (request?.type !== 'build-roster') return;

  const respond = (response: ProjectionRosterBuildResponse): void => {
    self.postMessage(response);
  };

  void (async () => {
    try {
      const [catalog, model, eraProfile] = await Promise.all([
        loadSeasonDraftCatalog(request.catalogUrl, request.catalogHash),
        loadProjectionModelArtifact(request.modelUrl, request.modelHash),
        loadEraSimulationProfile(request.eraProfileUrl, request.eraProfileHash),
      ]);
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
    } catch (error) {
      respond({
        type: 'error',
        requestId: request.requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
});
