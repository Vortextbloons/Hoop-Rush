import {
  COLLECTION_GAME_WORKER_WIRE_VERSION,
  collectionGameWorkerRequestSchema,
  type CollectionGameWorkerCompleteMessage,
  type CollectionPreparedGameUnion,
} from '@hoop-rush/data-contracts';
import { runCollectionWorker } from './collection-worker-runner.ts';

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
  return runCollectionWorker<CollectionGameWorkerCompleteMessage>({
    request,
    requestId,
    createWorker: input.createWorker,
    onTerminal(message, resolve, reject) {
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
      if (message.type === 'collection-game-error') {
        reject(new Error(message.message));
        return;
      }
      reject(new Error('The game worker sent an unexpected message.'));
    },
  });
}
