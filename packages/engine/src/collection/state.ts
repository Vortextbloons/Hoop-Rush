import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_ECONOMY_VERSION,
  COLLECTION_PROGRESSION_VERSION,
  COLLECTION_STATE_SCHEMA_VERSION,
  COLLECTION_VERSION,
  type CollectionState,
} from '@hoop-rush/data-contracts';
import { collectionStateDigest, collectionStateFactsOf } from './cards.ts';

export function initializeCollectionState(input: {
  collectionId: string;
  rootSeed: string;
  progressionHash: string | null;
}): CollectionState {
  const state: CollectionState = {
    schemaVersion: COLLECTION_STATE_SCHEMA_VERSION,
    collectionVersion: COLLECTION_VERSION,
    catalogVersion: COLLECTION_CATALOG_VERSION,
    economyVersion: COLLECTION_ECONOMY_VERSION,
    progressionVersion: COLLECTION_PROGRESSION_VERSION,
    progressionHash: input.progressionHash as CollectionState['progressionHash'],
    collectionId: input.collectionId as CollectionState['collectionId'],
    rootSeed: input.rootSeed as CollectionState['rootSeed'],
    revision: 0,
    digest: '0'.repeat(32),
    claimedWelcome: false,
    owned: [],
    balances: { Coins: 0, Exchange: 0 },
    nextPullSequence: 0,
    activeTargetPlayerId: null,
    claimedSetIds: [],
  };
  return { ...state, digest: collectionStateDigest(collectionStateFactsOf(state)) };
}
