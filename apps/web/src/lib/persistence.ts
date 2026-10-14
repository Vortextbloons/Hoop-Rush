import {
  DexieChallengeRepository,
  DexieCollectionRepository,
  DexieDraftDuelRepository,
  DexieFixedFiveRepository,
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
      collectionRepository: (options) => new DexieCollectionRepository(db, options),
    };
  }
  return cached;
}
