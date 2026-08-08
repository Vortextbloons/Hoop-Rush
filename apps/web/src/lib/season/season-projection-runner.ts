import { seasonRotationSchema, type SeasonRotation } from '@hoop-rush/data-contracts';
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
 * asset references, keeps one worker per runner for the session (asset
 * fetches and parses are cached inside the worker), and resolves the
 * authoritative engine result by requestId. The `workerUrl` override is the
 * test seam (mirror of the season block runner).
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
  const client = new ProjectionWorkerClient(deps);
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
      return client.request<HumanRosterBuildResult>(request);
    },

    async optimizeRotation(
      input: ProjectionRotationOptimizeInput,
    ): Promise<MinutePlanOptimizationResult> {
      const urls = await seasonArtifactUrls();
      if (urls.modelUrl === undefined || urls.modelHash === undefined) {
        throw missingModelError();
      }
      // The wire is type-only; the structure arrives from the shell's `$state`
      // rotation editor — a Svelte 5 reactive proxy `postMessage` cannot clone.
      // Rebuild from validated plain objects so the worker never sees a proxy.
      const request: ProjectionRotationOptimizeRequest = {
        type: 'optimize-rotation',
        requestId: newSeasonId('proj'),
        catalogUrl: urls.catalogUrl,
        catalogHash: urls.catalogHash,
        modelUrl: urls.modelUrl,
        modelHash: urls.modelHash,
        eraProfileUrl: urls.profileUrl,
        eraProfileHash: urls.profileHash,
        roster: [...input.roster],
        structure: seasonRotationSchema.parse(input.structure),
        load: input.load.map((row) => ({
          playerVersionId: row.playerVersionId,
          staminaRating: row.staminaRating,
          durability: row.durability,
          fatigueBasisPoints: row.fatigueBasisPoints,
          recentLoadBasisPoints: row.recentLoadBasisPoints,
        })),
        horizon: input.horizon,
        seed: input.seed,
      };
      return client.request<MinutePlanOptimizationResult>(request);
    },
  };
}

function missingModelError(): Error {
  return new Error(
    'The projection model artifact is unavailable; run `projection build --write` and refresh the manifest.',
  );
}

/**
 * One long-lived worker per runner: assets are fetched and hash-verified
 * once inside the worker, so repeated strategy clicks and autofill runs
 * skip the multi-megabyte catalog download/parse. Requests resolve by
 * requestId; a worker error rejects every in-flight request and resets the
 * worker so the next request starts fresh.
 */
class ProjectionWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<
    string,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >();

  constructor(private readonly deps: ProjectionRunnerDeps) {}

  request<Result>(request: ProjectionWorkerRequest): Promise<Result> {
    const worker = this.ensureWorker();
    return new Promise<Result>((resolve, reject) => {
      this.pending.set(request.requestId, {
        resolve: resolve as (result: unknown) => void,
        reject,
      });
      worker.postMessage(request);
    });
  }

  private ensureWorker(): Worker {
    if (this.worker !== null) return this.worker;
    // Vite bundles a worker only when `new URL(..., import.meta.url)` appears
    // literally in `new Worker`; an indirection copies the .ts as a public
    // asset that GitHub Pages serves as video/mp2t, which browsers reject.
    const worker =
      this.deps.workerUrl !== undefined
        ? new Worker(this.deps.workerUrl, { type: 'module' })
        : new Worker(new URL('../../workers/season-projection-worker.ts', import.meta.url), {
            type: 'module',
          });
    worker.addEventListener('message', (event: MessageEvent<ProjectionWorkerResponse>) => {
      const message = event.data;
      const entry = this.pending.get(message.requestId);
      if (entry === undefined) return;
      this.pending.delete(message.requestId);
      if (message.type === 'complete') {
        entry.resolve(message.result);
        return;
      }
      entry.reject(new Error(message.message));
    });
    worker.addEventListener('error', (event) => {
      const error = new Error(event.message || 'projection worker failed');
      const entries = [...this.pending.values()];
      this.pending.clear();
      worker.terminate();
      if (this.worker === worker) this.worker = null;
      for (const entry of entries) entry.reject(error);
    });
    this.worker = worker;
    return worker;
  }
}
