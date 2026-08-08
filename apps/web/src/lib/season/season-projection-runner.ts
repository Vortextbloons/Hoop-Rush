import type { HumanRosterBuildResult, SearchLens } from '@hoop-rush/engine';
import { newSeasonId } from './season-ids';
import { seasonArtifactUrls } from './season-assets';
import type {
  ProjectionRosterBuildRequest,
  ProjectionRosterBuildResponse,
} from './season-projection-wire';

/**
 * Season Run projection runner (projection milestone): the main-thread
 * client for the projection worker. Long roster autofill searches run
 * off-thread; the runner resolves the hashed asset references, spawns a
 * one-shot worker, and resolves the authoritative engine result. The
 * `workerUrl` override is the test seam (mirror of the season block runner).
 */

export interface ProjectionRunnerDeps {
  workerUrl?: string;
}

export interface ProjectionRosterBuildInput {
  /** Already-selected playerVersionIds (preserved verbatim). */
  locked: readonly string[];
  /** Selectable playerVersionIds (owned versions, excluding locked). */
  available: readonly string[];
  seed: string;
  lens?: SearchLens;
}

export interface ProjectionRunner {
  /** Builds (or completes) a ten-player roster through the projection
   * ranking policy. Rejects with a typed error when the projection model
   * artifact is unavailable or the worker fails. */
  buildRoster(input: ProjectionRosterBuildInput): Promise<HumanRosterBuildResult>;
}

export function createProjectionRunner(deps: ProjectionRunnerDeps = {}): ProjectionRunner {
  return {
    async buildRoster(input: ProjectionRosterBuildInput): Promise<HumanRosterBuildResult> {
      const urls = await seasonArtifactUrls();
      if (urls.modelUrl === undefined || urls.modelHash === undefined) {
        throw new Error(
          'The projection model artifact is unavailable; run `projection build --write` and refresh the manifest.',
        );
      }
      const requestId = newSeasonId('proj');
      const worker = new Worker(
        deps.workerUrl ?? new URL('../../workers/season-projection-worker.ts', import.meta.url),
        { type: 'module' },
      );
      const request: ProjectionRosterBuildRequest = {
        type: 'build-roster',
        requestId,
        catalogUrl: urls.catalogUrl,
        catalogHash: urls.catalogHash,
        modelUrl: urls.modelUrl,
        modelHash: urls.modelHash,
        eraProfileUrl: urls.profileUrl,
        eraProfileHash: urls.profileHash,
        locked: input.locked,
        available: input.available,
        seed: input.seed,
        ...(input.lens !== undefined ? { lens: input.lens } : {}),
      };
      return new Promise<HumanRosterBuildResult>((resolve, reject) => {
        const onMessage = (event: MessageEvent<ProjectionRosterBuildResponse>): void => {
          const message = event.data;
          if (message.requestId !== requestId) return;
          worker.removeEventListener('message', onMessage);
          worker.terminate();
          if (message.type === 'complete') {
            resolve(message.result);
            return;
          }
          reject(new Error(message.message));
        };
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', (event) => {
          worker.removeEventListener('message', onMessage);
          worker.terminate();
          reject(new Error(event.message || 'projection worker failed'));
        });
        worker.postMessage(request);
      });
    },
  };
}
