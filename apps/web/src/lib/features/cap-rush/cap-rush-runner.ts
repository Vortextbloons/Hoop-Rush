import {
  CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
  capRushWorkerMessageSchema,
  type CapRushLockedInputs,
  type CapRushWorkerCompleteMessage,
  type CapRushWorkerGameMessage,
  type CapRushWorkerMessage,
  type CapRushWorkerProgressMessage,
} from '@hoop-rush/data-contracts';

export interface CapRushRunnerHandlers {
  onGame: (message: CapRushWorkerGameMessage) => void | Promise<void>;
  onProgress?: (message: CapRushWorkerProgressMessage) => void;
  onError?: (message: { code: string; message: string; gameNumber: number | null }) => void;
}

export interface CapRushRunnerOptions {
  createWorker?: () => Worker;
}

interface ActiveBatch {
  requestId: string;
  worker: Worker;
  cancelled: boolean;
  queue: Promise<void>;
  handlerError: Error | null;
  resolve: (message: CapRushWorkerCompleteMessage) => void;
  reject: (error: Error) => void;
}

function defaultWorker(): Worker {
  return new Worker(new URL('../../../workers/cap-rush-worker.ts', import.meta.url), {
    type: 'module',
  });
}

function errorOf(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class CapRushRunner {
  private readonly createWorker: () => Worker;
  private active: ActiveBatch | null = null;

  constructor(options: CapRushRunnerOptions = {}) {
    this.createWorker = options.createWorker ?? defaultWorker;
  }

  get busy(): boolean {
    return this.active !== null;
  }

  cancel(): void {
    const active = this.active;
    if (active === null) return;
    active.cancelled = true;
    active.worker.postMessage({
      schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
      type: 'cap-rush-cancel',
      requestId: active.requestId,
    });
  }

  simulate(input: {
    requestId: string;
    locked: CapRushLockedInputs;
    startGame: number;
    count: number;
    handlers: CapRushRunnerHandlers;
  }): Promise<CapRushWorkerCompleteMessage> {
    if (this.active !== null) {
      return Promise.reject(new Error('a cap rush season job is already running'));
    }
    const worker = this.createWorker();
    return new Promise<CapRushWorkerCompleteMessage>((resolve, reject) => {
      const batch: ActiveBatch = {
        requestId: input.requestId,
        worker,
        cancelled: false,
        queue: Promise.resolve(),
        handlerError: null,
        resolve,
        reject,
      };
      this.active = batch;
      const finish = (message: CapRushWorkerCompleteMessage): void => {
        this.active = null;
        worker.terminate();
        resolve(message);
      };
      const fail = (error: Error): void => {
        this.active = null;
        worker.terminate();
        reject(error);
      };

      worker.onmessage = (event: MessageEvent<unknown>) => {
        const parsed = capRushWorkerMessageSchema.safeParse(event.data);
        if (!parsed.success) {
          fail(new Error('cap rush worker sent an unrecognised message'));
          return;
        }
        const message: CapRushWorkerMessage = parsed.data;
        if (message.requestId !== input.requestId) return;
        switch (message.type) {
          case 'cap-rush-game':
            batch.queue = batch.queue
              .then(() => input.handlers.onGame(message))
              .catch((error: unknown) => {
                batch.handlerError = errorOf(error);
                this.cancel();
              });
            return;
          case 'cap-rush-progress':
            input.handlers.onProgress?.(message);
            return;
          case 'cap-rush-complete':
            void batch.queue.then(() => {
              if (batch.handlerError !== null) {
                fail(batch.handlerError);
                return;
              }
              finish(message);
            });
            return;
          case 'cap-rush-error':
            input.handlers.onError?.(message);
            void batch.queue.then(() => {
              fail(new Error(`${message.code}: ${message.message}`));
            });
            return;
        }
      };
      worker.onerror = (event) => {
        fail(errorOf(event.error ?? 'cap rush worker crashed'));
      };
      worker.postMessage({
        schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
        type: 'cap-rush-simulate',
        requestId: input.requestId,
        locked: input.locked,
        startGame: input.startGame,
        count: input.count,
      });
    });
  }

  destroy(): void {
    const active = this.active;
    if (active === null) return;
    active.worker.terminate();
    this.active = null;
  }
}
