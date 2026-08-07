import type { SeasonLeagueGenerationResult, SeasonRosterTargets } from '@hoop-rush/data-contracts';
import {
  SeasonAiGenerationError,
  generateAiLeague,
  type SeasonAiGenerationInput,
} from '@hoop-rush/engine';

/**
 * Season Run AI league generation worker (M2.3.5). Runs the bounded
 * `generateAiLeague` seam off the main thread so the draft board stays
 * responsive while up to ~660k roster-selection nodes execute.
 */

interface GenerationWorkerRequest {
  type: 'generate';
  requestId: string;
  input: Omit<SeasonAiGenerationInput, 'targets'>;
  targets: SeasonRosterTargets;
}

type GenerationWorkerResponse =
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

self.addEventListener('message', (event: MessageEvent<GenerationWorkerRequest>) => {
  // The declared envelope type narrows the union; at runtime the port may
  // carry anything, so treat the payload as nullable before guarding.
  const request = event.data as GenerationWorkerRequest | null;
  if (request?.type !== 'generate') return;

  const respond = (response: GenerationWorkerResponse): void => {
    self.postMessage(response);
  };

  try {
    const generation = generateAiLeague({
      ...request.input,
      targets: request.targets,
    });
    respond({ type: 'complete', requestId: request.requestId, generation });
  } catch (error) {
    if (error instanceof SeasonAiGenerationError) {
      const diagnostics = error.diagnostics;
      respond({
        type: 'error',
        requestId: request.requestId,
        message: `${error.message}: ${String(diagnostics.failedTeams.length)} failed teams, ${String(diagnostics.unmetConstraints.length)} unmet constraints, ${String(diagnostics.nodesVisited)} nodes visited`,
      });
      return;
    }
    respond({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
