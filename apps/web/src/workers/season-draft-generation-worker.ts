import { SeasonAiGenerationError, generateAiLeague } from '@hoop-rush/engine';
import {
  generationWorkerCompleteSchema,
  generationWorkerErrorSchema,
  generationWorkerProgressSchema,
  generationWorkerRequestSchema,
  seasonLeagueGenerationResultSchema,
} from '@hoop-rush/data-contracts';
self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const parsed = generationWorkerRequestSchema.safeParse(event.data);
  if (!parsed.success) {
    const rawId =
      typeof event.data === 'object' &&
      event.data !== null &&
      typeof (event.data as { requestId?: unknown }).requestId === 'string'
        ? (event.data as { requestId: string }).requestId
        : null;
    if (rawId !== null && rawId.length > 0) {
      const fallback = generationWorkerErrorSchema.safeParse({
        type: 'error',
        requestId: rawId.slice(0, 64),
        message: 'generation wire mismatch',
      });
      if (fallback.success) self.postMessage(fallback.data);
    }
    return;
  }
  const request = parsed.data;
  let lastPost = 0;
  const respondComplete = (requestId: string, generation: unknown): void => {
    const validatedGeneration = seasonLeagueGenerationResultSchema.parse(generation);
    self.postMessage(
      generationWorkerCompleteSchema.parse({
        type: 'complete',
        requestId,
        generation: validatedGeneration,
      }),
    );
  };
  try {
    const generation = generateAiLeague({
      ...request.input,
      targets: request.targets,
      onProgress: (progress) => {
        const now = Date.now();
        const isDone = progress.phase === 'done';
        if (!isDone && now - lastPost < 120) return;
        lastPost = now;
        const message = generationWorkerProgressSchema.safeParse({
          type: 'progress',
          requestId: request.requestId,
          ...progress,
        });
        if (message.success) self.postMessage(message.data);
      },
    });
    respondComplete(request.requestId, generation);
  } catch (error) {
    const message =
      error instanceof SeasonAiGenerationError
        ? `${error.message}: ${String(error.diagnostics.failedTeams.length)} failed teams, ${String(error.diagnostics.unmetConstraints.length)} unmet constraints, ${String(error.diagnostics.nodesVisited)} nodes visited`
        : error instanceof Error
          ? error.message
          : String(error);
    const payload = generationWorkerErrorSchema.safeParse({
      type: 'error',
      requestId: request.requestId,
      message: message.slice(0, 512),
    });
    if (payload.success) self.postMessage(payload.data);
  }
});
