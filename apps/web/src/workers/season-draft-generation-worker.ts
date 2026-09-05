import { SeasonAiGenerationError, generateAiLeague } from '@hoop-rush/engine';
import { generationWorkerRequestSchema } from '@hoop-rush/data-contracts';
import type {
  GenerationWorkerRequest,
  GenerationWorkerResponse,
} from '../lib/season/season-generation-wire.ts';
self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const parsed = generationWorkerRequestSchema.safeParse(event.data);
  if (!parsed.success) return;
  const request = parsed.data as unknown as GenerationWorkerRequest;
  if (
    (
      request as unknown as {
        type: string;
      }
    ).type !== 'generate'
  )
    return;
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
