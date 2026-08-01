import type {
  ChallengeRun,
  DifficultyProfile,
  FranchiseEraPool,
  HoopRushManifest,
  PeakPlayerSeason,
  PlayerSeasonStats,
  Seed,
  SummaryRatings,
} from '@hoop-rush/data-contracts';

/**
 * Deterministic fixture builders. Every builder returns schema-valid records
 * so tests and CLI fixtures can rely on the contracts. Overrides are shallow
 * at each level; nested sections use named arguments.
 */

export function seedFromString(value: string): Seed {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').repeat(4) as Seed;
}

export const DEFAULT_SUMMARY_RATINGS: SummaryRatings = {
  overallRating: 90,
  offenseRating: 92,
  defenseRating: 84,
};

export const DEFAULT_PLAYER_STATS: PlayerSeasonStats = {
  gamesPlayed: 79,
  minutes: 2860,
  points: 1920,
  rebounds: 480,
  assists: 410,
  steals: 90,
  blocks: 40,
  turnovers: 220,
  fieldGoalsMade: 740,
  fieldGoalsAttempted: 1450,
  threesMade: 110,
  threesAttempted: 300,
  freeThrowsMade: 330,
  freeThrowsAttempted: 420,
  per: 22.5,
  boxPlusMinus: 4.2,
  usageRate: 28.5,
  tsPct: 0.598,
  efgPct: 0.548,
};

export function buildPlayerSeason(overrides: Partial<PeakPlayerSeason> = {}): PeakPlayerSeason {
  return {
    schemaVersion: 1,
    playerId: 'p-1',
    franchiseId: 'lakers',
    eraId: '1990s',
    seasonKey: '1996-97',
    firstName: 'Test',
    lastName: 'Player',
    displayName: 'Test Player',
    playerExternalId: '101',
    positions: {
      sourceLabels: ['G'],
      canonical: ['G'],
      normalizationVersion: 'position-v1',
    },
    heightInches: 79,
    weightLbs: 215,
    eligibility: {
      minimumTeamGames: 40,
      teamGames: 78,
      teamMinutes: 2700,
    },
    selectionScore: 60,
    selectionScoreVersion: 'score-v1',
    stats: DEFAULT_PLAYER_STATS,
    summaryRatings: DEFAULT_SUMMARY_RATINGS,
    detailedRatings: { insideScoring: 82, threePoint: 78 },
    tendencies: { usageRate: 28, threePointRate: 24 },
    dataConfidence: 'observed',
    source: {
      dataVersion: 'data-v1',
      ratingsVersion: 'ratings-v1',
      selectionScoreVersion: 'score-v1',
    },
    ...overrides,
  };
}

export function buildPool(
  players: PeakPlayerSeason[],
  overrides: Partial<FranchiseEraPool> = {},
): FranchiseEraPool {
  return {
    schemaVersion: 1,
    dataVersion: 'data-v1',
    franchiseId: players[0]?.franchiseId ?? 'lakers',
    eraId: players[0]?.eraId ?? '1990s',
    eligibility: { minimumTeamGames: 40 },
    players,
    ...overrides,
  };
}

export const DEFAULT_DIFFICULTY: DifficultyProfile = {
  profileVersion: 'medium-v1',
  name: 'medium',
  leagueMedianPercentileBand: [0.45, 0.6],
  teamPercentileBand: [0.3, 0.7],
};

const ALL_FRANCHISE_IDS = [
  'hawks',
  'celtics',
  'nets',
  'hornets',
  'bulls',
  'cavaliers',
  'mavericks',
  'nuggets',
  'pistons',
  'warriors',
  'rockets',
  'pacers',
  'clippers',
  'lakers',
  'grizzlies',
  'heat',
  'bucks',
  'timberwolves',
  'pelicans',
  'knicks',
  'thunder',
  'magic',
  'sixers',
  'suns',
  'blazers',
  'kings',
  'spurs',
  'raptors',
  'jazz',
  'wizards',
] as const;

export function buildChallengeRun(overrides: Partial<ChallengeRun> = {}): ChallengeRun {
  return {
    runId: 'run-1',
    mode: 'sandbox',
    franchiseId: 'lakers',
    eraId: '1990s',
    playerIds: ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'],
    runSeed: seedFromString('fixture-run-1'),
    versions: {
      saveSchemaVersion: 1,
      dataVersion: 'data-v1',
      ratingVersion: 'ratings-v1',
      positionNormalizationVersion: 'position-v1',
      engineVersion: 'engine-v1',
      bracketVersion: 'bracket-v1',
      scheduleVersion: 'schedule-v1',
    },
    difficulty: DEFAULT_DIFFICULTY,
    status: 'active',
    schedule: { opponents: [...ALL_FRANCHISE_IDS] },
    games: [],
    ...overrides,
  };
}

export function buildManifest(overrides: Partial<HoopRushManifest> = {}): HoopRushManifest {
  return {
    schemaVersion: 1,
    dataVersion: 'data-v1',
    franchiseLineage: [
      {
        franchiseId: 'lakers',
        displayName: 'Los Angeles Lakers',
        teamExternalId: '1610612747',
        names: [
          { name: 'Minneapolis Lakers', fromSeasonKey: '1948-49', toSeasonKey: '1959-60' },
          { name: 'Los Angeles Lakers', fromSeasonKey: '1960-61', toSeasonKey: null },
        ],
      },
      {
        franchiseId: 'thunder',
        displayName: 'Oklahoma City Thunder',
        teamExternalId: '1610612760',
        names: [
          { name: 'Seattle SuperSonics', fromSeasonKey: '1967-68', toSeasonKey: '2007-08' },
          { name: 'Oklahoma City Thunder', fromSeasonKey: '2008-09', toSeasonKey: null },
        ],
      },
    ],
    eras: [
      { eraId: '1960s', label: '1960s', fromSeasonKey: '1960-61', toSeasonKey: '1969-70' },
      { eraId: '1970s', label: '1970s', fromSeasonKey: '1970-71', toSeasonKey: '1979-80' },
      { eraId: '1980s', label: '1980s', fromSeasonKey: '1980-81', toSeasonKey: '1989-90' },
      { eraId: '1990s', label: '1990s', fromSeasonKey: '1990-91', toSeasonKey: '1999-00' },
      { eraId: '2000s', label: '2000s', fromSeasonKey: '2000-01', toSeasonKey: '2009-10' },
      { eraId: '2010s', label: '2010s', fromSeasonKey: '2010-11', toSeasonKey: '2019-20' },
      { eraId: '2020s', label: '2020s', fromSeasonKey: '2020-21', toSeasonKey: '2029-30' },
    ],
    pools: [],
    assets: {
      headshotUrlTemplate:
        'https://cdn.nba.com/headshots/nba/latest/1040x760/{playerExternalId}.png',
      logoUrlTemplate: 'https://cdn.nba.com/logos/nba/{teamExternalId}/global/L/logo.svg',
      source: 'NBA.com',
      cacheVersion: '2026-07-01',
    },
    ...overrides,
  };
}
