import {
  DexieChallengeRepository,
  DexieDraftDuelRepository,
  DexieFixedFiveRepository,
  DexieHavocMultiplayerRepository,
  DexieHavocRepository,
  DexieProfileRepository,
  HoopRushDatabase,
} from '@hoop-rush/persistence';

export interface Persistence {
  db: HoopRushDatabase;
  challengeRepository: DexieChallengeRepository;
  fixedFiveRepository: DexieFixedFiveRepository;
  havocRepository: DexieHavocRepository;
  draftDuelRepository: DexieDraftDuelRepository;
  havocMultiplayerRepository: DexieHavocMultiplayerRepository;
  profileRepository: DexieProfileRepository;
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
      profileRepository: new DexieProfileRepository(db),
    };
  }
  return cached;
}
