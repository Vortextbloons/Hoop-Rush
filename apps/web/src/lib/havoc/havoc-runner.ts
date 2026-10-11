import {
  HAVOC_WORKER_WIRE_SCHEMA_VERSION,
  havocWorkerMessageSchema,
  type HavocWorkerCancelRequest,
  type HavocWorkerCompleteMessage,
  type HavocWorkerErrorMessage,
  type HavocWorkerGameMessage,
  type HavocWorkerProgressMessage,
  type HavocWorkerSimulateRequest,
  type HavocWorkerTapeMessage,
  type HavocWorkerTapeRequest,
} from '@hoop-rush/data-contracts';

export interface HavocBatchHandlers {
  onGame?: (message: HavocWorkerGameMessage) => void | Promise<void>;
  onProgress?: (message: HavocWorkerProgressMessage) => void;
  onError?: (message: HavocWorkerErrorMessage) => void;
}

export interface HavocRunnerOptions {
  createWorker?: () => Worker;
  tapeTimeoutMs?: number;
}

const DEFAULT_TAPE_TIMEOUT_MS = 60_000;

interface ActiveBatch {
  requestId: string;
  worker: Worker;
  cancelled: boolean;
  queue: Promise<void>;
  handlerError: Error | null;
  onError?: (message: HavocWorkerErrorMessage) => void;
  resolve: (message: HavocWorkerCompleteMessage) => void;
  reject: (error: Error) => void;
}

interface ActiveTape {
  requestId: string;
  worker: Worker;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (message: HavocWorkerTapeMessage) => void;
  reject: (error: Error) => void;
}

export class HavocRunner {
  private batch: ActiveBatch | null = null;
  private tape: ActiveTape | null = null;

  constructor(private readonly options: HavocRunnerOptions = {}) {}

  private createWorker(): Worker {
    if (this.options.createWorker !== undefined) {
      return this.options.createWorker();
    }
    return new Worker(new URL('../../workers/havoc-worker.ts', import.meta.url), {
      type: 'module',
    });
  }

  startBatch(
    request: HavocWorkerSimulateRequest,
    handlers: HavocBatchHandlers,
  ): Promise<HavocWorkerCompleteMessage> {
    this.settleBatch(new Error('the havoc batch was superseded'));
    this.settleTape(new Error('the havoc tape run was superseded'));
    const worker = this.createWorker();
    return new Promise<HavocWorkerCompleteMessage>((resolve, reject) => {
      const active: ActiveBatch = {
        requestId: request.requestId,
        worker,
        cancelled: false,
        queue: Promise.resolve(),
        handlerError: null,
        onError: handlers.onError,
        resolve,
        reject,
      };
      this.batch = active;
      worker.onmessage = (event: MessageEvent<unknown>) => {
        this.handleBatchMessage(active, event.data, handlers);
      };
      worker.onerror = () => {
        this.failBatch(active, new Error('the havoc worker crashed'));
      };
      worker.postMessage(request);
    });
  }

  runTape(request: HavocWorkerTapeRequest): Promise<HavocWorkerTapeMessage> {
    this.settleBatch(new Error('the havoc batch was superseded'));
    this.settleTape(new Error('the havoc tape run was superseded'));
    const worker = this.createWorker();
    return new Promise<HavocWorkerTapeMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.failTape(new Error('the havoc tape worker timed out'));
      }, this.options.tapeTimeoutMs ?? DEFAULT_TAPE_TIMEOUT_MS);
      const active: ActiveTape = { requestId: request.requestId, worker, timeout, resolve, reject };
      this.tape = active;
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (this.tape !== active) return;
        const parsed = havocWorkerMessageSchema.safeParse(event.data);
        if (!parsed.success) return;
        const message = parsed.data;
        if (message.requestId !== active.requestId) return;
        if (message.type === 'havoc-tape') {
          this.finishTape(active, message);
          return;
        }
        if (message.type === 'havoc-error') {
          this.failTape(new Error(message.message));
        }
      };
      worker.onerror = () => {
        this.failTape(new Error('the havoc worker crashed'));
      };
      worker.postMessage(request);
    });
  }

  cancel(): void {
    if (this.batch !== null) {
      this.requestBatchCancel(this.batch);
    }
  }

  dispose(): void {
    this.settleBatch(new Error('the havoc runner was disposed'));
    this.settleTape(new Error('the havoc runner was disposed'));
  }

  private handleBatchMessage(
    active: ActiveBatch,
    data: unknown,
    handlers: HavocBatchHandlers,
  ): void {
    if (this.batch !== active) return;
    const parsed = havocWorkerMessageSchema.safeParse(data);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.requestId !== active.requestId) return;
    switch (message.type) {
      case 'havoc-game':
        active.queue = active.queue
          .then(async () => {
            await handlers.onGame?.(message);
          })
          .catch((error: unknown) => {
            if (active.handlerError === null) {
              active.handlerError = error instanceof Error ? error : new Error(String(error));
            }
            this.requestBatchCancel(active);
          });
        return;
      case 'havoc-progress':
        handlers.onProgress?.(message);
        return;
      case 'havoc-error':
        active.onError?.(message);
        this.failBatch(active, new Error(message.message));
        return;
      case 'havoc-complete':
        void active.queue.then(() => {
          if (this.batch !== active) return;
          if (active.handlerError !== null) {
            this.failBatch(active, active.handlerError);
            return;
          }
          this.finishBatch(active, message);
        });
        return;
      case 'havoc-tape':
        return;
    }
  }

  private requestBatchCancel(active: ActiveBatch): void {
    if (active.cancelled) return;
    active.cancelled = true;
    const cancel: HavocWorkerCancelRequest = {
      schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
      type: 'havoc-cancel',
      requestId: active.requestId,
    };
    active.worker.postMessage(cancel);
  }

  private finishBatch(active: ActiveBatch, message: HavocWorkerCompleteMessage): void {
    if (this.batch !== active) return;
    this.batch = null;
    active.worker.terminate();
    active.resolve(message);
  }

  private failBatch(active: ActiveBatch, error: Error): void {
    if (this.batch !== active) return;
    this.batch = null;
    active.worker.terminate();
    active.reject(error);
  }

  private settleBatch(error: Error): void {
    if (this.batch === null) return;
    const active = this.batch;
    this.batch = null;
    active.worker.terminate();
    active.reject(error);
  }

  private finishTape(active: ActiveTape, message: HavocWorkerTapeMessage): void {
    if (this.tape !== active) return;
    this.tape = null;
    clearTimeout(active.timeout);
    active.worker.terminate();
    active.resolve(message);
  }

  private failTape(error: Error): void {
    if (this.tape === null) return;
    const active = this.tape;
    this.tape = null;
    clearTimeout(active.timeout);
    active.worker.terminate();
    active.reject(error);
  }

  private settleTape(error: Error): void {
    if (this.tape === null) return;
    const active = this.tape;
    this.tape = null;
    clearTimeout(active.timeout);
    active.worker.terminate();
    active.reject(error);
  }
}
