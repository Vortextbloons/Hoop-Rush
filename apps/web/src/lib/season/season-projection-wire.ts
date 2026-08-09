import type { SeasonRotation } from '@hoop-rush/data-contracts';
import type {
  HumanRosterBuildResult,
  MinutePlanOptimizationResult,
  SearchLens,
} from '@hoop-rush/engine';

/**
 * Shared message envelope for the Season Run projection worker
 * (`src/workers/season-projection-worker.ts`). Both the worker and the
 * main-thread runner import these types from here; do not re-declare them
 * on either side.
 */

export interface ProjectionRosterBuildRequest {
  type: 'build-roster';
  requestId: string;
  /** Hashed asset references; the worker loads and verifies each one. */
  catalogUrl: string;
  catalogHash: string;
  modelUrl: string;
  modelHash: string;
  eraProfileUrl: string;
  eraProfileHash: string;
  /** Already-selected playerVersionIds (preserved verbatim). */
  locked: readonly string[];
  /** Selectable playerVersionIds (owned versions, excluding locked). */
  available: readonly string[];
  seed: string;
  lens?: SearchLens;
}

export interface ProjectionRotationLoadRow {
  playerVersionId: string;
  /** 45..95 stamina rating (season-stamina-v2). */
  staminaRating: number;
  /** 45..95 durability rating (durability-v1). */
  durability: number;
  /** 0..10,000 current fatigue basis points. */
  fatigueBasisPoints: number;
  /** 0..10,000 current recent-load basis points. */
  recentLoadBasisPoints: number;
}

export interface ProjectionRotationOptimizeRequest {
  type: 'optimize-rotation';
  requestId: string;
  catalogUrl: string;
  catalogHash: string;
  modelUrl: string;
  modelHash: string;
  eraProfileUrl: string;
  eraProfileHash: string;
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
