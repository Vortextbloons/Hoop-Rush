import type { SeasonLeagueGenerationResult, SeasonRosterTargets } from '@hoop-rush/data-contracts';
import type { SeasonAiGenerationInput } from '@hoop-rush/engine';
export const GENERATION_WORKER_WIRE_SCHEMA_VERSION = 1 as const;
export interface GenerationWorkerRequest {
  schemaVersion: typeof GENERATION_WORKER_WIRE_SCHEMA_VERSION;
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
