import {
  workerMessageSchema,
  workerRequestSchema,
  type WorkerMessage,
} from '@hoop-rush/data-contracts';
import type {
  ChallengeJobAttemptInput,
  ChallengeJobEvents,
  ChallengeJobPort,
  ChallengeJobSimulationInput,
} from '@hoop-rush/application/challenge';
import { newRequestId } from '$lib/ids';

export class ChallengeWorkerJob implements ChallengeJobPort {
  private worker: Worker | null = null;
  private requestId: string | null = null;
  private events: ChallengeJobEvents | null = null;

  startAttempt(input: ChallengeJobAttemptInput, events: ChallengeJobEvents): void {
    const { worker, requestId } = this.ensureWorker(events);
    worker.postMessage(
      workerRequestSchema.parse({
        schemaVersion: 1,
        type: 'start',
        requestId,
        run: { ...input.run, games: [] },
        profile: input.profile,
        engineVersion: input.run.versions.engineVersion,
      }),
    );
  }

  startSimulation(input: ChallengeJobSimulationInput, events: ChallengeJobEvents): void {
    const { worker, requestId } = this.ensureWorker(events);
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
    const worker = this.worker;
    const requestId = this.requestId;
    this.teardownWorker();
    if (worker !== null && requestId !== null) {
      try {
        worker.postMessage(
          workerRequestSchema.parse({ schemaVersion: 1, type: 'cancel', requestId }),
        );
      } catch {}
      worker.terminate();
    }
  }

  dispose(): void {
    this.teardownWorker();
  }

  private ensureWorker(events: ChallengeJobEvents): { worker: Worker; requestId: string } {
    this.events = events;
    if (this.worker === null || this.requestId === null) {
      const worker = new Worker(new URL('../../../workers/challenge-worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker = worker;
      this.requestId = newRequestId();
      worker.onmessage = (event: MessageEvent<unknown>) => {
        this.handleMessage(event.data);
      };
      worker.onerror = () => {
        this.events?.onError('the simulation worker crashed');
      };
    }
    return { worker: this.worker, requestId: this.requestId };
  }

  private teardownWorker(): void {
    if (this.worker !== null) {
      this.worker.terminate();
      this.worker = null;
    }
    this.requestId = null;
  }

  private handleMessage(raw: unknown): void {
    const parsed = workerMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.events?.onError('the simulation worker returned an invalid message');
      return;
    }
    const envelope: WorkerMessage = parsed.data;
    if (this.requestId === null || envelope.requestId !== this.requestId) return;
    switch (envelope.type) {
      case 'results':
        this.events?.onResults(envelope.results);
        break;
      case 'start-result':
        this.events?.onStartResult(envelope.chosenRunSeed);
        break;
      case 'error':
        this.events?.onError(envelope.message);
        break;
      case 'complete':
        break;
    }
  }
}
