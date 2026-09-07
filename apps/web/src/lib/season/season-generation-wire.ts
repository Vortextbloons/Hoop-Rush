import type {
  SeasonLeagueGenerationResult,
  SeasonRosterTargets,
} from '@hoop-rush/data-contracts';
import { GENERATION_WORKER_WIRE_SCHEMA_VERSION } from '@hoop-rush/data-contracts';
import type {
  SeasonAiGenerationInput,
  SeasonAiGenerationProgress,
} from '@hoop-rush/engine';
export { GENERATION_WORKER_WIRE_SCHEMA_VERSION };
export interface GenerationWorkerRequest {
  schemaVersion: typeof GENERATION_WORKER_WIRE_SCHEMA_VERSION;
  type: 'generate';
  requestId: string;
  input: Omit<SeasonAiGenerationInput, 'targets' | 'onProgress'>;
  targets: SeasonRosterTargets;
}
export interface GenerationWorkerProgressMessage extends SeasonAiGenerationProgress {
  type: 'progress';
  requestId: string;
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
    }
  | GenerationWorkerProgressMessage;
