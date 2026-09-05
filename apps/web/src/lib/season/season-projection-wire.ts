import { PROJECTION_WORKER_WIRE_SCHEMA_VERSION } from '@hoop-rush/data-contracts';
import type {
  ProjectionRosterBuildRequest as ContractRosterBuildRequest,
  ProjectionRotationLoadRow as ContractLoadRow,
  ProjectionRotationOptimizeRequest as ContractOptimizeRequest,
  ProjectionRotationRecommendRequest as ContractRecommendRequest,
} from '@hoop-rush/data-contracts';
import type {
  HumanRosterBuildResult,
  MinutePlanOptimizationResult,
  RecommendSeasonRotationResult,
  SearchLens,
} from '@hoop-rush/engine';

export { PROJECTION_WORKER_WIRE_SCHEMA_VERSION };
export type ProjectionRotationLoadRow = ContractLoadRow;
export type ProjectionRosterBuildRequest = Omit<ContractRosterBuildRequest, 'lens'> & {
  lens?: SearchLens;
};
export type ProjectionRotationOptimizeRequest = ContractOptimizeRequest;
export type ProjectionRotationRecommendRequest = ContractRecommendRequest;
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
export type ProjectionRotationRecommendResponse =
  | {
      type: 'complete';
      requestId: string;
      result: RecommendSeasonRotationResult;
    }
  | {
      type: 'error';
      requestId: string;
      message: string;
    };
export type ProjectionWorkerRequest =
  | ProjectionRosterBuildRequest
  | ProjectionRotationOptimizeRequest
  | ProjectionRotationRecommendRequest;
export type ProjectionWorkerResponse =
  | ProjectionRosterBuildResponse
  | ProjectionRotationOptimizeResponse
  | ProjectionRotationRecommendResponse;
