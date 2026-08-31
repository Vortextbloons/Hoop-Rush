import type { SeasonRotation } from '@hoop-rush/data-contracts';
import type {
  HumanRosterBuildResult,
  MinutePlanOptimizationResult,
  SearchLens,
} from '@hoop-rush/engine';
export const PROJECTION_WORKER_WIRE_SCHEMA_VERSION = 1 as const;
export interface ProjectionRosterBuildRequest {
  schemaVersion: typeof PROJECTION_WORKER_WIRE_SCHEMA_VERSION;
  type: 'build-roster';
  requestId: string;
  catalogUrl: string;
  catalogHash: string;
  modelUrl: string;
  modelHash: string;
  eraProfileUrl: string;
  eraProfileHash: string;
  locked: readonly string[];
  available: readonly string[];
  seed: string;
  lens?: SearchLens;
}
export interface ProjectionRotationLoadRow {
  playerVersionId: string;
  staminaRating: number;
  durability: number;
  fatigueBasisPoints: number;
  recentLoadBasisPoints: number;
}
export interface ProjectionRotationOptimizeRequest {
  schemaVersion: typeof PROJECTION_WORKER_WIRE_SCHEMA_VERSION;
  type: 'optimize-rotation';
  requestId: string;
  catalogUrl: string;
  catalogHash: string;
  modelUrl: string;
  modelHash: string;
  eraProfileUrl: string;
  eraProfileHash: string;
  roster: readonly string[];
  structure: SeasonRotation;
  load: readonly ProjectionRotationLoadRow[];
  horizon: number;
  seed: string;
}
export type ProjectionRosterBuildResponse =
  | {
      type: 'complete';
      requestId: string;
      result: HumanRosterBuildResult;
    }
  | {
      type: 'error';
      requestId: string;
      message: string;
    };
export type ProjectionRotationOptimizeResponse =
  | {
      type: 'complete';
      requestId: string;
      result: MinutePlanOptimizationResult;
    }
  | {
      type: 'error';
      requestId: string;
      message: string;
    };
export type ProjectionWorkerRequest =
  ProjectionRosterBuildRequest | ProjectionRotationOptimizeRequest;
export type ProjectionWorkerResponse =
  ProjectionRosterBuildResponse | ProjectionRotationOptimizeResponse;
