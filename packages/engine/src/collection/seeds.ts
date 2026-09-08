import { seedSchema } from '@hoop-rush/data-contracts';
import { seasonDigestHex } from '@hoop-rush/data-contracts';
import {
  COLLECTION_GAME_SEED_DERIVATION_VERSION,
  COLLECTION_SEED_DERIVATION_VERSION,
  COLLECTION_SEED_NAMESPACES,
  type CollectionSeedNamespace,
} from '@hoop-rush/data-contracts';

export { COLLECTION_SEED_NAMESPACES, type CollectionSeedNamespace };

export function collectionNamespaceSeed(
  rootSeed: string,
  namespace: CollectionSeedNamespace,
  ...keys: string[]
): string {
  const separator = String.fromCharCode(0);
  return seedSchema.parse(
    seasonDigestHex(
      [
        COLLECTION_SEED_DERIVATION_VERSION,
        rootSeed,
        COLLECTION_SEED_NAMESPACES[namespace],
        ...keys.map((key) => key.replaceAll(separator, '')),
      ].join(separator),
    ),
  );
}

export function collectionStarterSeed(rootSeed: string): string {
  return collectionNamespaceSeed(rootSeed, 'starter');
}

export function collectionPullSeed(
  rootSeed: string,
  packId: string,
  packRulesVersion: string,
  pullSequence: number,
): string {
  return collectionNamespaceSeed(rootSeed, 'pulls', packId, packRulesVersion, String(pullSequence));
}

export type CollectionGameSeedNamespace = 'games' | 'cpu-teams';

export function collectionGameNamespaceSeed(
  rootSeed: string,
  namespace: CollectionGameSeedNamespace,
  ...keys: string[]
): string {
  const separator = String.fromCharCode(0);
  return seedSchema.parse(
    seasonDigestHex(
      [
        COLLECTION_GAME_SEED_DERIVATION_VERSION,
        rootSeed,
        namespace === 'games' ? 'games' : COLLECTION_SEED_NAMESPACES.cpuTeams,
        ...keys.map((key) => key.replaceAll(separator, '')),
      ].join(separator),
    ),
  );
}

export function collectionCpuTeamSeed(rootSeed: string, gameSequence: number): string {
  return collectionGameNamespaceSeed(rootSeed, 'cpu-teams', String(gameSequence));
}

export function collectionGameSeed(rootSeed: string, gameSequence: number): string {
  return collectionGameNamespaceSeed(rootSeed, 'games', String(gameSequence));
}

export function collectionGameSeedPaths(gameSequence: number): {
  game: string[];
  cpuTeam: string[];
} {
  return {
    game: ['collection', 'games', String(gameSequence)],
    cpuTeam: ['collection', COLLECTION_SEED_NAMESPACES.cpuTeams, String(gameSequence)],
  };
}

export function collectionGameId(rootSeed: string, gameSequence: number): string {
  const separator = String.fromCharCode(0);
  return `game-${seasonDigestHex(
    [COLLECTION_GAME_SEED_DERIVATION_VERSION, rootSeed, 'game-id', String(gameSequence)].join(
      separator,
    ),
  )}`;
}
