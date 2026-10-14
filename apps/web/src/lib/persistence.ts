import {
  DexieChallengeRepository,
  DexieCollectionRepository,
  DexieDraftDuelRepository,
  DexieFixedFiveRepository,
  DexieHavocMultiplayerRepository,
  DexieHavocRepository,
  HoopRushDatabase,
  type DexieCollectionRepositoryOptions,
} from '@hoop-rush/persistence';

export interface Persistence {
  db: HoopRushDatabase;
  challengeRepository: DexieChallengeRepository;
  fixedFiveRepository: DexieFixedFiveRepository;
  havocRepository: DexieHavocRepository;
  draftDuelRepository: DexieDraftDuelRepository;
  havocMultiplayerRepository: DexieHavocMultiplayerRepository;
  collectionRepository(options: DexieCollectionRepositoryOptions): DexieCollectionRepository;
}

let cached: Persistence | null = null;

export function getPersistence(): Persistence {
  if (cached === null) {
    const db = new HoopRushDatabase();
    cached = {
      db,
      challengeRepository: new DexieChallengeRepository(db),
      fixedFiveRepository: new DexieFixedFiveRepository(db),
      havocRepository: new DexieHavocRepository(db),
      draftDuelRepository: new DexieDraftDuelRepository(db),
      havocMultiplayerRepository: new DexieHavocMultiplayerRepository(db),
      collectionRepository: (options) => new DexieCollectionRepository(db, options),
    };
  }
  return cached;
}
