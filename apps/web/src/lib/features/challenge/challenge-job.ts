import { workerMessageSchema, workerRequestSchema } from '@hoop-rush/data-contracts';
import type {
  ChallengeJobEvents,
  ChallengeJobPort,
  ChallengeJobSimulationInput,
} from '@hoop-rush/application/challenge';
import { newRequestId } from '#lib/ids.js';
import { listenForWorkerReplies, stopWorker } from '#lib/workers/worker-protocol.js';

export class ChallengeWorkerJob implements ChallengeJobPort {
  private worker: Worker | null = null;
  private requestId: string | null = null;

  startSimulation(input: ChallengeJobSimulationInput, events: ChallengeJobEvents): void {
    const worker = (this.worker ??= new Worker(
      new URL('../../../workers/challenge-worker.ts', import.meta.url),
      { type: 'module' },
    ));
    const requestId = (this.requestId ??= newRequestId());
    listenForWorkerReplies(
      worker,
      workerMessageSchema,
      requestId,
      (message) => {
        if (message.type === 'results') events.onResults(message.results);
        else if (message.type === 'error') events.onError(message.message);
      },
      () => {
        events.onError('the simulation worker returned an invalid message');
      },
      () => {
        events.onError('the simulation worker crashed');
      },
    );
    worker.postMessage(
      workerRequestSchema.parse({
        schemaVersion: 1,
        type: 'simulate',
        requestId,
        run: { ...input.run, games: [] },
        startGameNumber: input.startGameNumber,
        profile: input.profile,
        engineVersion: input.run.versions.engineVersion,
      }),
    );
  }

  cancel(): void {
    stopWorker(this.worker);
    this.worker = null;
    this.requestId = null;
  }

  dispose(): void {
    this.cancel();
  }
}
