/**
 * One-shot worker request helper: creates a worker, posts one request,
 * resolves the first response carrying the matching request id, and
 * terminates the worker. Worker lifecycle is per request (the caller owns
 * long-lived workers separately when asset caches inside the worker matter).
 * The message contract is the caller's: `requestIdOf`/`resultOf`/`errorOf`
 * map the caller's typed envelopes.
 */

export interface OneShotRequest {
  requestId: string;
}

export interface OneShotResponse {
  requestId: string;
}

export interface OneShotWorkerOptions<
  Request extends OneShotRequest,
  Response extends OneShotResponse,
  Result,
> {
  /**
   * Creates the worker. Pass `() => new Worker(new URL('...', import.meta.url),
   * { type: 'module' })` from the calling module so Vite statically detects
   * the worker entry and emits its chunk.
   */
  createWorker: () => Worker;
  request: Request;
  /** The result from a completed response (null when the response is an error). */
  resultOf: (response: Response) => Result | null;
  /** The error message from an error response (null when the response completed). */
  errorOf: (response: Response) => string | null;
  /** Fallback message when the worker emits a runtime error event. */
  errorFallback: string;
}

export function runOneShotWorker<
  Request extends OneShotRequest,
  Response extends OneShotResponse,
  Result,
>(options: OneShotWorkerOptions<Request, Response, Result>): Promise<Result> {
  const { createWorker, request, resultOf, errorOf, errorFallback } = options;
  const worker = createWorker();
  return new Promise<Result>((resolve, reject) => {
    const onMessage = (event: MessageEvent<Response>): void => {
      const message = event.data;
      if (message.requestId !== request.requestId) return;
      worker.removeEventListener('message', onMessage);
      worker.terminate();
      const result = resultOf(message);
      if (result !== null) {
        resolve(result);
        return;
      }
      const messageError = errorOf(message);
      reject(new Error(messageError === null ? '' : messageError));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', (event) => {
      worker.removeEventListener('message', onMessage);
      worker.terminate();
      reject(new Error(event.message || errorFallback));
    });
    worker.postMessage(request);
  });
}
