import type { SeasonLeagueGenerationResult, SeasonRosterTargets } from '@hoop-rush/data-contracts';
import type { SeasonAiGenerationInput } from '@hoop-rush/engine';

/**
 * Shared message envelope for the Season Run AI league generation worker
 * (`src/workers/season-draft-generation-worker.ts`). Both the worker and the
 * main-thread draft flow import these types from here; do not re-declare
 * them on either side.
 */
export interface GenerationWorkerRequest {
  type: 'generate';
  requestId: string;
  input: Omit<SeasonAiGenerationInput, 'targets'>;
  targets: SeasonRosterTargets;
}

export type GenerationWorkerResponse =
  | {
      type: 'complete';
      requestId: string;
      generation: SeasonLeagueGenerationResult;
    }
  | {
      type: 'error';
      requestId: string;
      message: string;
    };
