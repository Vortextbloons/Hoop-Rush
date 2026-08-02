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
import { readJson, sha256File, writeJson } from '../json.js';
import { normalizePositionLabels } from './positions.js';
import {
  DATA_VERSION,
  MIN_TEAM_GAMES,
  POSITION_NORMALIZATION_VERSION,
  RATINGS_VERSION,
  SCHEMA_VERSION,
  SELECTION_SCORE_VERSION,
  allPoolTargets,
  buildStats,
  candidateKey,
  computePool,
  loadBbrefIds,
  loadCareerPositionLabels,
  parsePoolTargets,
  run,
  seasonToEra,
  selectionScore,
  type Candidate,
  type Manifest,
  type Pool,
} from './compute.js';

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
  TEAM_FOUNDING_SEASON: { '1610612747': '1948-49' },
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
}

const SUMMARY_60 = { overallRating: 60, offenseRating: 60, defenseRating: 60 };
const SUMMARY_55 = { overallRating: 55, offenseRating: 55, defenseRating: 55 };
const RATINGS_60 = { insideScoring: 60, threePoint: 60, overall: 60 };
const RATINGS_55 = { insideScoring: 55, threePoint: 55, overall: 55 };
const TENDENCIES = { usageRate: 10, passRate: 10 };

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
  return {
    externalId: spec.id,
    firstName: spec.firstName,
    lastName: spec.lastName,
    position: spec.position,
    teamExternalId: TEAM,
    heightInches: spec.height,
    weightLbs: spec.weight,
    ...(spec.summary ? { summaryRatings: spec.summary } : {}),
    ratings: spec.summary === SUMMARY_55 ? RATINGS_55 : RATINGS_60,
    tendencies: TENDENCIES,
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
  writeJson(join(root.cache, 'career-position-labels-v3.json'), CAREER_LABELS);
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
});

describe('selectionScore', () => {
  it('computes 0.5*overall + 0.3*offense + 0.2*defense + 0.05*usage + 0.02*mpg', () => {
    expect(
      selectionScore({ overallRating: 90, offenseRating: 85, defenseRating: 80 }, 25, 2400, 80),
    ).toBe(88.35);
  });

  it('clamps usage to 40 and mpg to 48', () => {
    expect(
      selectionScore({ overallRating: 60, offenseRating: 60, defenseRating: 60 }, 50, 4000, 50),
    ).toBe(62.96);
  });

  it('treats null usage as 0 and guards zero team games', () => {
    expect(
      selectionScore({ overallRating: 60, offenseRating: 60, defenseRating: 60 }, null, 1200, 60),
    ).toBe(60.4);
    expect(
      selectionScore({ overallRating: 60, offenseRating: 60, defenseRating: 60 }, 10, 30, 0),
    ).toBe(61.1);
  });
});

describe('seasonToEra', () => {
  const eras = fixtureManifest().eras;
  it('maps inclusive era boundaries', () => {
    expect(seasonToEra(eras, '1990-91')).toBe('1990s');
    expect(seasonToEra(eras, '1999-00')).toBe('1990s');
    expect(seasonToEra(eras, '2000-01')).toBe('2000s');
  });
  it('returns null outside every era', () => {
    expect(seasonToEra(eras, '1989-90')).toBeNull();
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
    expect(alpha?.selectionScore).toBe(62.29);
    expect(alpha?.eligibility).toEqual({ minimumTeamGames: 40, teamGames: 80, teamMinutes: 3160 });
    expect(alpha?.altIds).toEqual({ bbref: 'alpha01' });
    expect(alpha?.dataConfidence).toBe('derived-medium');
    expect(alpha?.playerId).toBe('p-1');
    expect(alpha?.displayName).toBe('Alpha Ace');
    expect(alpha?.positions).toEqual({
      sourceLabels: ['G-F', 'SG'],
      canonical: ['F', 'G'],
      normalizationVersion: POSITION_NORMALIZATION_VERSION,
    });

    // Bravo: peak season 2 also beats season 1; 40 games is the boundary; bpm -> observed.
    const bravo = byId.get('2');
    expect(bravo?.seasonKey).toBe('1992-93');
    expect(bravo?.selectionScore).toBe(61.9);
    expect(bravo?.eligibility.teamGames).toBe(40);
    expect(bravo?.eligibility.teamMinutes).toBe(800);
    expect(bravo?.dataConfidence).toBe('observed');
    expect(bravo?.altIds).toEqual({ bbref: 'bravo01' });
    expect(bravo?.source.selectionScoreVersion).toBe(SELECTION_SCORE_VERSION);
    expect(bravo?.source.ratingsVersion).toBe(RATINGS_VERSION);
    expect(bravo?.source.dataVersion).toBe(DATA_VERSION);

    // Echo: empty career label set falls back to the roster position; null
    // advanced stats pass through as null; float counts truncate.
    const echo = byId.get('5');
    expect(echo?.seasonKey).toBe('1991-92');
    expect(echo?.selectionScore).toBe(60.4);
    expect(echo?.positions).toEqual({
      sourceLabels: ['C'],
      canonical: ['C'],
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
    expect(foxtrot?.selectionScore).toBe(55.9);
    expect(foxtrot?.eligibility.teamMinutes).toBe(1200);
    expect(foxtrot?.altIds).toBeNull();
    expect(foxtrot?.positions).toEqual({
      sourceLabels: ['PF'],
      canonical: ['F'],
      normalizationVersion: POSITION_NORMALIZATION_VERSION,
    });
    expect(foxtrot?.dataConfidence).toBe('derived-medium');

    // Golf: full tie (score, minutes, games) -> earlier season wins (1991-92).
    const golf = byId.get('7');
    expect(golf?.seasonKey).toBe('1991-92');
    expect(golf?.selectionScore).toBe(55.4);
    expect(golf?.stats.usageRate).toBeNull();

    // Hotel: equal score + equal minutes -> more team games wins (1991-92).
    const hotel = byId.get('8');
    expect(hotel?.seasonKey).toBe('1991-92');
    expect(hotel?.selectionScore).toBe(55.9);
    expect(hotel?.eligibility.teamGames).toBe(60);
    expect(hotel?.eligibility.teamMinutes).toBe(1200);

    // detailedRatings holds int values only; tendencies hold numbers.
    expect(Object.values(alpha?.detailedRatings ?? {})).toEqual([60, 60, 60]);
    expect(Object.values(alpha?.tendencies ?? {})).toEqual([10, 10]);

    // Unknown position label is warned and excluded from the canonical union.
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
  it('throws on unknown franchiseId / eraId / era without seasons', () => {
    buildStandardFixture('errors');
    const manifest = fixtureManifest();
    expect(() => computePool('spurs', '1990s', manifest, BBREF_IDS, false)).toThrow(
      'unknown franchiseId spurs',
    );
    expect(() => computePool('lakers', '1980s', manifest, BBREF_IDS, false)).toThrow(
      'unknown eraId 1980s',
    );
    expect(() => computePool('lakers', '2000s', manifest, BBREF_IDS, false)).toThrow(
      'no seasons available for lakers 2000s',
    );
  });

  it('returns null with a SKIP message when nothing is eligible', () => {
    buildStandardFixture('skip');
    const manifest = fixtureManifest();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const pool = computePool('nets', '1990s', manifest, BBREF_IDS, false);
    expect(pool).toBeNull();
    expect(messages(log).some((m) => m.includes('[SKIP] no eligible players for nets 1990s'))).toBe(
      true,
    );
  });

  it('logs a warning instead of annotating assets (stays in Python)', () => {
    buildStandardFixture('assets');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    computePool('lakers', '1990s', fixtureManifest(), BBREF_IDS, true);
    expect(
      messages(log).some((m) =>
        m.includes('headshot/photo asset annotation stays in the Python layer'),
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
    writeJson(join(root.cache, 'career-position-labels-v3.json'), { '1': ['SG', 'G-F'] });
    const labels = loadCareerPositionLabels();
    expect(labels.get('1')).toEqual(new Set(['G-F', 'SG']));
  });

  it('scans packaged rosters and writes the versioned cache when missing', () => {
    const root = makeRoot('labels-scan');
    writeSeason(root, '1991-92', ROSTER_S1, STINTS_S1, STATS_S1);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const labels = loadCareerPositionLabels();
    expect(labels.get('1')).toEqual(new Set(['SG']));
    expect(labels.get('999')).toBeUndefined();
    expect(
      JSON.parse(readFileSync(join(root.cache, 'career-position-labels-v3.json'), 'utf8')),
    ).toEqual(expect.objectContaining({ '1': ['SG'], '5': ['C'] }));
    expect(messages(log).some((m) => m.includes('[OK] career position labels for'))).toBe(true);
  });
});

describe('allPoolTargets', () => {
  it('matches Python --all: lineage x eras with season overlap and founding check', () => {
    buildStandardFixture('all-targets');
    const targets = allPoolTargets(fixtureManifest());
    // lakers (no founding key) and celtics (1946-47 <= 1999-00) qualify for the
    // 1990s; nets is excluded (founding 2000-01 after era end); the 2000s era
    // has no packaged seasons.
    expect(targets).toEqual([
      ['lakers', '1990s'],
      ['celtics', '1990s'],
    ]);
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

    // Equal score -> more minutes wins: 55.9 both (20 mpg each).
    const moreMinutes = mk('1991-92', 1200, 60, 10);
    const fewerMinutes = mk('1992-93', 1000, 50, 10);
    const moreKey = candidateKey(moreMinutes);
    const fewerKey = candidateKey(fewerMinutes);
    expect(moreKey[0]).toBe(fewerKey[0]);
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
  it('writes a valid pool, digests it, and merges the manifest sorted by key', () => {
    const root = buildStandardFixture('run');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    run([['lakers', '1990s']], false);

    const poolPath = join(root.data, 'pools', 'lakers-1990s.json');
    const written = JSON.parse(readFileSync(poolPath, 'utf8')) as Pool;
    expect(written.players).toHaveLength(6);
    expect(() => parsePool(written)).not.toThrow();

    const digest = sha256File(poolPath);
    expect(written.eligibility.minimumTeamGames).toBe(MIN_TEAM_GAMES);

    const manifest = readJson(join(root.data, 'manifest.json')) as Manifest;
    expect(manifest.dataVersion).toBe(DATA_VERSION);
    expect(
      manifest.franchiseLineage.find((l) => l.franchiseId === 'lakers')?.firstNbaSeasonKey,
    ).toBe('1948-49');
    expect(
      manifest.franchiseLineage.find((l) => l.franchiseId === 'celtics')?.firstNbaSeasonKey,
    ).toBe('1946-47');
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

  it('skips skipped pools and still updates the manifest', () => {
    const root = buildStandardFixture('run-skip');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    run([['nets', '1990s']], false);
    const manifest = readJson(join(root.data, 'manifest.json')) as Manifest;
    expect(manifest.pools).toEqual(fixtureManifest().pools);
    expect(manifest.dataVersion).toBe(DATA_VERSION);
  });
});

describe('schema fit (documented discrepancy)', () => {
  it('parsePool rejects a player whose canonical union is empty (Python emits [])', () => {
    // Python normalize_position_labels returns canonical=[] for a player whose
    // only label is "" (or whose labels are all unknown). The TS schema forbids
    // that with .min(1); computePool keeps Python's emission and the writer
    // logs the validation failure rather than dropping the player.
    const pool = computePool('lakers', '1990s', fixtureManifest(), BBREF_IDS, false) as Pool;
    const { canonical, sourceLabels } = normalizePositionLabels(new Set(['']));
    expect(canonical).toEqual([]);
    expect(sourceLabels).toEqual(['']);
    const edited = {
      ...pool,
      players: [...pool.players],
    };
    edited.players[0] = {
      ...(edited.players[0] as (typeof pool.players)[number]),
      positions: { sourceLabels, canonical, normalizationVersion: POSITION_NORMALIZATION_VERSION },
    };
    expect(() => parsePool(edited)).toThrow();
  });
});
