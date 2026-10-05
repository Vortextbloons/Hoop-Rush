import {
  COLLECTION_GAME_WORKER_WIRE_VERSION,
  collectionGameWorkerMessageSchema,
  collectionGameWorkerRequestSchema,
  type CollectionGameCommand,
  type CollectionPlayState,
} from '@hoop-rush/data-contracts';
import type { CollectionGameCommandInput, CollectionGameCommandResult } from '@hoop-rush/engine';
import type { CollectionGameWorkerAssets } from './collection-hub';

export interface CollectionGameVerifyRunInput {
  playState: CollectionPlayState;
  command: CollectionGameCommand;
  engineInput: CollectionGameCommandInput;
  assets: CollectionGameWorkerAssets;
  requestId?: string;
  createWorker?: () => Worker;
}

export function runCollectionGameVerification(
  input: CollectionGameVerifyRunInput,
): Promise<CollectionGameCommandResult> {
  return new Promise((resolve, reject) => {
    const requestId = input.requestId ?? crypto.randomUUID();
    const request = collectionGameWorkerRequestSchema.parse({
      wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
      type: 'collection-game-verify',
      requestId,
      playState: input.playState,
      command: input.command,
      catalogUrl: input.assets.catalogUrl,
      catalogHash: input.engineInput.catalogHash,
      profileUrl: input.assets.profileUrl,
      profileHash: input.engineInput.profileHash,
      rootSeed: input.engineInput.rootSeed,
      ownedCardIds: [...input.engineInput.ownedCardIds],
      cpuWeights: input.engineInput.cpuWeights,
      difficultyProfiles: input.engineInput.difficultyProfiles,
      objectiveDefinitions: input.engineInput.objectiveDefinitions,
      rulesHash: input.engineInput.rulesHash,
      balances: input.engineInput.balances,
      priorCommands: [...input.engineInput.priorCommands],
      progression: input.engineInput.progression,
      progressionHash: input.engineInput.progressionHash,
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
      if (!parsed.success) {
        cleanup();
        reject(new Error('The game worker sent a message outside the worker wire schema.'));
        return;
      }
      const message = parsed.data;
      if (message.type === 'collection-game-warm-ack') return;
      if (message.requestId !== requestId) return;
      cleanup();
      if (message.type === 'collection-game-verified') {
        resolve(message.outcome);
        return;
      }
      reject(
        new Error(
          message.type === 'collection-game-error'
            ? message.message
            : 'The game worker sent an unexpected message.',
        ),
      );
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
