import {
  DexieChallengeRepository,
  DexieCollectionRepository,
  DexieDraftDuelRepository,
  DexieFixedFiveRepository,
  DexieHavocMultiplayerRepository,
  DexieHavocRepository,
  DexieSeasonRunRepository,
  HoopRushDatabase,
  type DexieCollectionRepositoryOptions,
  type SeasonPostseasonRepository,
  type SeasonRunRepository,
} from '@hoop-rush/persistence';
import type { SeasonSchedule } from '@hoop-rush/data-contracts';

export interface Persistence {
  db: HoopRushDatabase;
  challengeRepository: DexieChallengeRepository;
  fixedFiveRepository: DexieFixedFiveRepository;
  havocRepository: DexieHavocRepository;
  draftDuelRepository: DexieDraftDuelRepository;
  havocMultiplayerRepository: DexieHavocMultiplayerRepository;
  collectionRepository(options: DexieCollectionRepositoryOptions): DexieCollectionRepository;
  seasonRunRepository(options: {
    schedule?: SeasonSchedule;
  }): SeasonRunRepository & SeasonPostseasonRepository;
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
      seasonRunRepository: (options) => new DexieSeasonRunRepository(db, options),
    };
  }
  return cached;
}
