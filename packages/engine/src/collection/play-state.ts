import {
  COLLECTION_GAME_VERSION,
  COLLECTION_SCHEMA_VERSION,
  COLLECTION_TEAM_VERSION,
  canonicalJson,
  seasonDigestHex,
  type CollectionActiveTeam,
  type CollectionCatalogCard,
  type CollectionPlayState,
} from '@hoop-rush/data-contracts';
import { CollectionCommandError } from './packs.ts';
import { initializeCollectionActiveTeam } from './active-team.ts';

export function collectionPlayStateFactsOf(state: CollectionPlayState): {
  collectionId: string;
  revision: number;
  activeTeam: CollectionActiveTeam;
  nextGameSequence: number;
  pendingGameDigest: string | null;
  teamVersion: string;
  gameVersion: string;
} {
  return {
    collectionId: state.collectionId,
    revision: state.revision,
    activeTeam: state.activeTeam,
    nextGameSequence: state.nextGameSequence,
    pendingGameDigest:
      state.pendingGame === null ? null : seasonDigestHex(canonicalJson(state.pendingGame)),
    teamVersion: state.teamVersion,
    gameVersion: state.gameVersion,
  };
}

export function collectionPlayStateDigest(
  facts: ReturnType<typeof collectionPlayStateFactsOf>,
): string {
  return seasonDigestHex(canonicalJson(facts));
}

export function initializeCollectionPlayState(input: {
  collectionId: CollectionPlayState['collectionId'];
  ownedCardIds: readonly string[];
  resolve: (cardId: string) => CollectionCatalogCard | undefined;
}): CollectionPlayState {
  let activeTeam: CollectionActiveTeam;
  try {
    activeTeam = initializeCollectionActiveTeam(input.ownedCardIds, input.resolve);
  } catch (error) {
    throw new CollectionCommandError(
      error instanceof CollectionCommandError ? error.code : 'no-legal-five',
      error instanceof Error ? error.message : 'cannot initialize a legal team',
    );
  }
  const state: CollectionPlayState = {
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    teamVersion: COLLECTION_TEAM_VERSION,
    gameVersion: COLLECTION_GAME_VERSION,
    collectionId: input.collectionId,
    activeTeam,
    revision: 0,
    digest: '0'.repeat(32),
    nextGameSequence: 0,
    pendingGame: null,
  };
  return { ...state, digest: collectionPlayStateDigest(collectionPlayStateFactsOf(state)) };
}
