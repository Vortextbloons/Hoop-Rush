import {
  DexieChallengeRepository,
  DexieFixedFiveRepository,
  DexieSeasonRunRepository,
  HoopRushDatabase,
  type SeasonPostseasonRepository,
  type SeasonRunRepository,
} from '@hoop-rush/persistence';
import type { SeasonSchedule } from '@hoop-rush/data-contracts';

export interface Persistence {
  db: HoopRushDatabase;
  challengeRepository: DexieChallengeRepository;
  fixedFiveRepository: DexieFixedFiveRepository;
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
      seasonRunRepository: (options) => new DexieSeasonRunRepository(db, options),
    };
  }
  return cached;
}
