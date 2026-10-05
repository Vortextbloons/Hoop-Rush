import { seedSchema } from '@hoop-rush/data-contracts';
import { seasonDigestHex } from '@hoop-rush/data-contracts';
import {
  COLLECTION_GAME_SEED_DERIVATION_VERSION,
  COLLECTION_GAME_V1_SEED_DERIVATION_VERSION,
  COLLECTION_SEED_DERIVATION_VERSION,
  COLLECTION_SEED_NAMESPACES,
  type CollectionDifficultyId,
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

const GAME_ID_SEPARATOR = String.fromCharCode(0);

function gameNamespaceSeed(
  derivationVersion: string,
  rootSeed: string,
  namespace: CollectionGameSeedNamespace,
  ...keys: string[]
): string {
  const separator = String.fromCharCode(0);
  return seedSchema.parse(
    seasonDigestHex(
      [
        derivationVersion,
        rootSeed,
        namespace === 'games' ? 'games' : COLLECTION_SEED_NAMESPACES.cpuTeams,
        ...keys.map((key) => key.replaceAll(separator, '')),
      ].join(separator),
    ),
  );
}

function gameSeedWithVersion(
  derivationVersion: string,
  rootSeed: string,
  gameSequence: number,
): string {
  return gameNamespaceSeed(derivationVersion, rootSeed, 'games', String(gameSequence));
}

function cpuTeamSeedWithVersion(
  derivationVersion: string,
  rootSeed: string,
  ...keys: string[]
): string {
  return gameNamespaceSeed(derivationVersion, rootSeed, 'cpu-teams', ...keys);
}

function gameIdWithVersion(derivationVersion: string, rootSeed: string, ...keys: string[]): string {
  return `game-${seasonDigestHex([derivationVersion, rootSeed, 'game-id', ...keys].join(GAME_ID_SEPARATOR))}`;
}

function gameSeedPathFor(gameSequence: number): string[] {
  return ['collection', 'games', String(gameSequence)];
}

function cpuTeamSeedPathFor(gameSequence: number): string[] {
  return ['collection', COLLECTION_SEED_NAMESPACES.cpuTeams, String(gameSequence)];
}

function difficultyBasePathFor(
  difficultyId: CollectionDifficultyId,
  gameSequence: number,
): string[] {
  return [
    'collection',
    COLLECTION_SEED_NAMESPACES.cpuTeams,
    'difficulty',
    difficultyId,
    String(gameSequence),
  ];
}

export function collectionGameNamespaceSeed(
  rootSeed: string,
  namespace: CollectionGameSeedNamespace,
  ...keys: string[]
): string {
  return gameNamespaceSeed(
    COLLECTION_GAME_V1_SEED_DERIVATION_VERSION,
    rootSeed,
    namespace,
    ...keys,
  );
}

export function collectionCpuTeamSeed(rootSeed: string, gameSequence: number): string {
  return cpuTeamSeedWithVersion(
    COLLECTION_GAME_V1_SEED_DERIVATION_VERSION,
    rootSeed,
    String(gameSequence),
  );
}

export function collectionGameSeed(rootSeed: string, gameSequence: number): string {
  return gameSeedWithVersion(COLLECTION_GAME_V1_SEED_DERIVATION_VERSION, rootSeed, gameSequence);
}

export function collectionGameSeedPaths(gameSequence: number): {
  game: string[];
  cpuTeam: string[];
} {
  return {
    game: gameSeedPathFor(gameSequence),
    cpuTeam: cpuTeamSeedPathFor(gameSequence),
  };
}

export function collectionGameId(rootSeed: string, gameSequence: number): string {
  return gameIdWithVersion(
    COLLECTION_GAME_V1_SEED_DERIVATION_VERSION,
    rootSeed,
    String(gameSequence),
  );
}

export function collectionGameNamespaceSeedV2(
  rootSeed: string,
  namespace: CollectionGameSeedNamespace,
  ...keys: string[]
): string {
  return gameNamespaceSeed(COLLECTION_GAME_SEED_DERIVATION_VERSION, rootSeed, namespace, ...keys);
}

export function collectionCpuDifficultySeed(
  rootSeed: string,
  difficultyId: CollectionDifficultyId,
  gameSequence: number,
  ...keys: string[]
): string {
  return cpuTeamSeedWithVersion(
    COLLECTION_GAME_SEED_DERIVATION_VERSION,
    rootSeed,
    'difficulty',
    difficultyId,
    String(gameSequence),
    ...keys,
  );
}

export function collectionCpuIdentitySeed(
  rootSeed: string,
  difficultyId: CollectionDifficultyId,
  gameSequence: number,
): string {
  return collectionCpuDifficultySeed(rootSeed, difficultyId, gameSequence, 'identity');
}

export function collectionCpuCandidateSeed(
  rootSeed: string,
  difficultyId: CollectionDifficultyId,
  gameSequence: number,
  candidateIndex: number,
): string {
  return collectionCpuDifficultySeed(
    rootSeed,
    difficultyId,
    gameSequence,
    'candidate',
    String(candidateIndex),
  );
}

export function collectionObjectiveOfferSeed(
  rootSeed: string,
  difficultyId: CollectionDifficultyId,
  gameSequence: number,
): string {
  return collectionNamespaceSeed(rootSeed, 'objectives', difficultyId, String(gameSequence));
}

export function collectionGameSeedV2(rootSeed: string, gameSequence: number): string {
  return gameSeedWithVersion(COLLECTION_GAME_SEED_DERIVATION_VERSION, rootSeed, gameSequence);
}

export function collectionGameSeedPathsV2(
  difficultyId: CollectionDifficultyId,
  gameSequence: number,
): {
  game: string[];
  cpuTeam: string[];
  difficulty: string[];
  identity: string[];
  candidate: string[];
  objectives: string[];
} {
  const base = difficultyBasePathFor(difficultyId, gameSequence);
  return {
    game: gameSeedPathFor(gameSequence),
    cpuTeam: [...base],
    difficulty: ['collection', COLLECTION_SEED_NAMESPACES.cpuTeams, 'difficulty', difficultyId],
    identity: [...base, 'identity'],
    candidate: [...base, 'candidate'],
    objectives: [
      'collection',
      COLLECTION_SEED_NAMESPACES.objectives,
      difficultyId,
      String(gameSequence),
    ],
  };
}

export function collectionGameIdV2(
  rootSeed: string,
  difficultyId: CollectionDifficultyId,
  gameSequence: number,
): string {
  return gameIdWithVersion(
    COLLECTION_GAME_SEED_DERIVATION_VERSION,
    rootSeed,
    difficultyId,
    String(gameSequence),
  );
}
