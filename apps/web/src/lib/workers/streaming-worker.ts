export interface StreamingWorkerSpec<TMessage extends { requestId: string }> {
  createWorker(): Worker;
  responseSchema: {
    safeParse(
      value: unknown,
    ): { success: true; data: TMessage } | { success: false; error: unknown };
  };
  invalidMessage: string | null;
  crashed: string;
}

export interface StreamingWorkerJob<TMessage, TComplete> {
  request: unknown;
  requestId: string;
  concurrent: { kind: 'reject' | 'supersede'; message: string };
  completeOf(message: TMessage): TComplete | null;
  errorOf(message: TMessage): Error | null;
  drainOnError: boolean;
  handle(message: TMessage, enqueue: (handler: () => void | Promise<void>) => void): void;
  cancelRequest?: unknown;
  timeout?: { ms: number; message: string };
}

interface ActiveStream {
  requestId: string;
  worker: Worker;
  queue: Promise<void>;
  handlerError: Error | null;
  cancelled: boolean;
  terminal: boolean;
  cancelRequest: unknown;
  timeout: ReturnType<typeof setTimeout> | null;
  reject(error: Error): void;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class StreamingWorkerRunner<TMessage extends { requestId: string }> {
  private worker: Worker | null = null;
  private active: ActiveStream | null = null;

  constructor(private readonly spec: StreamingWorkerSpec<TMessage>) {}

  get busy(): boolean {
    return this.active !== null;
  }

  run<TComplete>(input: StreamingWorkerJob<TMessage, TComplete>): Promise<TComplete> {
    if (this.active !== null) {
      if (input.concurrent.kind === 'reject')
        return Promise.reject(new Error(input.concurrent.message));
      this.dispose(input.concurrent.message);
    }
    return new Promise<TComplete>((resolve, reject) => {
      const worker = this.worker ?? this.spec.createWorker();
      this.worker = worker;
      const active: ActiveStream = {
        requestId: input.requestId,
        worker,
        queue: Promise.resolve(),
        handlerError: null,
        cancelled: false,
        terminal: false,
        cancelRequest: input.cancelRequest,
        timeout: null,
        reject,
      };
      this.active = active;
      const fail = (error: Error): void => {
        if (this.active !== active) return;
        this.detach(active);
        this.terminate();
        reject(error);
      };
      const complete = (output: TComplete): void => {
        if (this.active !== active) return;
        if (active.handlerError !== null) {
          fail(active.handlerError);
          return;
        }
        this.detach(active);
        resolve(output);
      };
      const enqueue = (handler: () => void | Promise<void>): void => {
        active.queue = active.queue
          .then(async () => {
            if (this.active === active) await handler();
          })
          .catch((error: unknown) => {
            if (this.active !== active) return;
            active.handlerError ??= asError(error);
            this.cancel();
          });
      };
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (this.active !== active || active.terminal) return;
        try {
          const parsed = this.spec.responseSchema.safeParse(event.data);
          if (!parsed.success) {
            if (this.spec.invalidMessage !== null) fail(new Error(this.spec.invalidMessage));
            return;
          }
          const message = parsed.data;
          if (message.requestId !== active.requestId) return;
          const output = input.completeOf(message);
          if (output !== null) {
            active.terminal = true;
            void active.queue.then(() => {
              complete(output);
            });
            return;
          }
          const error = input.errorOf(message);
          if (error !== null) {
            active.terminal = true;
            if (input.drainOnError)
              void active.queue.then(() => {
                fail(error);
              });
            else fail(error);
            return;
          }
          input.handle(message, enqueue);
        } catch (error) {
          fail(asError(error));
        }
      };
      worker.onerror = () => {
        fail(new Error(this.spec.crashed));
      };
      if (input.timeout !== undefined) {
        const { ms, message } = input.timeout;
        active.timeout = setTimeout(() => {
          fail(new Error(message));
        }, ms);
      }
      try {
        worker.postMessage(input.request);
      } catch (error) {
        fail(asError(error));
      }
    });
  }

  cancel(): void {
    const active = this.active;
    if (active === null || active.cancelled || active.cancelRequest === undefined) return;
    active.cancelled = true;
    try {
      active.worker.postMessage(active.cancelRequest);
    } catch (error) {
      this.detach(active);
      this.terminate();
      active.reject(asError(error));
    }
  }

  dispose(message: string): void {
    const active = this.active;
    if (active !== null) {
      this.detach(active);
      active.reject(new Error(message));
    }
    this.terminate();
  }

  private detach(active: ActiveStream): void {
    if (active.timeout !== null) clearTimeout(active.timeout);
    active.worker.onmessage = null;
    active.worker.onerror = null;
    this.active = null;
  }

  private terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
