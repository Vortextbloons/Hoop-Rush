import {
  COLLECTION_GAME_WORKER_WIRE_VERSION,
  collectionGameWorkerRequestSchema,
  type CollectionGameCommand,
  type CollectionPlayState,
} from '@hoop-rush/data-contracts';
import type { CollectionGameCommandInput, CollectionGameCommandResult } from '@hoop-rush/engine';
import { newRequestId } from '#lib/ids.js';
import type { CollectionGameWorkerAssets } from './collection-hub';
import { runCollectionWorker } from './collection-worker-runner.ts';

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
  const requestId = input.requestId ?? newRequestId();
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
  return runCollectionWorker<CollectionGameCommandResult>({
    request,
    requestId,
    createWorker: input.createWorker,
    onTerminal(message, resolve, reject) {
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
    },
  });
}
