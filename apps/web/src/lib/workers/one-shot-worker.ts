import { newRequestId } from '#lib/ids.js';

const DEFAULT_ONE_SHOT_TIMEOUT_MS = 60_000;

export interface OneShotWorkerErrorMessages {
  superseded: string;
  disposed: string;
  timeout: string;
  crashed: string;
  invalidMessage: string;
}

export type OneShotWorkerResult<TOutput> =
  { kind: 'output'; output: TOutput } | { kind: 'error'; message: string };

export interface OneShotWorkerSpec<TPayload, TResponse, TOutput> {
  workerUrl: URL;
  buildRequest(payload: TPayload, requestId: string): unknown;
  responseSchema: {
    safeParse(
      value: unknown,
    ): { success: true; data: TResponse } | { success: false; error: unknown };
  };
  requestIdOf(response: TResponse): string;
  resultOf(response: TResponse): OneShotWorkerResult<TOutput>;
  errorMessages: OneShotWorkerErrorMessages;
  timeoutMs?: number;
  createWorker?: (url: URL) => Worker;
}

interface PendingOneShotRequest {
  requestId: string;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class OneShotWorkerRunner<TPayload, TResponse, TOutput> {
  private worker: Worker | null = null;
  private pending: PendingOneShotRequest | null = null;

  constructor(private readonly spec: OneShotWorkerSpec<TPayload, TResponse, TOutput>) {}

  run(payload: TPayload): Promise<TOutput> {
    this.cancelPending(this.spec.errorMessages.superseded);
    this.teardownWorker();
    const requestId = newRequestId();
    const request = this.spec.buildRequest(payload, requestId);
    const workerUrl = this.spec.workerUrl;
    const createWorker = this.spec.createWorker;
    const worker = createWorker
      ? createWorker(workerUrl)
      : new Worker(workerUrl, { type: 'module' });
    this.worker = worker;
    return new Promise<TOutput>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.fail(requestId, new Error(this.spec.errorMessages.timeout));
      }, this.spec.timeoutMs ?? DEFAULT_ONE_SHOT_TIMEOUT_MS);
      this.pending = { requestId, reject, timeout };
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const parsed = this.spec.responseSchema.safeParse(event.data);
        if (!parsed.success) {
          this.fail(requestId, new Error(this.spec.errorMessages.invalidMessage));
          return;
        }
        if (this.spec.requestIdOf(parsed.data) !== requestId) return;
        if (this.pending?.requestId !== requestId) return;
        const result = this.spec.resultOf(parsed.data);
        this.settle(requestId);
        if (result.kind === 'output') {
          resolve(result.output);
          return;
        }
        reject(new Error(result.message));
      };
      worker.onerror = () => {
        this.fail(requestId, new Error(this.spec.errorMessages.crashed));
      };
      worker.postMessage(request);
    });
  }

  dispose(): void {
    this.cancelPending(this.spec.errorMessages.disposed);
    this.teardownWorker();
  }

  private settle(requestId: string): void {
    if (this.pending?.requestId !== requestId) return;
    clearTimeout(this.pending.timeout);
    this.pending = null;
  }

  private fail(requestId: string, error: Error): void {
    if (this.pending?.requestId !== requestId) return;
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timeout);
    this.teardownWorker();
    pending.reject(error);
  }

  private cancelPending(reason: string): void {
    if (this.pending === null) return;
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timeout);
    pending.reject(new Error(reason));
  }

  private teardownWorker(): void {
    if (this.worker !== null) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
