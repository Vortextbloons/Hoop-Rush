export interface OneShotRequest {
    requestId: string;
}
export interface OneShotResponse {
    requestId: string;
}
export interface OneShotWorkerOptions<Request extends OneShotRequest, Response extends OneShotResponse, Result> {
    createWorker: () => Worker;
    request: Request;
    resultOf: (response: Response) => Result | null;
    errorOf: (response: Response) => string | null;
    errorFallback: string;
}
export function runOneShotWorker<Request extends OneShotRequest, Response extends OneShotResponse, Result>(options: OneShotWorkerOptions<Request, Response, Result>): Promise<Result> {
    const { createWorker, request, resultOf, errorOf, errorFallback } = options;
    const worker = createWorker();
    return new Promise<Result>((resolve, reject) => {
        const onMessage = (event: MessageEvent<Response>): void => {
            const message = event.data;
            if (message.requestId !== request.requestId)
                return;
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
