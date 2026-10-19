import {
  collectionGameWorkerMessageSchema,
  type CollectionGameWorkerMessage,
} from '@hoop-rush/data-contracts';

import COLLECTION_GAME_WORKER_URL from '../../../workers/collection-game-worker.ts?worker&url';

export interface CollectionWorkerRunOptions<TResult> {
  request: unknown;
  requestId: string;
  createWorker?: () => Worker;
  onTerminal: (
    message: CollectionGameWorkerMessage,
    resolve: (value: TResult) => void,
    reject: (reason: Error) => void,
  ) => void;
}

export function runCollectionWorker<TResult>(
  options: CollectionWorkerRunOptions<TResult>,
): Promise<TResult> {
  return new Promise<TResult>((resolve, reject) => {
    let worker: Worker;
    try {
      worker =
        options.createWorker?.() ?? new Worker(COLLECTION_GAME_WORKER_URL, { type: 'module' });
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Could not start the game worker.'));
      return;
    }
    const cleanup = (): void => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.terminate();
    };
    const onMessage = (event: MessageEvent<unknown>): void => {
      const parsed = collectionGameWorkerMessageSchema.safeParse(event.data);
      if (!parsed.success) {
        cleanup();
        reject(new Error('The game worker sent a message outside the worker wire schema.'));
        return;
      }
      const message = parsed.data;
      if (message.type === 'collection-game-warm-ack') return;
      if (message.requestId !== options.requestId) return;
      cleanup();
      options.onTerminal(message, resolve, reject);
    };
    const onError = (event: ErrorEvent): void => {
      cleanup();
      reject(new Error(event.message || 'The game worker failed.'));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage(options.request);
  });
}
