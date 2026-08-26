import type { SeasonLeagueGenerationResult, SeasonRosterTargets } from '@hoop-rush/data-contracts';
import type { SeasonAiGenerationInput } from '@hoop-rush/engine';
export interface GenerationWorkerRequest {
    type: 'generate';
    requestId: string;
    input: Omit<SeasonAiGenerationInput, 'targets'>;
    targets: SeasonRosterTargets;
}
export type GenerationWorkerResponse = {
    type: 'complete';
    requestId: string;
    generation: SeasonLeagueGenerationResult;
} | {
    type: 'error';
    requestId: string;
    message: string;
};
