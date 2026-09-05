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
  createWorker: () => Worker;
  request: Request;
  resultOf: (response: Response) => Result | null;
  errorOf: (response: Response) => string | null;
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
    let settled = false;
    const cleanup = (): void => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      clearTimeout(timeoutId);
      worker.terminate();
    };
    const onMessage = (event: MessageEvent<Response>): void => {
      const message = event.data;
      if (message.requestId !== request.requestId) return;
      if (settled) return;
      settled = true;
      cleanup();
      const result = resultOf(message);
      if (result !== null) {
        resolve(result);
        return;
      }
      const messageError = errorOf(message);
      reject(new Error(messageError === null ? errorFallback : messageError));
    };
    const onError = (event: ErrorEvent): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(event.message || errorFallback));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`${errorFallback} (timed out after 30s)`));
    }, 30000);
    worker.postMessage(request);
  });
}
