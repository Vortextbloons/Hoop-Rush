import {
  DexieCapRushRepository,
  DexieCapRushMultiplayerRepository,
  DexieChallengeRepository,
  DexieDraftDuelRepository,
  DexieFixedFiveRepository,
  DexieFullCourtDraftRepository,
  DexieHavocMultiplayerRepository,
  DexieHavocRepository,
  DexieProfileRepository,
  HoopRushDatabase,
  createFullCourtPlayoffRepository,
  createFullCourtSeasonRepository,
} from '@hoop-rush/persistence';

export interface Persistence {
  db: HoopRushDatabase;
  challengeRepository: DexieChallengeRepository;
  fixedFiveRepository: DexieFixedFiveRepository;
  havocRepository: DexieHavocRepository;
  draftDuelRepository: DexieDraftDuelRepository;
  havocMultiplayerRepository: DexieHavocMultiplayerRepository;
  capRushRepository: DexieCapRushRepository;
  capRushMultiplayerRepository: DexieCapRushMultiplayerRepository;
  fullCourtDraftRepository: DexieFullCourtDraftRepository;
  fullCourtSeasonRepository: ReturnType<typeof createFullCourtSeasonRepository>;
  fullCourtPlayoffRepository: ReturnType<typeof createFullCourtPlayoffRepository>;
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
      capRushRepository: new DexieCapRushRepository(db),
      capRushMultiplayerRepository: new DexieCapRushMultiplayerRepository(db),
      fullCourtDraftRepository: new DexieFullCourtDraftRepository(db),
      fullCourtSeasonRepository: createFullCourtSeasonRepository(db),
      fullCourtPlayoffRepository: createFullCourtPlayoffRepository(db),
      profileRepository: new DexieProfileRepository(db),
    };
  }
  return cached;
}
