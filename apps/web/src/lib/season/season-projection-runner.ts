import type { SeasonRotation } from '@hoop-rush/data-contracts';
import type {
  HumanRosterBuildResult,
  MinutePlanOptimizationResult,
  SearchLens,
} from '@hoop-rush/engine';
import { newSeasonId } from './season-ids';
import { seasonArtifactUrls } from './season-assets';
import type {
  ProjectionRotationLoadRow,
  ProjectionRotationOptimizeRequest,
  ProjectionRosterBuildRequest,
  ProjectionWorkerRequest,
  ProjectionWorkerResponse,
} from './season-projection-wire';

/**
 * Season Run projection runner (projection milestone): the main-thread
 * client for the projection worker. Long roster autofill searches and the
 * minute-plan optimizer run off-thread; the runner resolves the hashed
 * asset references, spawns a one-shot worker, and resolves the
 * authoritative engine result. The `workerUrl` override is the test seam
 * (mirror of the season block runner).
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

export interface ProjectionRotationOptimizeInput {
  /** Exactly the ten rostered playerVersionIds (the current ten). */
  roster: readonly string[];
  /** The current editor rotation (franchiseId/starters/benchOrder/closingFive). */
  structure: SeasonRotation;
  /** Ten load rows, one per rostered playerVersionId. */
  load: readonly ProjectionRotationLoadRow[];
  /** Upcoming-block horizon in team games (engine-clamped). */
  horizon: number;
  seed: string;
}

export interface ProjectionRunner {
  /** Builds (or completes) a ten-player roster through the projection
   * ranking policy. Rejects with a typed error when the projection model
   * artifact is unavailable or the worker fails. */
  buildRoster(input: ProjectionRosterBuildInput): Promise<HumanRosterBuildResult>;
  /** Optimizes the current rotation's target minutes under the three minute
   * policies. Rejects with a typed error when the projection model artifact
   * is unavailable or the worker fails. */
  optimizeRotation(input: ProjectionRotationOptimizeInput): Promise<MinutePlanOptimizationResult>;
}

export function createProjectionRunner(deps: ProjectionRunnerDeps = {}): ProjectionRunner {
  return {
    async buildRoster(input: ProjectionRosterBuildInput): Promise<HumanRosterBuildResult> {
      const urls = await seasonArtifactUrls();
      if (urls.modelUrl === undefined || urls.modelHash === undefined) {
        throw missingModelError();
      }
      const request: ProjectionRosterBuildRequest = {
        type: 'build-roster',
        requestId: newSeasonId('proj'),
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
      return runWorker<HumanRosterBuildResult>(deps, request);
    },

    async optimizeRotation(
      input: ProjectionRotationOptimizeInput,
    ): Promise<MinutePlanOptimizationResult> {
      const urls = await seasonArtifactUrls();
      if (urls.modelUrl === undefined || urls.modelHash === undefined) {
        throw missingModelError();
      }
      const request: ProjectionRotationOptimizeRequest = {
        type: 'optimize-rotation',
        requestId: newSeasonId('proj'),
        catalogUrl: urls.catalogUrl,
        catalogHash: urls.catalogHash,
        modelUrl: urls.modelUrl,
        modelHash: urls.modelHash,
        eraProfileUrl: urls.profileUrl,
        eraProfileHash: urls.profileHash,
        roster: input.roster,
        structure: input.structure,
        load: input.load,
        horizon: input.horizon,
        seed: input.seed,
      };
      return runWorker<MinutePlanOptimizationResult>(deps, request);
    },
  };
}

function missingModelError(): Error {
  return new Error(
    'The projection model artifact is unavailable; run `projection build --write` and refresh the manifest.',
  );
}

/** Spawns a one-shot worker for one request and resolves the matching
 * response by requestId (rejects on worker error). */
function runWorker<Result>(
  deps: ProjectionRunnerDeps,
  request: ProjectionWorkerRequest,
): Promise<Result> {
  const requestId = request.requestId;
  const worker = new Worker(
    deps.workerUrl ?? new URL('../../workers/season-projection-worker.ts', import.meta.url),
    { type: 'module' },
  );
  return new Promise<Result>((resolve, reject) => {
    const onMessage = (event: MessageEvent<ProjectionWorkerResponse>): void => {
      const message = event.data;
      if (message.requestId !== requestId) return;
      worker.removeEventListener('message', onMessage);
      worker.terminate();
      if (message.type === 'complete') {
        resolve(message.result as Result);
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
}
