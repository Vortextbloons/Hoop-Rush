import { mkdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { parsePool } from '@hoop-rush/data-contracts';
import { COHORT_NORMALIZATION_VERSION } from '@hoop-rush/data-contracts';
import { readJson, sha256File, writeJson } from '../json.ts';
import { normalizePositionLabels } from './positions.ts';
import {
  CONFIDENCE_POLICY_VERSION,
  DATA_VERSION,
  MIN_TEAM_GAMES,
  POSITION_NORMALIZATION_VERSION,
  RATINGS_VERSION,
  SCHEMA_VERSION,
  SELECTION_SCORE_VERSION,
  allPoolTargets,
  buildStats,
  sanitizeAnchors,
  candidateKey,
  computePool,
  defaultPoolWorkers,
  loadBbrefIds,
  loadCareerPositionLabels,
  normalizePoolOveralls,
  overallBandForPercentile,
  parsePoolTargets,
  partitionPoolTargets,
  run,
  selectionScore,
  type Candidate,
  type Manifest,
  type Pool,
  type PoolBuildFailure,
} from './compute.ts';

const TEAM = '1610612747';

const env = vi.hoisted(() => ({ nba: '', data: '', cache: '' }));

vi.mock('../config.js', () => ({
  get NBA_ROOT() {
    return env.nba;
  },
  get PUBLIC_DATA() {
    return env.data;
  },
  get RAW_CACHE() {
    return env.cache;
  },
  FIELD_AVAILABILITY: {},
}));

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------
interface RosterSpec {
  id: string;
  firstName: string;
  lastName: string;
  position: string;
  summary?: { overallRating: number; offenseRating: number; defenseRating: number };
  height?: number;
  weight?: number;
  secondaryPositions?: string[];
}

const SUMMARY_60 = { overallRating: 60, offenseRating: 60, defenseRating: 60 };
const SUMMARY_55 = { overallRating: 55, offenseRating: 55, defenseRating: 55 };
const FULL_RATINGS_60: Record<string, number> = {
  insideScoring: 60,
  closeShot: 60,
  midrange: 60,
  threePoint: 60,
  freeThrow: 60,
  ballHandling: 60,
  passing: 60,
  offensiveIq: 60,
  offensiveRebound: 60,
  defensiveRebound: 60,
  perimeterDefense: 60,
  interiorDefense: 60,
  steal: 60,
  block: 60,
  defensiveIq: 60,
  speed: 60,
  strength: 60,
  vertical: 60,
};
const FULL_RATINGS_55: Record<string, number> = Object.fromEntries(
  Object.entries(FULL_RATINGS_60).map(([key, value]) => [key, value - 5]),
);
const FULL_TENDENCIES: Record<string, number> = {
  usageRate: 10,
  passRate: 10,
  shotRate: 10,
  driveRate: 10,
  postUpRate: 10,
  rimFrequency: 10,
  shortMidFrequency: 10,
  longMidFrequency: 10,
  cornerThreeFrequency: 10,
  aboveBreakThreeFrequency: 10,
  threePointRate: 10,
  freeThrowRate: 10,
  turnoverRate: 10,
  isolationRate: 10,
  pickAndRollBallHandlerRate: 10,
  pickAndRollRollManRate: 10,
  spotUpRate: 10,
  transitionRate: 10,
  cutRate: 10,
  foulRate: 2,
  stealAttemptRate: 5,
  blockAttemptRate: 5,
  crashOffensiveGlassRate: 5,
};
const FULL_ANCHORS: Record<string, number | null> = {
  gamesPlayed: 60,
  minutesPerGame: 20,
  pointsPerGame: 1.7,
  reboundsPerGame: 0.8,
  offensiveReboundsPerGame: 0.2,
  defensiveReboundsPerGame: 0.7,
  assistsPerGame: 0.5,
  stealsPerGame: 0.1,
  blocksPerGame: 0.1,
  turnoversPerGame: 0.2,
  fieldGoalPct: 0.5,
  threePointPct: 0.5,
  freeThrowPct: 0.83,
  threePointAttemptRate: 0.25,
  freeThrowAttemptRate: 0.15,
};

const ROSTER_S1: RosterSpec[] = [
  {
    id: '1',
    firstName: 'Alpha',
    lastName: 'Ace',
    position: 'SG',
    summary: SUMMARY_60,
    height: 85,
    weight: 250,
  },
  {
    id: '2',
    firstName: 'Bravo',
    lastName: 'Bold',
    position: 'PG',
    summary: SUMMARY_60,
    height: 72,
    weight: 180,
  },
  {
    id: '3',
    firstName: 'Charlie',
    lastName: 'Charm',
    position: 'SF',
    summary: SUMMARY_60,
    height: 78,
    weight: 200,
  },
  { id: '4', firstName: 'Delta', lastName: 'Dare', position: 'C', height: 84, weight: 230 },
  {
    id: '5',
    firstName: 'Echo',
    lastName: 'Edge',
    position: 'C',
    summary: SUMMARY_60,
    height: 83,
    weight: 225,
  },
  {
    id: '6',
    firstName: 'Foxtrot',
    lastName: 'Fast',
    position: 'PF',
    summary: SUMMARY_55,
    height: 80,
    weight: 210,
  },
  {
    id: '7',
    firstName: 'Golf',
    lastName: 'Grit',
    position: 'C',
    summary: SUMMARY_55,
    height: 82,
    weight: 220,
  },
  {
    id: '8',
    firstName: 'Hotel',
    lastName: 'Hard',
    position: 'PF',
    summary: SUMMARY_55,
    height: 79,
    weight: 205,
  },
  {
    id: '9',
    firstName: 'India',
    lastName: 'Ice',
    position: 'G',
    summary: SUMMARY_60,
    height: 75,
    weight: 190,
  },
  {
    id: '10',
    firstName: 'Kilo',
    lastName: 'King',
    position: 'G',
    summary: SUMMARY_60,
    height: 74,
    weight: 185,
  },
];

const ROSTER_S2: RosterSpec[] = [
  {
    id: '1',
    firstName: 'Alpha',
    lastName: 'Ace',
    position: 'G-F',
    summary: SUMMARY_60,
    height: 85,
    weight: 250,
  },
  {
    id: '2',
    firstName: 'Bravo',
    lastName: 'Bold',
    position: 'SG',
    summary: SUMMARY_60,
    height: 72,
    weight: 180,
  },
  {
    id: '6',
    firstName: 'Foxtrot',
    lastName: 'Fast',
    position: 'PF',
    summary: SUMMARY_55,
    height: 80,
    weight: 210,
  },
  {
    id: '7',
    firstName: 'Golf',
    lastName: 'Grit',
    position: 'C',
    summary: SUMMARY_55,
    height: 82,
    weight: 220,
  },
  {
    id: '8',
    firstName: 'Hotel',
    lastName: 'Hard',
    position: 'PF',
    summary: SUMMARY_55,
    height: 79,
    weight: 205,
  },
];

function rosterRow(spec: RosterSpec): Record<string, unknown> {
  const ratings = spec.summary === SUMMARY_55 ? FULL_RATINGS_55 : FULL_RATINGS_60;
  return {
    externalId: spec.id,
    firstName: spec.firstName,
    lastName: spec.lastName,
    position: spec.position,
    teamExternalId: TEAM,
    heightInches: spec.height,
    weightLbs: spec.weight,
    ...(spec.secondaryPositions !== undefined
      ? { secondaryPositions: spec.secondaryPositions }
      : {}),
    ...(spec.summary ? { summaryRatings: spec.summary } : {}),
    ratings,
    tendencies: FULL_TENDENCIES,
    anchors: FULL_ANCHORS,
    provenance: {
      threePoint: {
        kind: 'derived',
        confidence: 'medium',
        methodVersion: 'derive-v1',
        sourceVersion: 'source-v1',
        sourceFields: ['tpm', 'tpa'],
      },
    },
  };
}

function stint(
  season: string,
  pid: string,
  games: number,
  minutes: number,
): Record<string, unknown> {
  return { season, playerExternalId: pid, teamExternalId: TEAM, gamesPlayed: games, minutes };
}

function statsRow(
  season: string,
  pid: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    playerExternalId: pid,
    season,
    gamesPlayed: 60,
    minutes: 1200,
    points: 100,
    rebounds: 50,
    offensiveRebounds: 10,
    defensiveRebounds: 40,
    assists: 30,
    steals: 5,
    blocks: 3,
    turnovers: 10,
    fgm: 40,
    fga: 80,
    tpm: 10,
    tpa: 20,
    ftm: 10,
    fta: 12,
    per: 12.5,
    boxPlusMinus: null,
    usageRate: 10,
    tsPct: 0.5,
    efgPct: 0.5,
    ...overrides,
  };
}

const STINTS_S1 = [
  stint('1991-92', '1', 60, 1200),
  stint('1991-92', '2', 60, 1200),
  stint('1991-92', '3', 39, 780),
  stint('1991-92', '4', 60, 1200),
  stint('1991-92', '5', 60, 1200),
  stint('1991-92', '6', 60, 1200),
  stint('1991-92', '7', 60, 1200),
  stint('1991-92', '8', 60, 1200),
  stint('1991-92', '9', 60, 1200),
  stint('1991-92', '10', 50, 1000),
  stint('1991-92', '999', 60, 1200),
];

const STINTS_S2 = [
  stint('1992-93', '1', 80, 3160),
  stint('1992-93', '2', 40, 800),
  stint('1992-93', '6', 50, 1000),
  stint('1992-93', '7', 60, 1200),
  stint('1992-93', '8', 40, 1200),
];

const STATS_S1 = [
  statsRow('1991-92', '1', { statsSource: 'stints-derived' }),
  statsRow('1991-92', '2', { boxPlusMinus: 2.5, statsSource: 'nba_api' }),
  statsRow('1991-92', '3'),
  statsRow('1991-92', '4'),
  statsRow('1991-92', '5', {
    gamesPlayed: 60.9,
    minutes: 645.7,
    per: null,
    boxPlusMinus: null,
    usageRate: null,
    tsPct: null,
    efgPct: null,
  }),
  statsRow('1991-92', '6'),
  statsRow('1991-92', '7', { usageRate: null }),
  statsRow('1991-92', '8'),
  statsRow('1991-92', '10', { gamesPlayed: 0, minutes: 1000 }),
  statsRow('1991-92', '999'),
];

const STATS_S2 = [
  statsRow('1992-93', '1', {
    gamesPlayed: 80,
    minutes: 3160,
    usageRate: 30,
    statsSource: 'stints-derived',
  }),
  statsRow('1992-93', '2', { gamesPlayed: 40, minutes: 800, usageRate: 30, boxPlusMinus: 2.5 }),
  statsRow('1992-93', '6', { gamesPlayed: 50, minutes: 1000 }),
  statsRow('1992-93', '7', { gamesPlayed: 60, minutes: 1200, usageRate: null }),
  statsRow('1992-93', '8', { gamesPlayed: 40, minutes: 1200, usageRate: 6 }),
];

const CAREER_LABELS: Record<string, string[]> = {
  '1': ['SG', 'G-F'],
  '2': ['PG'],
  '3': ['SF'],
  '4': ['C'],
  '5': [],
  '6': ['PF', 'XYZ'],
  '7': ['C'],
  '8': ['PF'],
  '9': ['G'],
  '10': ['G'],
  '999': ['C'],
};

const BBREF_IDS: Record<string, string> = { '1': 'alpha01', '2': 'bravo01' };

function fixtureManifest(): Manifest {
  return {
    schemaVersion: 1,
    dataVersion: 'm1.6',
    franchiseLineage: [
      { franchiseId: 'lakers', displayName: 'Los Angeles Lakers', teamExternalId: TEAM, names: [] },
      {
        franchiseId: 'nets',
        displayName: 'Brooklyn Nets',
        teamExternalId: '1610612751',
        firstNbaSeasonKey: '2000-01',
        names: [],
      },
      {
        franchiseId: 'celtics',
        displayName: 'Boston Celtics',
        teamExternalId: '1610612738',
        firstNbaSeasonKey: '1946-47',
        names: [],
      },
    ],
    eras: [
      { eraId: '1990s', label: '1990s', fromSeasonKey: '1990-91', toSeasonKey: '1999-00' },
      { eraId: '2000s', label: '2000s', fromSeasonKey: '2000-01', toSeasonKey: '2009-10' },
    ],
    pools: [
      {
        franchiseId: 'celtics',
        eraId: '1990s',
        url: 'pools/celtics-1990s.json',
        contentHash: 'a'.repeat(64),
      },
    ],
    assets: {},
  };
}

interface FixtureRoot {
  root: string;
  nba: string;
  data: string;
  cache: string;
}

function makeRoot(label: string): FixtureRoot {
  const root = mkdtempSync(join(tmpdir(), `pools-${label}-`));
  const nba = join(root, 'nba');
  const data = join(root, 'data');
  const cache = join(root, 'cache');
  mkdirSync(nba, { recursive: true });
  mkdirSync(data, { recursive: true });
  mkdirSync(cache, { recursive: true });
  env.nba = nba;
  env.data = data;
  env.cache = cache;
  roots.push(root);
  return { root, nba, data, cache };
}

function writeSeason(
  root: FixtureRoot,
  season: string,
  roster: RosterSpec[],
  stints: Array<Record<string, unknown>>,
  stats: Array<Record<string, unknown>>,
): void {
  const dir = join(root.nba, season);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, 'roster.json'), roster.map(rosterRow));
  writeJson(join(dir, 'stints.json'), stints);
  writeJson(join(dir, 'season-stats.json'), stats);
}

/** Standard two-season fixture with career-labels + bbref caches present. */
function buildStandardFixture(label: string): FixtureRoot {
  const root = makeRoot(label);
  writeSeason(root, '1991-92', ROSTER_S1, STINTS_S1, STATS_S1);
  writeSeason(root, '1992-93', ROSTER_S2, STINTS_S2, STATS_S2);
  writeJson(join(root.cache, 'career-position-labels-v5.json'), CAREER_LABELS);
  writeJson(join(root.cache, 'bbref_ids.json'), BBREF_IDS);
  writeJson(join(root.data, 'manifest.json'), fixtureManifest());
  return root;
}

const roots: string[] = [];

/** Console messages captured by a vi.spyOn(console, 'log') mock. */
function messages(spy: { mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> } }): string[] {
  return spy.mock.calls.map((call) => String(call[0]));
}

afterAll(() => {
  vi.restoreAllMocks();
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('buildStats', () => {
  it('truncates floats to ints like Python int() and maps keys', () => {
    const stats = buildStats(
      statsRow('1991-92', '9', {
        gamesPlayed: 60.9,
        minutes: 645.7,
        points: 156.2,
        rebounds: 50.5,
        fgm: 62.1,
        fga: 158.9,
      }),
    );
    expect(stats.gamesPlayed).toBe(60);
    expect(stats.minutes).toBe(645);
    expect(stats.points).toBe(156);
    expect(stats.rebounds).toBe(50);
    expect(stats.fieldGoalsMade).toBe(62);
    expect(stats.fieldGoalsAttempted).toBe(158);
    expect(stats.offensiveRebounds).toBe(10);
    expect(stats.defensiveRebounds).toBe(40);
    expect(stats.assists).toBe(30);
    expect(stats.steals).toBe(5);
    expect(stats.blocks).toBe(3);
    expect(stats.turnovers).toBe(10);
    expect(stats.threesMade).toBe(10);
    expect(stats.threesAttempted).toBe(20);
    expect(stats.freeThrowsMade).toBe(10);
    expect(stats.freeThrowsAttempted).toBe(12);
    expect(stats.per).toBe(12.5);
  });

  it('maps null and non-numeric advanced stats to null', () => {
    const stats = buildStats(
      statsRow('1991-92', '5', {
        per: null,
        boxPlusMinus: null,
        usageRate: null,
        tsPct: null,
        efgPct: null,
      }),
    );
    expect(stats.per).toBeNull();
    expect(stats.boxPlusMinus).toBeNull();
    expect(stats.usageRate).toBeNull();
    expect(stats.tsPct).toBeNull();
    expect(stats.efgPct).toBeNull();
  });

  it('falls back to 0 for missing count keys and keeps NaN out of advanced stats', () => {
    const stats = buildStats({});
    expect(stats.gamesPlayed).toBe(0);
    expect(stats.minutes).toBe(0);
    expect(stats.points).toBe(0);
    expect(stats.per).toBeNull();
    const bad = buildStats({ per: 'not-a-number', boxPlusMinus: Number.NaN });
    expect(bad.per).toBeNull();
    expect(bad.boxPlusMinus).toBeNull();
  });

  it('caps inconsistent shooting totals and clamps advanced percentages to 0..1', () => {
    const stats = buildStats({
      gamesPlayed: 78,
      minutes: 403,
      points: 739,
      rebounds: 158,
      assists: 21,
      fgm: 294,
      fga: 272,
      ftm: 151,
      fta: 200,
      tpm: 3,
      tpa: 2,
      tsPct: 1.026,
      efgPct: 1.081,
    });
    expect(stats.fieldGoalsMade).toBe(272);
    expect(stats.threesMade).toBe(2);
    expect(stats.tsPct).toBe(1);
    expect(stats.efgPct).toBe(1);
  });
});

describe('sanitizeAnchors', () => {
  it('clamps packaged anchor rates to the 0..1 contract', () => {
    const out = sanitizeAnchors({
      fieldGoalPct: 1.08,
      threePointPct: 1.5,
      freeThrowAttemptRate: 1.2,
    });
    expect(out.fieldGoalPct).toBe(1);
    expect(out.threePointPct).toBe(1);
    expect(out.freeThrowAttemptRate).toBe(1);
  });
});

describe('selectionScore', () => {
  it('computes the rating blend with a modest availability adjustment', () => {
    expect(selectionScore(90, 85, 80, 25, 2400, 80)).toBe(89.013);
  });

  it('clamps usage to 40 and mpg to 48', () => {
    expect(selectionScore(60, 60, 60, 50, 4000, 50)).toBe(61.977);
  });

  it('treats null usage as 0 and guards zero team games', () => {
    expect(selectionScore(60, 60, 60, null, 1200, 60)).toBe(59.752);
    expect(selectionScore(60, 60, 60, 10, 30, 0)).toBe(58.656);
  });
});

describe('overallBandForPercentile', () => {
  it('assigns the exact band endpoints', () => {
    expect(overallBandForPercentile(0)).toBe(99);
    expect(overallBandForPercentile(0.005)).toBe(94);
    expect(overallBandForPercentile(0.05)).toBe(89);
    expect(overallBandForPercentile(0.19)).toBe(84);
    expect(overallBandForPercentile(0.8)).toBe(71);
    expect(overallBandForPercentile(1)).toBe(40);
  });

  it('interpolates within each band', () => {
    expect(overallBandForPercentile(0.004)).toBe(96); // 99 - (p/0.005)*4
    expect(overallBandForPercentile(0.02)).toBe(93); // 94 - ((p-0.005)/0.045)*4
    expect(overallBandForPercentile(0.1)).toBe(88); // 89 - ((p-0.05)/0.14)*4
    expect(overallBandForPercentile(0.5)).toBe(78); // 84 - ((p-0.19)/0.61)*12
    expect(overallBandForPercentile(0.9)).toBe(56); // 71 - ((p-0.8)/0.2)*31
  });

  it('clamps to the 40..99 contract', () => {
    expect(overallBandForPercentile(-0.1)).toBe(99);
    expect(overallBandForPercentile(1.5)).toBe(40);
  });
});

describe('normalizePoolOveralls', () => {
  function row(
    playerId: string,
    franchiseId: string,
    rawOverallScore?: number,
    canonicalOverall?: number,
  ) {
    return {
      playerId,
      franchiseId,
      seasonKey: '1996-97',
      summaryRatings: { overallRating: 60, offenseRating: 60, defenseRating: 60 },
      ...(rawOverallScore !== undefined || canonicalOverall !== undefined
        ? {
            ratingProfile: {
              schemaVersion: 2 as const,
              modelVersion: 'ratings-model-v3.3',
              canonicalOverall: canonicalOverall ?? 70,
              ...(rawOverallScore !== undefined ? { rawOverallScore } : {}),
              overallPercentile: undefined,
              overallCohortVersion: undefined,
            },
          }
        : {}),
    };
  }

  it('ranks globally by raw overall and stamps the percentile band + profile fields', () => {
    const rows = [
      row('p-4', 'lakers', 60),
      row('p-1', 'lakers', 90),
      row('p-2', 'celtics', 80),
      row('p-3', 'lakers', 80),
    ];
    const diagnostics = normalizePoolOveralls(rows);
    expect(diagnostics).toEqual({ totalRowCount: 4, rowsWithoutRawOverall: 0 });
    const [p4, p1, p2, p3] = rows;
    // Rank order: p-1 (90), p-2 (80; id tie-break), p-3 (80), p-4 (60).
    expect(p1?.summaryRatings.overallRating).toBe(99); // p = 0
    expect(p1?.ratingProfile).toEqual({
      schemaVersion: 2,
      modelVersion: 'ratings-model-v3.3',
      canonicalOverall: 70,
      rawOverallScore: 90,
      overallPercentile: 0.25,
      overallCohortVersion: COHORT_NORMALIZATION_VERSION,
    });
    expect(p2?.summaryRatings.overallRating).toBe(83); // p = 0.25
    expect(p2?.ratingProfile?.overallPercentile).toBe(0.5);
    expect(p3?.summaryRatings.overallRating).toBe(78); // p = 0.5
    expect(p3?.ratingProfile?.overallPercentile).toBe(0.75);
    expect(p4?.summaryRatings.overallRating).toBe(73); // p = 0.75
    expect(p4?.ratingProfile?.overallPercentile).toBe(1);
    // Tie-break: identical raw overall, playerId ascending.
    expect(p2?.playerId).toBe('p-2');
    expect(p3?.playerId).toBe('p-3');
    // Only overallRating and the profile percentile fields may change.
    expect(p4?.summaryRatings.offenseRating).toBe(60);
    expect(p4?.summaryRatings.defenseRating).toBe(60);
  });

  it('ranks rows without rawOverallScore by canonical overall and leaves profile fields untouched', () => {
    const rows = [row('p-1', 'lakers', undefined, 55), row('p-2', 'lakers', undefined, 95)];
    const diagnostics = normalizePoolOveralls(rows);
    expect(diagnostics).toEqual({ totalRowCount: 2, rowsWithoutRawOverall: 2 });
    const [p1, p2] = rows;
    expect(p2?.summaryRatings.overallRating).toBe(99); // canonical 95 ranks first
    expect(p2?.ratingProfile).toEqual({
      schemaVersion: 2,
      modelVersion: 'ratings-model-v3.3',
      canonicalOverall: 95,
      overallPercentile: undefined,
      overallCohortVersion: undefined,
    });
    expect(p1?.summaryRatings.overallRating).toBe(78); // p = 0.5
    expect(p1?.ratingProfile).toEqual({
      schemaVersion: 2,
      modelVersion: 'ratings-model-v3.3',
      canonicalOverall: 55,
      overallPercentile: undefined,
      overallCohortVersion: undefined,
    });
  });

  it('handles empty and single-row inputs', () => {
    expect(normalizePoolOveralls([])).toEqual({ totalRowCount: 0, rowsWithoutRawOverall: 0 });
    const single = [row('p-1', 'lakers', 75)];
    expect(normalizePoolOveralls(single)).toEqual({ totalRowCount: 1, rowsWithoutRawOverall: 0 });
    expect(single[0]?.summaryRatings.overallRating).toBe(99); // p = 0
    expect(single[0]?.ratingProfile?.overallPercentile).toBe(1);
  });
});

describe('parsePoolTargets', () => {
  it('parses franchiseId/eraId pairs', () => {
    expect(parsePoolTargets(['lakers/1990s', 'celtics/2000s'])).toEqual([
      ['lakers', '1990s'],
      ['celtics', '2000s'],
    ]);
  });
  it('rejects malformed targets', () => {
    for (const bad of ['lakers', 'lakers/', '/1990s', 'a/b/c', '']) {
      expect(() => parsePoolTargets([bad])).toThrow(/invalid pool target/);
    }
  });
});

describe('computePool (fixture)', () => {
  let root: FixtureRoot;
  let log: MockInstance<typeof console.log>;

  beforeAll(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    log.mockClear();
  });

  it('applies the 40-game stint rule, joins, and selects peaks by tie-break key', () => {
    root = buildStandardFixture('main');
    const pool = computePool('lakers', '1990s', fixtureManifest(), BBREF_IDS, false);
    expect(pool).not.toBeNull();
    const p = pool as Pool;

    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.dataVersion).toBe(DATA_VERSION);
    expect(p.franchiseId).toBe('lakers');
    expect(p.eraId).toBe('1990s');
    expect(p.eligibility).toEqual({ minimumTeamGames: MIN_TEAM_GAMES });

    // 6 eligible: Alpha, Bravo, Echo, Foxtrot, Golf, Hotel.
    // Excluded: Charlie (39-game stint), Delta (no summaryRatings), India (no
    // season-stats row), Kilo (0-GP stats), Zulu (no roster entry).
    expect(p.players.map((player) => player.playerExternalId)).toEqual([
      '1',
      '2',
      '5',
      '6',
      '7',
      '8',
    ]);

    const byId = new Map(p.players.map((player) => [player.playerExternalId, player]));

    // Alpha: higher selectionScore wins (1992-93 over 1991-92).
    const alpha = byId.get('1');
    expect(alpha?.seasonKey).toBe('1992-93');
    expect(alpha?.selectionScore).toBe(62.229);
    expect(alpha?.eligibility).toEqual({ minimumTeamGames: 40, teamGames: 80, teamMinutes: 3160 });
    expect(alpha?.altIds).toEqual({ bbref: 'alpha01' });
    expect(alpha?.playerId).toBe('p-1');
    expect(alpha?.displayName).toBe('Alpha Ace');
    expect(alpha?.historicalTeamIdentity).toEqual({
      teamId: TEAM,
      displayName: 'Los Angeles Lakers',
      city: 'Los Angeles',
      abbreviation: 'LAL',
      seasonKey: '1992-93',
      lineageRuleVersion: 'lineage-v1',
    });
    expect(alpha?.positions).toEqual({
      primary: 'PG',
      secondary: [],
      playable: ['PF', 'PG', 'SF', 'SG'],
      sourceLabels: ['G-F', 'SG'],
      normalizationVersion: POSITION_NORMALIZATION_VERSION,
    });

    // Bravo: peak season 2 also beats season 1; 40 games is the boundary.
    const bravo = byId.get('2');
    expect(bravo?.seasonKey).toBe('1992-93');
    expect(bravo?.selectionScore).toBe(60.632);
    expect(bravo?.eligibility.teamGames).toBe(40);
    expect(bravo?.eligibility.teamMinutes).toBe(800);
    expect(bravo?.altIds).toEqual({ bbref: 'bravo01' });
    expect(bravo?.source.selectionScoreVersion).toBe(SELECTION_SCORE_VERSION);
    expect(bravo?.source.ratingsVersion).toBe(RATINGS_VERSION);
    expect(bravo?.source.dataVersion).toBe(DATA_VERSION);

    // Echo: empty career label set falls back to the roster position; null
    // advanced stats pass through as null; float counts truncate.
    const echo = byId.get('5');
    expect(echo?.seasonKey).toBe('1991-92');
    expect(echo?.selectionScore).toBe(59.752);
    expect(echo?.positions).toEqual({
      primary: 'C',
      secondary: [],
      playable: ['C'],
      sourceLabels: ['C'],
      normalizationVersion: POSITION_NORMALIZATION_VERSION,
    });
    expect(echo?.stats.gamesPlayed).toBe(60);
    expect(echo?.stats.minutes).toBe(645);
    expect(echo?.stats.per).toBeNull();
    expect(echo?.stats.boxPlusMinus).toBeNull();
    expect(echo?.stats.usageRate).toBeNull();
    expect(echo?.stats.tsPct).toBeNull();
    expect(echo?.stats.efgPct).toBeNull();

    // Foxtrot: equal score across seasons -> more team minutes wins (1991-92).
    const foxtrot = byId.get('6');
    expect(foxtrot?.seasonKey).toBe('1991-92');
    expect(foxtrot?.selectionScore).toBe(55.3);
    expect(foxtrot?.eligibility.teamMinutes).toBe(1200);
    expect(foxtrot?.altIds).toBeNull();
    expect(foxtrot?.positions).toEqual({
      primary: 'PF',
      secondary: [],
      playable: ['PF'],
      sourceLabels: ['PF', 'XYZ'],
      normalizationVersion: POSITION_NORMALIZATION_VERSION,
    });

    // Golf: full tie (score, minutes, games) -> earlier season wins (1991-92).
    const golf = byId.get('7');
    expect(golf?.seasonKey).toBe('1991-92');
    expect(golf?.selectionScore).toBe(54.805);
    expect(golf?.stats.usageRate).toBeNull();

    // Hotel: equal score + equal minutes -> more team games wins (1991-92).
    const hotel = byId.get('8');
    expect(hotel?.seasonKey).toBe('1991-92');
    expect(hotel?.selectionScore).toBe(55.3);
    expect(hotel?.eligibility.teamGames).toBe(60);
    expect(hotel?.eligibility.teamMinutes).toBe(1200);

    // Strict engine contracts survive packaging; provenance and anchors too.
    expect(Object.keys(alpha?.detailedRatings ?? {})).toHaveLength(18);
    expect(Object.keys(alpha?.tendencies ?? {})).toHaveLength(23);
    expect(alpha?.detailedRatings.passing).toBe(60);
    expect(alpha?.anchors.gamesPlayed).toBe(60);
    expect(alpha?.provenance['threePoint']?.kind).toBe('derived');

    // Coverage summary carries the band and the policy version.
    const poolResult = pool as Pool;
    expect(poolResult.coverageSummary.coverageBand).toBe('complete-box-derived');
    expect(poolResult.coverageSummary.policyVersion).toBe(CONFIDENCE_POLICY_VERSION);

    // Unknown position label is warned and preserved in sourceLabels, and it
    // never feeds the playable union.
    const warning = messages(log).find((message) => message.includes('unknown position labels'));
    expect(warning).toContain("unknown position labels: ['XYZ']");
    expect(warning).toContain('(6)');

    expect(messages(log).some((m) => m.includes('scanning 2 seasons'))).toBe(true);

    // The produced pool satisfies the runtime schema.
    expect(() => parsePool(pool)).not.toThrow();
  });

  it('warns and skips a player missing summaryRatings', () => {
    root = buildStandardFixture('nosummary');
    computePool('lakers', '1990s', fixtureManifest(), BBREF_IDS, false);
    const message = messages(log).find((m) => m.includes('missing summaryRatings'));
    expect(message).toContain('! 4 missing summaryRatings in 1991-92; re-run compute_ratings');
  });

  it('warns when a franchise has roster players but no stints for a season', () => {
    root = buildStandardFixture('nostints');
    const manifest = fixtureManifest();
    manifest.eras = [
      { eraId: '1980s', label: '1980s', fromSeasonKey: '1980-81', toSeasonKey: '1989-90' },
    ];
    // Season with a lakers roster but no stints.json at all.
    const dir = join(root.nba, '1988-89');
    mkdirSync(dir, { recursive: true });
    writeJson(join(dir, 'roster.json'), ROSTER_S1.map(rosterRow));
    computePool('lakers', '1980s', manifest, BBREF_IDS, false);
    const message = messages(log).find((m) => m.includes('[WARN] no stints for lakers in:'));
    expect(message).toContain('1988-89');
  });
});

describe('computePool error and skip paths', () => {
  it('returns identity failures for unknown franchise/era and source-incomplete eras', () => {
    buildStandardFixture('errors');
    const manifest = fixtureManifest();
    const spurs = computePool('spurs', '1990s', manifest, BBREF_IDS, false) as PoolBuildFailure;
    expect(spurs.reason).toBe('insufficient-players');
    const unknownEra = computePool(
      'lakers',
      '1980s',
      manifest,
      BBREF_IDS,
      false,
    ) as PoolBuildFailure;
    expect(unknownEra.reason).toBe('identity-failed');
    expect(unknownEra.detail).toContain('unknown eraId 1980s');
    const noSeasons = computePool(
      'lakers',
      '2000s',
      manifest,
      BBREF_IDS,
      false,
    ) as PoolBuildFailure;
    expect(noSeasons.reason).toBe('source-incomplete');
    expect(noSeasons.detail).toContain('no packaged seasons for era 2000s');
  });

  it('reports no-franchise-history with the first supported season', () => {
    buildStandardFixture('nohistory');
    const manifest = fixtureManifest();
    manifest.eras = [
      { eraId: '1980s', label: '1980s', fromSeasonKey: '1980-81', toSeasonKey: '1989-90' },
      { eraId: '1990s', label: '1990s', fromSeasonKey: '1990-91', toSeasonKey: '1999-00' },
    ];
    const result = computePool(
      'grizzlies',
      '1980s',
      manifest,
      BBREF_IDS,
      false,
    ) as PoolBuildFailure;
    expect(result.reason).toBe('no-franchise-history');
    expect(result.firstSupportedSeason).toBe('1995-96');
  });

  it('returns an insufficient-players failure when nothing is eligible', () => {
    buildStandardFixture('skip');
    const manifest = fixtureManifest();
    const pool = computePool('nets', '1990s', manifest, BBREF_IDS, false) as PoolBuildFailure;
    expect(pool.reason).toBe('insufficient-players');
  });

  it('logs a warning instead of annotating assets (stays in annotate-markers.mjs)', () => {
    buildStandardFixture('assets');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    computePool('lakers', '1990s', fixtureManifest(), BBREF_IDS, true);
    expect(
      messages(log).some((m) =>
        m.includes('headshot/photo asset annotation stays in scripts/annotate-markers.mjs'),
      ),
    ).toBe(true);
  });
});

describe('loadBbrefIds', () => {
  it('warns and returns {} when the cache file is missing', () => {
    makeRoot('bbref-missing');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(loadBbrefIds()).toEqual({});
    expect(messages(log)).toContain(
      '  [WARN] bbref_ids.json missing; run fetch_bbref_ids or run_all (no altIds)',
    );
  });

  it('returns the external-id map when present', () => {
    const root = makeRoot('bbref-present');
    writeJson(join(root.cache, 'bbref_ids.json'), BBREF_IDS);
    expect(loadBbrefIds()).toEqual(BBREF_IDS);
  });
});

describe('loadCareerPositionLabels', () => {
  it('reads the versioned cache when present', () => {
    const root = makeRoot('labels-cached');
    writeJson(join(root.cache, 'career-position-labels-v5.json'), { '1': ['SG', 'G-F'] });
    const labels = loadCareerPositionLabels();
    expect(labels.get('1')).toEqual(new Set(['G-F', 'SG']));
  });

  it('scans packaged rosters (primary + secondary labels) and writes the versioned cache when missing', () => {
    const root = makeRoot('labels-scan');
    writeSeason(root, '1991-92', ROSTER_S1, STINTS_S1, STATS_S1);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const labels = loadCareerPositionLabels();
    expect(labels.get('1')).toEqual(new Set(['SG']));
    expect(labels.get('999')).toBeUndefined();
    expect(
      JSON.parse(readFileSync(join(root.cache, 'career-position-labels-v5.json'), 'utf8')),
    ).toEqual(expect.objectContaining({ '1': ['SG'], '5': ['C'] }));
    expect(messages(log).some((m) => m.includes('[OK] career position labels for'))).toBe(true);
  });

  it('collects non-empty secondaryPositions labels alongside the primary label', () => {
    const root = makeRoot('labels-secondary');
    writeSeason(root, '1991-92', ROSTER_S1, STINTS_S1, STATS_S1);
    const withSecondary: RosterSpec[] = [
      {
        id: '1',
        firstName: 'Alpha',
        lastName: 'Ace',
        position: 'SG',
        secondaryPositions: ['PG', ''],
      },
      {
        id: '2',
        firstName: 'Bravo',
        lastName: 'Bold',
        position: 'PG',
        secondaryPositions: [],
      },
    ];
    writeJson(join(root.nba, '1991-92', 'roster.json'), withSecondary.map(rosterRow));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const labels = loadCareerPositionLabels();
    expect(labels.get('1')).toEqual(new Set(['PG', 'SG']));
    expect(labels.get('2')).toEqual(new Set(['PG']));
    expect(
      JSON.parse(readFileSync(join(root.cache, 'career-position-labels-v5.json'), 'utf8')),
    ).toEqual(expect.objectContaining({ '1': ['PG', 'SG'], '2': ['PG'] }));
    expect(messages(log).some((m) => m.includes('[OK] career position labels for'))).toBe(true);
  });
});

describe('allPoolTargets', () => {
  it('matches slots x eras with lineage overlap and packaged seasons', () => {
    buildStandardFixture('all-targets');
    const targets = allPoolTargets(fixtureManifest());
    // Every slot with NBA lineage in the 1990s and packaged fixture seasons
    // qualifies (29 slots); only the Pelicans (2002-03 founding) do not.
    expect(targets).toContainEqual(['lakers', '1990s']);
    expect(targets).toContainEqual(['celtics', '1990s']);
    expect(targets).toContainEqual(['nets', '1990s']);
    expect(targets).toContainEqual(['grizzlies', '1990s']);
    expect(targets).not.toContainEqual(['pelicans', '1990s']);
    expect(targets).toHaveLength(29);
    // The 2000s era has no packaged seasons.
    expect(targets.some(([, era]) => era === '2000s')).toBe(false);
  });
});

describe('partitionPoolTargets', () => {
  const TARGETS: Array<[string, string]> = [
    ['lakers', '1990s'],
    ['celtics', '1990s'],
    ['nets', '1990s'],
    ['lakers', '2000s'],
    ['celtics', '2000s'],
    ['lakers', '2010s'],
  ];

  it('keeps every chunk single-era and preserves all targets', () => {
    const chunks = partitionPoolTargets(TARGETS, 3);
    expect(chunks).toHaveLength(3);
    expect(chunks.flat()).toEqual(TARGETS);
    for (const chunk of chunks) {
      expect(new Set(chunk.map(([, era]) => era)).size).toBe(1);
    }
    expect(chunks.map((chunk) => chunk[0]?.[1])).toEqual(['1990s', '2000s', '2010s']);
  });

  it('splits the largest era groups to reach the worker count', () => {
    const chunks = partitionPoolTargets(TARGETS, 4);
    expect(chunks).toHaveLength(4);
    expect(chunks.flat()).toEqual(TARGETS);
    const sizes = chunks.map((chunk) => chunk.length).sort((a, b) => b - a);
    expect(sizes).toEqual([2, 2, 1, 1]);
  });

  it('returns a single chunk for workers 1 and for single targets', () => {
    expect(partitionPoolTargets(TARGETS, 1)).toEqual([TARGETS]);
    expect(partitionPoolTargets([['lakers', '1990s']], 4)).toEqual([[['lakers', '1990s']]]);
  });

  it('is deterministic across calls', () => {
    expect(partitionPoolTargets(TARGETS, 2)).toEqual(partitionPoolTargets(TARGETS, 2));
  });
});

describe('defaultPoolWorkers', () => {
  it('stays sequential under test (mocked config paths)', () => {
    expect(defaultPoolWorkers()).toBe(1);
  });
});

describe('asset altIds preservation', () => {
  it('backfills nbaHeadshotAvailable and photoUrl from the previous pool build', () => {
    const root = buildStandardFixture('altids');
    // Simulate a previous build annotated by scripts/annotate-markers.mjs:
    // bbref id on record, stale bbref in the file, markers present, and one
    // player whose photoUrl is legitimately null.
    const previous = {
      schemaVersion: SCHEMA_VERSION,
      dataVersion: DATA_VERSION,
      franchiseId: 'lakers',
      eraId: '1990s',
      eligibility: { minimumTeamGames: MIN_TEAM_GAMES },
      coverageSummary: {
        coverageBand: 'complete-box-derived',
        observedFamilies: [],
        derivedFamilies: [],
        estimatedFamilies: [],
        missingCategories: [],
        lowConfidenceShare: 0,
        policyVersion: CONFIDENCE_POLICY_VERSION,
      },
      players: [
        {
          playerExternalId: '1',
          altIds: {
            bbref: 'stale-alpha',
            nbaHeadshotAvailable: false,
            photoUrl: 'https://example.com/alpha.png',
          },
        },
        {
          playerExternalId: '2',
          altIds: { bbref: 'stale-bravo', nbaHeadshotAvailable: true, photoUrl: null },
        },
        { playerExternalId: '10', altIds: null },
      ],
    };
    writeJson(join(root.data, 'pools', 'lakers-1990s.json'), previous);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const pool = computePool('lakers', '1990s', fixtureManifest(), BBREF_IDS, false) as Pool;

    const byId = new Map(pool.players.map((player) => [player.playerExternalId, player.altIds]));
    expect(byId.get('1')).toEqual({
      bbref: 'alpha01',
      nbaHeadshotAvailable: false,
      photoUrl: 'https://example.com/alpha.png',
    });
    expect(byId.get('2')).toEqual({ bbref: 'bravo01', nbaHeadshotAvailable: true, photoUrl: null });
    for (const [pid, altIds] of byId) {
      if (pid === '1' || pid === '2') continue;
      expect(altIds).toBeNull();
    }
  });

  it('does not fabricate markers when no previous pool exists', () => {
    buildStandardFixture('altids-none');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const pool = computePool('lakers', '1990s', fixtureManifest(), BBREF_IDS, false) as Pool;
    const byId = new Map(pool.players.map((player) => [player.playerExternalId, player.altIds]));
    expect(byId.get('1')).toEqual({ bbref: 'alpha01' });
    expect(byId.get('2')).toEqual({ bbref: 'bravo01' });
  });
});

describe('candidateKey', () => {
  it('orders by score, minutes, games, then earlier season', () => {
    const mk = (
      season: string,
      minutes: number,
      games: number,
      usage: number | null,
    ): Candidate => ({
      season,
      player: { summaryRatings: SUMMARY_55, position: 'PF' },
      stint: { playerExternalId: '6', gamesPlayed: games, minutes },
      stats: statsRow(season, '6', { gamesPlayed: games, minutes, usageRate: usage }),
    });
    const higherScore = mk('1992-93', 800, 40, 30);
    const lowerScore = mk('1991-92', 1200, 60, 10);
    expect(compareKeys(candidateKey(higherScore), candidateKey(lowerScore))).toBe(1);

    // Availability and minutes now contribute to the score before the
    // documented minutes/games tie-breakers.
    const moreMinutes = mk('1991-92', 1200, 60, 10);
    const fewerMinutes = mk('1992-93', 1000, 50, 10);
    const moreKey = candidateKey(moreMinutes);
    const fewerKey = candidateKey(fewerMinutes);
    expect(compareKeys(moreKey, fewerKey)).toBe(1);

    // Equal score + minutes -> more games wins: 55.9 both.
    const moreGames = mk('1991-92', 1200, 60, 10);
    const fewerGames = mk('1992-93', 1200, 40, 6);
    expect(compareKeys(candidateKey(moreGames), candidateKey(fewerGames))).toBe(1);

    // Full tie -> earlier season wins (higher -seasonStart).
    const earlier = mk('1991-92', 1200, 60, null);
    const later = mk('1992-93', 1200, 60, null);
    expect(compareKeys(candidateKey(earlier), candidateKey(later))).toBe(1);
  });
});

function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined || bv === undefined) {
      return 0;
    }
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

describe('run / writePool / updateManifest', () => {
  it('writes a valid pool, digests it, and merges the manifest sorted by key', async () => {
    const root = buildStandardFixture('run');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([['lakers', '1990s']], false, 1);

    const poolPath = join(root.data, 'pools', 'lakers-1990s.json');
    const written = JSON.parse(readFileSync(poolPath, 'utf8')) as Pool;
    expect(written.players).toHaveLength(6);
    expect(() => parsePool(written)).not.toThrow();

    const digest = sha256File(poolPath);
    expect(written.eligibility.minimumTeamGames).toBe(MIN_TEAM_GAMES);

    const manifest = readJson(join(root.data, 'manifest.json')) as Manifest;
    expect(manifest.dataVersion).toBe(DATA_VERSION);
    expect(manifest.pools).toEqual([
      {
        franchiseId: 'celtics',
        eraId: '1990s',
        url: 'pools/celtics-1990s.json',
        contentHash: 'a'.repeat(64),
      },
      {
        franchiseId: 'lakers',
        eraId: '1990s',
        url: 'pools/lakers-1990s.json',
        contentHash: digest,
      },
    ]);
    expect(messages(log).some((m) => m.includes('[OK] wrote lakers-1990s.json (6 players, '))).toBe(
      true,
    );
    expect(messages(log).some((m) => m.includes('[OK] manifest updated: 2 pools'))).toBe(true);
  });

  it('skips failed pools and still updates the manifest', async () => {
    const root = buildStandardFixture('run-skip');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await run([['nets', '1990s']], false, 1);
    const manifest = readJson(join(root.data, 'manifest.json')) as Manifest;
    expect(manifest.pools).toEqual(fixtureManifest().pools);
    expect(manifest.dataVersion).toBe(DATA_VERSION);
  });
});

describe('schema fit (documented discrepancy)', () => {
  it('parsePool rejects a player whose playable union is empty (schema forbids empty unions)', () => {
    // normalizePositionLabels returns detailed=[] for a player whose only
    // label is "" (or whose labels are all unknown). The TS schema forbids
    // an empty union with .min(1); computePool's record builder falls back
    // to 'SF', and the writer logs the validation failure rather than
    // dropping a player when a record somehow ships an empty union.
    const pool = computePool('lakers', '1990s', fixtureManifest(), BBREF_IDS, false) as Pool;
    const { detailed, sourceLabels } = normalizePositionLabels(new Set(['']));
    expect(detailed).toEqual([]);
    expect(sourceLabels).toEqual(['']);
    const edited = {
      ...pool,
      players: [...pool.players],
    };
    edited.players[0] = {
      ...(edited.players[0] as (typeof pool.players)[number]),
      positions: {
        primary: 'SF',
        secondary: [],
        playable: detailed,
        sourceLabels,
        normalizationVersion: POSITION_NORMALIZATION_VERSION,
      },
    };
    expect(() => parsePool(edited)).toThrow();
  });
});
