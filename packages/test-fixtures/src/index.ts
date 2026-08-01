import type {
  ChallengeRun,
  DifficultyProfile,
  EraSimulationProfile,
  FranchiseEraPool,
  GameSimulationInput,
  HoopRushManifest,
  OpponentTeam,
  PeakPlayerSeason,
  PlayerSeasonStats,
  Seed,
  SimulationPlayer,
  SimulationRatings,
  SimulationTeam,
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
    eraSimulationProfiles: [],
    opponents: [],
    assets: {
      headshotUrlTemplate:
        'https://cdn.nba.com/headshots/nba/latest/1040x760/{playerExternalId}.png',
      headshotUrlTemplateSecondary:
        'https://www.basketball-reference.com/req/20200617/images/headshots/{altIds.bbref}.jpg',
      logoUrlTemplate: 'https://cdn.nba.com/logos/nba/{teamExternalId}/global/L/logo.svg',
      logoUrlTemplateSecondary: 'https://a.espncdn.com/i/teamlogos/nba/500/{teamAbbreviation}.png',
      source: 'NBA.com',
      cacheVersion: '2026-07-01',
    },
    ...overrides,
  };
}

/**
 * M2 simulation fixtures. Defaults model a solid 1990s rotation player so
 * fixture lineups vary only along the dimensions tests care about.
 */

export const DEFAULT_SIM_RATINGS: SimulationRatings = {
  insideScoring: 78,
  closeShot: 70,
  midrange: 68,
  threePoint: 65,
  freeThrow: 74,
  ballHandling: 70,
  passing: 70,
  offensiveIq: 70,
  offensiveRebound: 60,
  defensiveRebound: 65,
  perimeterDefense: 62,
  interiorDefense: 62,
  steal: 60,
  block: 60,
  defensiveIq: 62,
  speed: 70,
  strength: 65,
  vertical: 66,
};

export const DEFAULT_SIM_TENDENCIES = {
  usageRate: 20,
  passRate: 30,
  shotRate: 25,
  driveRate: 18,
  postUpRate: 5,
  rimFrequency: 30,
  shortMidFrequency: 20,
  longMidFrequency: 14,
  cornerThreeFrequency: 8,
  aboveBreakThreeFrequency: 12,
  threePointRate: 20,
  freeThrowRate: 22,
  turnoverRate: 12,
  isolationRate: 10,
  pickAndRollBallHandlerRate: 25,
  pickAndRollRollManRate: 10,
  spotUpRate: 20,
  transitionRate: 15,
  cutRate: 10,
  foulRate: 2,
  stealAttemptRate: 8,
  blockAttemptRate: 10,
  crashOffensiveGlassRate: 12,
} as const;

export function buildSimulationPlayer(overrides: Partial<SimulationPlayer> = {}): SimulationPlayer {
  return {
    playerId: 'p-1',
    displayName: 'Test Player',
    positions: ['G'],
    heightInches: 76,
    weightLbs: 200,
    ratings: { ...DEFAULT_SIM_RATINGS },
    tendencies: { ...DEFAULT_SIM_TENDENCIES },
    ...overrides,
  };
}

/** A five-player lineup with a legal G,G,F,F,C position spread. */
export function buildLegalSimulationTeam(overrides: Partial<SimulationTeam> = {}): SimulationTeam {
  const positions: SimulationPlayer['positions'][] = [['G'], ['G'], ['F'], ['F'], ['C']];
  const players = positions.map((position, i) =>
    buildSimulationPlayer({
      playerId: `p-fixture-${i + 1}`,
      displayName: `Fixture ${i + 1}`,
      positions: position,
      ratings: { ...DEFAULT_SIM_RATINGS, interiorDefense: position[0] === 'C' ? 75 : 62 },
    }),
  );
  return {
    teamId: 'fixture-home',
    displayName: 'Fixture Home',
    players,
    ...overrides,
  };
}

/** Strength bands: strong ~85 across the board, medium ~65, weak ~48. */
function fixtureScale(targetCenter: number) {
  return (_element: unknown, index: number): SimulationPlayer => {
    const base = buildSimulationPlayer({
      playerId: `p-fx-${index + 1}`,
      displayName: `Fixture ${index + 1}`,
    });
    const shifted: SimulationRatings = Object.fromEntries(
      Object.entries(base.ratings).map(([key, value]) => {
        const scaled = Math.max(30, Math.min(95, Math.round(value + (targetCenter - 65))));
        return [key, scaled];
      }),
    ) as SimulationRatings;
    const positions: SimulationPlayer['positions'][] = [['G'], ['G'], ['F'], ['F'], ['C']];
    return { ...base, positions: positions[index]!, ratings: shifted };
  };
}

/** Equal-lineup fixture: both sides identical (determinism, mirror, and close-game tests). */
export function buildEqualFixture(): { home: SimulationTeam; away: SimulationTeam } {
  return {
    home: buildLegalSimulationTeam({ teamId: 'fixture-a', displayName: 'Fixture A' }),
    away: buildLegalSimulationTeam({ teamId: 'fixture-b', displayName: 'Fixture B' }),
  };
}

export function buildStrongWeakFixture(): {
  strong: SimulationTeam;
  weak: SimulationTeam;
} {
  return {
    strong: buildLegalSimulationTeam({
      teamId: 'fixture-strong',
      displayName: 'Fixture Strong',
      players: Array.from({ length: 5 }, fixtureScale(85)),
    }),
    weak: buildLegalSimulationTeam({
      teamId: 'fixture-weak',
      displayName: 'Fixture Weak',
      players: Array.from({ length: 5 }, fixtureScale(48)),
    }),
  };
}

export function buildStrongMediumFixture(): {
  strong: SimulationTeam;
  medium: SimulationTeam;
} {
  return {
    strong: buildLegalSimulationTeam({
      teamId: 'fixture-strong',
      displayName: 'Fixture Strong',
      players: Array.from({ length: 5 }, fixtureScale(85)),
    }),
    medium: buildLegalSimulationTeam({
      teamId: 'fixture-medium',
      displayName: 'Fixture Medium',
      players: Array.from({ length: 5 }, fixtureScale(65)),
    }),
  };
}

function fixtureTargets(): EraSimulationProfile['targets'] {
  const t = (value: number, tolerance: number, minimumSample = 0) => ({
    value,
    tolerance,
    minimumSample,
  });
  return {
    possessionsPerGame: t(95, 4, 1000),
    pointsPerGame: t(101, 6, 1000),
    offensiveRating: t(106, 6, 1000),
    fieldGoalPct: t(0.47, 0.02, 1000),
    efgPct: t(0.5, 0.02, 1000),
    tsPct: t(0.53, 0.02, 1000),
    threePointRate: t(0.14, 0.02, 1000),
    threePointPct: t(0.34, 0.02, 1000),
    freeThrowsAttemptedPerGame: t(27, 3, 1000),
    freeThrowPct: t(0.74, 0.02, 1000),
    turnoversPerGame: t(14.5, 1.5, 1000),
    turnoversPerPossession: t(0.15, 0.01, 1000),
    offensiveReboundsPerGame: t(12, 1.5, 1000),
    offensiveReboundRate: t(0.315, 0.02, 1000),
    assistsPerGame: t(24, 2.5, 1000),
    assistRate: t(0.62, 0.03, 1000),
    personalFoulsPerGame: t(21, 2.5, 1000),
    zoneMix: {
      rim: t(0.3, 0.02, 1000),
      shortMid: t(0.25, 0.02, 1000),
      longMid: t(0.19, 0.02, 1000),
      cornerThree: t(0.06, 0.015, 1000),
      aboveBreakThree: t(0.2, 0.02, 1000),
    },
    closeGameRate: t(0.18, 0.04, 1000),
    blowoutRate: t(0.12, 0.04, 1000),
    overtimeRate: t(0.06, 0.02, 1000),
    strongVsWeakWinRate: t(0.85, 0.08, 1000),
    equalLineupHomeWinRate: t(0.5, 0.05, 1000),
  };
}

export const DEFAULT_ERA_SIM_PROFILE: EraSimulationProfile = {
  schemaVersion: 1,
  eraId: '1990s',
  profileVersion: 'm2-1990s-fixture-v1',
  dataVersion: 'data-v1',
  seasons: [
    '1990-91',
    '1991-92',
    '1992-93',
    '1993-94',
    '1994-95',
    '1995-96',
    '1996-97',
    '1997-98',
    '1998-99',
    '1999-00',
  ],
  baselineReport: 'fixture',
  parameters: {
    pace: 95,
    league3PARate: 0.14,
    leagueTsPct: 0.51,
    leagueFtaPerFga: 0.28,
    leagueFtPct: 0.74,
    turnoverPerPossession: 0.15,
    stealShareOfTurnovers: 0.3,
    offensiveReboundRate: 0.315,
    assistRate: 0.62,
    foulsPerPossession: 0.21,
    shootingFoulShare: 0.42,
    freeThrowAnchorRating: 74,
    assistAnchorRating: 70,
    zoneMix: {
      rim: 0.3,
      shortMid: 0.25,
      longMid: 0.19,
      cornerThree: 0.06,
      aboveBreakThree: 0.2,
    },
    source: 'fixture',
  },
  targets: fixtureTargets(),
};

export function buildEraSimulationProfile(
  overrides: Partial<EraSimulationProfile> = {},
): EraSimulationProfile {
  return { ...DEFAULT_ERA_SIM_PROFILE, ...overrides };
}

export function buildGameSimulationInput(
  overrides: Partial<GameSimulationInput> = {},
): GameSimulationInput {
  const { home, away } = buildEqualFixture();
  return {
    schemaVersion: 1,
    seed: seedFromString('fixture-game'),
    dataVersion: 'data-v1',
    profile: DEFAULT_ERA_SIM_PROFILE,
    home,
    away,
    ...overrides,
  };
}

/** The authored M2 opening opponent: 1990s Lakers at medium strength. */
export function buildOpeningOpponent(overrides: Partial<OpponentTeam> = {}): OpponentTeam {
  return {
    schemaVersion: 1,
    opponentId: 'lakers-1990s-opening',
    bracketVersion: 'bracket-m3-preview-v1',
    difficultyBand: 'medium',
    teamId: 'lakers',
    displayName: 'Los Angeles Lakers',
    seasonKey: '1995-96',
    lineup: {
      structure: ['G', 'G', 'F', 'F', 'C'],
      assignments: [
        { slotIndex: 0, playerId: 'p-89', positions: ['G'] },
        { slotIndex: 1, playerId: 'p-9', positions: ['G'] },
        { slotIndex: 2, playerId: 'p-920', positions: ['F'] },
        { slotIndex: 3, playerId: 'p-109', positions: ['F'] },
        { slotIndex: 4, playerId: 'p-124', positions: ['C'] },
      ],
    },
    players: [
      buildSimulationPlayer({
        playerId: 'p-89',
        displayName: 'Nick Van Exel',
        positions: ['G'],
      }),
      buildSimulationPlayer({
        playerId: 'p-9',
        displayName: 'Sedale Threatt',
        positions: ['G'],
      }),
      buildSimulationPlayer({
        playerId: 'p-920',
        displayName: 'A.C. Green',
        positions: ['F'],
      }),
      buildSimulationPlayer({
        playerId: 'p-109',
        displayName: 'Robert Horry',
        positions: ['F'],
      }),
      buildSimulationPlayer({
        playerId: 'p-124',
        displayName: 'Vlade Divac',
        positions: ['C'],
      }),
    ],
    ...overrides,
  };
}
