import {
  projectionWorkerResponseSchema,
  PROJECTION_WORKER_WIRE_SCHEMA_VERSION,
  seasonRotationSchema,
  type SeasonRotation,
} from '@hoop-rush/data-contracts';
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
export interface ProjectionRunnerDeps {
  workerUrl?: string;
}
export interface ProjectionRosterBuildInput {
  locked: readonly string[];
  available: readonly string[];
  seed: string;
  lens?: SearchLens;
}
export interface ProjectionRotationOptimizeInput {
  roster: readonly string[];
  structure: SeasonRotation;
  load: readonly ProjectionRotationLoadRow[];
  horizon: number;
  seed: string;
}
export interface ProjectionRunner {
  buildRoster(input: ProjectionRosterBuildInput): Promise<HumanRosterBuildResult>;
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
        schemaVersion: PROJECTION_WORKER_WIRE_SCHEMA_VERSION,
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
      const request: ProjectionRotationOptimizeRequest = {
        schemaVersion: PROJECTION_WORKER_WIRE_SCHEMA_VERSION,
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
class ProjectionWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<
    string,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
    }
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
    const worker =
      this.deps.workerUrl !== undefined
        ? new Worker(this.deps.workerUrl, { type: 'module' })
        : new Worker(new URL('../../workers/season-projection-worker.ts', import.meta.url), {
            type: 'module',
          });
    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      const parsed = projectionWorkerResponseSchema.safeParse(event.data);
      if (!parsed.success) return;
      const message = parsed.data;
      const entry = this.pending.get(message.requestId);
      if (entry === undefined) return;
      this.pending.delete(message.requestId);
      if (message.type === 'complete') {
        entry.resolve((message as unknown as { result: unknown }).result);
        return;
      }
      entry.reject(new Error((message as unknown as { message: string }).message));
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
