import {
  COLLECTION_GAME_WORKER_WIRE_VERSION,
  collectionGameWorkerMessageSchema,
  type CollectionCatalog,
  type CollectionGameWorkerCompleteMessage,
  type CollectionPreparedGameUnion,
  type EraSimulationProfile,
} from '@hoop-rush/data-contracts';
import {
  checkCollectionGameResult,
  collectionGameEventDigest,
  collectionGameResultDigest,
  simulateCollectionGame,
} from '@hoop-rush/engine';

export function runFakeCollectionGame(
  prepared: CollectionPreparedGameUnion,
  catalog: CollectionCatalog,
  profile: EraSimulationProfile,
  requestId = 'fake-request-1',
): Promise<CollectionGameWorkerCompleteMessage> {
  const { result, events } = simulateCollectionGame(prepared, catalog, profile);
  if (result.gameVersion !== prepared.gameVersion) {
    return Promise.reject(
      new Error('The simulated result version does not match the prepared game.'),
    );
  }
  const failures = checkCollectionGameResult(result, events, prepared, catalog, profile);
  if (failures.length > 0) {
    return Promise.reject(new Error(failures[0] ?? 'The fake game failed its audit.'));
  }
  const message = collectionGameWorkerMessageSchema.parse({
    wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
    type: 'collection-game-complete',
    requestId,
    gameId: prepared.gameId,
    result,
    events,
    eventDigest: collectionGameEventDigest(events),
    resultDigest: collectionGameResultDigest(result),
  }) as CollectionGameWorkerCompleteMessage;
  return Promise.resolve(message);
}
