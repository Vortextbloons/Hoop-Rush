import type { HumanRosterBuildResult, SearchLens } from '@hoop-rush/engine';

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
