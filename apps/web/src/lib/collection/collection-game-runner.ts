import {
  COLLECTION_GAME_WORKER_WIRE_VERSION,
  collectionGameWorkerMessageSchema,
  collectionGameWorkerRequestSchema,
  type CollectionGameWorkerCompleteMessage,
  type CollectionPreparedGameUnion,
} from '@hoop-rush/data-contracts';

export interface CollectionGameRunInput {
  prepared: CollectionPreparedGameUnion;
  catalogUrl: string;
  catalogHash: string;
  profileUrl: string;
  profileHash: string;
  requestId?: string;
  createWorker?: () => Worker;
}

export function runCollectionGame(
  input: CollectionGameRunInput,
): Promise<CollectionGameWorkerCompleteMessage> {
  return new Promise((resolve, reject) => {
    const requestId = input.requestId ?? crypto.randomUUID();
    const request = collectionGameWorkerRequestSchema.parse({
      wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
      type: 'collection-game-simulate',
      requestId,
      prepared: input.prepared,
      catalogUrl: input.catalogUrl,
      catalogHash: input.catalogHash,
      profileUrl: input.profileUrl,
      profileHash: input.profileHash,
    });
    let worker: Worker;
    try {
      worker =
        input.createWorker?.() ??
        new Worker(new URL('../../workers/collection-game-worker.ts', import.meta.url), {
          type: 'module',
        });
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
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === 'collection-game-warm-ack') return;
      if (message.requestId !== requestId) return;
      cleanup();
      if (message.type === 'collection-game-complete') {
        if (message.gameId !== input.prepared.gameId) {
          reject(new Error('The worker returned a different game.'));
          return;
        }
        if (message.result.gameVersion !== input.prepared.gameVersion) {
          reject(new Error('The worker returned a result for a different game version.'));
          return;
        }
        resolve(message);
        return;
      }
      reject(new Error(message.message));
    };
    const onError = (event: ErrorEvent): void => {
      cleanup();
      reject(new Error(event.message || 'The game worker failed.'));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage(request);
  });
}
