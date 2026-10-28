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
  mock,
  spyOn,
  type Mock,
} from 'bun:test';
import { parsePool } from '@hoop-rush/data-contracts';
import { MANIFEST_SCHEMA_VERSION } from '@hoop-rush/data-contracts';
import { readJson, sha256File, writeJson } from '../json.ts';
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
  computePool,
  overallBandForPercentile,
  partitionPoolTargets,
  run,
  type Manifest,
  type Pool,
  type PoolBuildFailure,
} from './compute.ts';
const TEAM = '1610612747';
await mock.module('../config.ts', () => ({
  NBA_ROOT: '',
  PUBLIC_DATA: '',
  RAW_CACHE: '',
  FIELD_AVAILABILITY: {},
}));
interface RosterSpec {
  id: string;
  firstName: string;
  lastName: string;
  position: string;
  summary?: {
    overallRating: number;
    offenseRating: number;
    defenseRating: number;
  };
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
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    dataVersion: 'm1.6',
    modernFranchiseSlots: Array.from({ length: 30 }, (_, index) => ({
      franchiseId: `fixture-${String(index).padStart(2, '0')}`,
      displayName: `Fixture Franchise ${String(index)}`,
      teamExternalId: String(1610612700 + index),
    })),
    franchiseLineage: [
      {
        modernFranchiseId: 'celtics',
        historicalTeamId: '1610612738',
        validFromSeasonKey: '1946-47',
        displayName: 'Boston Celtics',
        city: 'Boston',
        abbreviation: 'BOS',
        sourceIdentityIds: ['1610612738'],
        lineageRuleVersion: 'lineage-v1',
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
    availability: [],
    eraSimulationProfiles: [],
    assets: {
      headshotUrlTemplate: null,
      headshotUrlTemplateSecondary: null,
      logoUrlTemplate: null,
      logoUrlTemplateSecondary: null,
      source: 'fixture',
      cacheVersion: 'fixture-v1',
    },
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
  void mock.module('../config.ts', () => ({
    NBA_ROOT: nba,
    PUBLIC_DATA: data,
    RAW_CACHE: cache,
    FIELD_AVAILABILITY: {},
  }));
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
function buildStandardFixture(label: string): FixtureRoot {
  const root = makeRoot(label);
  writeSeason(root, '1991-92', ROSTER_S1, STINTS_S1, STATS_S1);
  writeSeason(root, '1992-93', ROSTER_S2, STINTS_S2, STATS_S2);
  writeJson(join(root.cache, 'career-position-labels-v6.json'), CAREER_LABELS);
  writeJson(join(root.cache, 'bbref_ids.json'), BBREF_IDS);
  writeJson(join(root.data, 'manifest.json'), fixtureManifest());
  return root;
}
const roots: string[] = [];
function messages(spy: {
  mock: {
    calls: ReadonlyArray<ReadonlyArray<unknown>>;
  };
}): string[] {
  return spy.mock.calls.map((call) => String(call[0]));
}
afterAll(() => {
  mock.restore();
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});
describe('buildStats', () => {
  it('preserves observed zero shot attempts separately from absent historical totals', () => {
    const observed = buildStats({ gamesPlayed: 80, minutes: 3000, tpm: 0, tpa: 0 });
    expect(observed.threesMade).toBe(0);
    expect(observed.threesAttempted).toBe(0);
    const absent = buildStats({ gamesPlayed: 80, minutes: 3000, tpm: null, tpa: null });
    expect(absent.threesMade).toBeNull();
    expect(absent.threesAttempted).toBeNull();
  });
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
  it('nulls inconsistent shooting families instead of capping them into fiction', () => {
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
    expect(stats.fieldGoalsMade).toBe(0);
    expect(stats.fieldGoalsAttempted).toBe(0);
    expect(stats.threesMade).toBeNull();
    expect(stats.threesAttempted).toBeNull();
    expect(stats.tsPct).toBeNull();
    expect(stats.efgPct).toBeNull();
    expect(stats.freeThrowsMade).toBe(151);
    expect(stats.freeThrowsAttempted).toBe(200);
  });
  it('nulls corrupt minutes while keeping the scoring line for per-game use', () => {
    const stats = buildStats({
      gamesPlayed: 79,
      minutes: 322,
      points: 2495,
      rebounds: 1461,
      fgm: 973,
      fga: 883,
      ftm: 549,
      fta: 853,
      tsPct: 0.9914012333905525,
      efgPct: 1,
    });
    expect(stats.minutes).toBe(0);
    expect(stats.points).toBe(2495);
    expect(stats.fieldGoalsMade).toBe(0);
    expect(stats.fieldGoalsAttempted).toBe(0);
    expect(stats.tsPct).toBeNull();
    expect(stats.efgPct).toBeNull();
  });
  it('nulls rebound splits that contradict the total', () => {
    const stats = buildStats({
      gamesPlayed: 82,
      minutes: 2500,
      points: 1200,
      rebounds: 800,
      offensiveRebounds: 100,
      defensiveRebounds: 100,
      fgm: 400,
      fga: 800,
    });
    expect(stats.offensiveRebounds).toBeNull();
    expect(stats.defensiveRebounds).toBeNull();
    expect(stats.rebounds).toBe(800);
  });
});
describe('overallBandForPercentile', () => {
  it('keeps the peak distribution generous with a thinning upper tail', () => {
    expect(overallBandForPercentile(0)).toBe(99);
    expect(overallBandForPercentile(0.0045)).toBe(96);
    expect(overallBandForPercentile(0.023)).toBe(93);
    expect(overallBandForPercentile(0.078)).toBe(89);
    expect(overallBandForPercentile(0.188)).toBe(85);
    expect(overallBandForPercentile(0.34)).toBe(81);
    expect(overallBandForPercentile(0.53)).toBe(77);
    expect(overallBandForPercentile(0.7)).toBe(73);
    expect(overallBandForPercentile(0.83)).toBe(69);
    expect(overallBandForPercentile(0.93)).toBe(64);
    expect(overallBandForPercentile(1)).toBe(40);
  });
  it('gives higher overalls a thinner share inside the top bands', () => {
    const count = (overall: number) => {
      let hits = 0;
      for (let step = 0; step < 20000; step += 1) {
        if (overallBandForPercentile((step + 0.5) / 20000) === overall) hits += 1;
      }
      return hits;
    };
    expect(count(99)).toBeLessThanOrEqual(count(98));
    expect(count(98)).toBeLessThanOrEqual(count(97));
    expect(count(96)).toBeLessThanOrEqual(count(95));
    expect(count(95)).toBeLessThanOrEqual(count(94));
  });
});
describe('computePool (fixture)', () => {
  let root: FixtureRoot;
  let log: Mock<typeof console.log>;
  beforeAll(() => {
    log = spyOn(console, 'log').mockImplementation(() => {});
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
    expect(p.players.map((player) => player.playerExternalId)).toEqual([
      '1',
      '2',
      '5',
      '6',
      '7',
      '8',
    ]);
    const byId = new Map(p.players.map((player) => [player.playerExternalId, player]));
    const alpha = byId.get('1');
    expect(alpha?.seasonKey).toBe('1992-93');
    expect(alpha?.selectionScore).toBe(60);
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
    const bravo = byId.get('2');
    expect(bravo?.seasonKey).toBe('1991-92');
    expect(bravo?.selectionScore).toBe(60);
    expect(bravo?.eligibility.teamGames).toBe(60);
    expect(bravo?.eligibility.teamMinutes).toBe(1200);
    expect(bravo?.altIds).toEqual({ bbref: 'bravo01' });
    expect(bravo?.source.selectionScoreVersion).toBe(SELECTION_SCORE_VERSION);
    expect(bravo?.source.ratingsVersion).toBe(RATINGS_VERSION);
    expect(bravo?.source.dataVersion).toBe(DATA_VERSION);
    const echo = byId.get('5');
    expect(echo?.seasonKey).toBe('1991-92');
    expect(echo?.selectionScore).toBe(60);
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
    const foxtrot = byId.get('6');
    expect(foxtrot?.seasonKey).toBe('1991-92');
    expect(foxtrot?.selectionScore).toBe(55);
    expect(foxtrot?.eligibility.teamMinutes).toBe(1200);
    expect(foxtrot?.altIds).toBeNull();
    expect(foxtrot?.positions).toEqual({
      primary: 'PF',
      secondary: [],
      playable: ['PF'],
      sourceLabels: ['PF', 'XYZ'],
      normalizationVersion: POSITION_NORMALIZATION_VERSION,
    });
    const golf = byId.get('7');
    expect(golf?.seasonKey).toBe('1991-92');
    expect(golf?.selectionScore).toBe(55);
    expect(golf?.stats.usageRate).toBeNull();
    const hotel = byId.get('8');
    expect(hotel?.seasonKey).toBe('1991-92');
    expect(hotel?.selectionScore).toBe(55);
    expect(hotel?.eligibility.teamGames).toBe(60);
    expect(hotel?.eligibility.teamMinutes).toBe(1200);
    expect(Object.keys(alpha?.detailedRatings ?? {})).toHaveLength(18);
    expect(Object.keys(alpha?.tendencies ?? {})).toHaveLength(23);
    expect(alpha?.detailedRatings.passing).toBe(60);
    expect(alpha?.anchors.gamesPlayed).toBe(60);
    expect(alpha?.provenance['threePoint']?.kind).toBe('derived');
    const poolResult = pool as Pool;
    expect(poolResult.coverageSummary.coverageBand).toBe('complete-box-derived');
    expect(poolResult.coverageSummary.policyVersion).toBe(CONFIDENCE_POLICY_VERSION);
    const warning = messages(log).find((message) => message.includes('unknown position labels'));
    expect(warning).toContain("unknown position labels: ['XYZ']");
    expect(warning).toContain('(6)');
    expect(messages(log).some((m) => m.includes('scanning 2 seasons'))).toBe(true);
    expect(() => parsePool(pool)).not.toThrow();
  });
  it('does not let one incomplete player suppress later eligible players', () => {
    root = buildStandardFixture('per-player-failures');
    const rosterPath = join(root.nba, '1991-92', 'roster.json');
    const roster = readJson(rosterPath) as Array<Record<string, unknown>>;
    const incomplete = roster.find((player) => player.externalId === '9');
    if (
      incomplete === undefined ||
      typeof incomplete.ratings !== 'object' ||
      incomplete.ratings === null
    ) {
      throw new Error('fixture player 9 is missing ratings');
    }
    delete (incomplete.ratings as Record<string, unknown>).insideScoring;
    writeJson(rosterPath, roster);
    const statsPath = join(root.nba, '1991-92', 'season-stats.json');
    const stats = readJson(statsPath) as Array<Record<string, unknown>>;
    stats.push(statsRow('1991-92', '9'), statsRow('1991-92', '10'));
    writeJson(statsPath, stats);
    const pool = computePool('lakers', '1990s', fixtureManifest(), BBREF_IDS, false);
    expect(pool).toHaveProperty('players');
    if ('reason' in pool) throw new Error(pool.detail);
    expect(pool.players.map((player) => player.playerExternalId)).toContain('10');
    expect(() => parsePool(pool)).not.toThrow();
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
  it('policy-v2 keeps a pool available when only a thin tail trips the low-confidence bar', () => {
    const root = buildStandardFixture('policy-tail');
    const rosterPath = join(root.nba, '1991-92', 'roster.json');
    const roster = readJson(rosterPath) as Array<Record<string, unknown>>;
    const tail = roster.find((player) => player.externalId === '8');
    if (tail === undefined) throw new Error('fixture player 8 missing');
    const lowProvenance: Record<string, unknown> = {};
    for (const field of [...Object.keys(FULL_RATINGS_60), ...Object.keys(FULL_TENDENCIES)]) {
      lowProvenance[field] = {
        kind: 'estimated',
        confidence: 'low',
        methodVersion: 'derive-v11',
        sourceVersion: 'source-v1',
        sourceFields: ['prior'],
      };
    }
    tail.provenance = lowProvenance;
    writeJson(rosterPath, roster);
    const pool = computePool('lakers', '1990s', fixtureManifest(), BBREF_IDS, false);
    if ('reason' in pool) throw new Error(`expected pool, got ${pool.reason}: ${pool.detail}`);
    expect(pool.coverageSummary.policyVersion).toBe(CONFIDENCE_POLICY_VERSION);
    expect(pool.players.map((player) => player.playerExternalId)).toContain('8');
  });
  it('policy-v2 fails a pool when low-confidence players are more than a quarter of membership', () => {
    const root = buildStandardFixture('policy-majority');
    for (const season of ['1991-92', '1992-93']) {
      const rosterPath = join(root.nba, season, 'roster.json');
      const roster = readJson(rosterPath) as Array<Record<string, unknown>>;
      for (const player of roster) {
        const lowProvenance: Record<string, unknown> = {};
        for (const field of [...Object.keys(FULL_RATINGS_60), ...Object.keys(FULL_TENDENCIES)]) {
          lowProvenance[field] = {
            kind: 'estimated',
            confidence: 'low',
            methodVersion: 'derive-v11',
            sourceVersion: 'source-v1',
            sourceFields: ['prior'],
          };
        }
        player.provenance = lowProvenance;
      }
      writeJson(rosterPath, roster);
    }
    const pool = computePool('lakers', '1990s', fixtureManifest(), BBREF_IDS, false);
    if (!('reason' in pool)) throw new Error('expected a confidence-failed pool build failure');
    expect(pool.reason).toBe('confidence-failed');
    expect(pool.detail).toContain('policy-v2');
  });
});
describe('allPoolTargets', () => {
  it('matches slots x eras with lineage overlap and packaged seasons', () => {
    buildStandardFixture('all-targets');
    const targets = allPoolTargets(fixtureManifest());
    expect(targets).toContainEqual(['lakers', '1990s']);
    expect(targets).toContainEqual(['celtics', '1990s']);
    expect(targets).toContainEqual(['nets', '1990s']);
    expect(targets).toContainEqual(['grizzlies', '1990s']);
    expect(targets).not.toContainEqual(['pelicans', '1990s']);
    expect(targets).toHaveLength(29);
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
});
describe('asset altIds preservation', () => {
  it('backfills nbaHeadshotAvailable and photoUrl from the previous pool build', () => {
    const root = buildStandardFixture('altids');
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
    spyOn(console, 'log').mockImplementation(() => {});
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
});
describe('run / writePool / updateManifest', () => {
  it('writes a valid pool, digests it, and merges the manifest sorted by key', async () => {
    const root = buildStandardFixture('run');
    const log = spyOn(console, 'log').mockImplementation(() => {});
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
  it('fails the build before writing a pool that parsePool rejects', async () => {
    const root = buildStandardFixture('invalid-pool');
    const rosterPath = join(root.nba, '1991-92', 'roster.json');
    const roster = readJson(rosterPath) as Array<Record<string, unknown>>;
    const echo = roster.find((player) => player.externalId === '5');
    if (echo === undefined) throw new Error('fixture player 5 is missing');
    echo.position = '';
    writeJson(rosterPath, roster);
    spyOn(console, 'log').mockImplementation(() => {});
    await expect(run([['lakers', '1990s']], false, 1)).rejects.toThrow(/invalid pool lakers-1990s/);
    expect(() => readFileSync(join(root.data, 'pools', 'lakers-1990s.json'))).toThrow();
  });
});
