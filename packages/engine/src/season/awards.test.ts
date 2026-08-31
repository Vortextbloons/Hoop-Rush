import { describe, expect, it } from 'vitest';
import {
  seasonAwardsDigest,
  seasonAwardsSchema,
  type SeasonCompactPlayerLine,
  type SeasonGameSummary,
  type SeasonRoster,
  type SeasonTeamBox,
} from '@hoop-rush/data-contracts';
import { deriveSeasonAwards } from './awards.ts';
function ver(n: number): string {
  return `pv-${String(n).padStart(32, '0')}`;
}
interface LineSpec {
  started?: boolean;
  seconds?: number;
  pts?: number;
  fgm?: number;
  fga?: number;
  ftm?: number;
  fta?: number;
  orb?: number;
  drb?: number;
  ast?: number;
  stl?: number;
  blk?: number;
  tov?: number;
  pf?: number;
}
function line(versionId: string, spec: LineSpec = {}): SeasonCompactPlayerLine {
  const fgm = spec.fgm ?? 4;
  const fga = spec.fga ?? 9;
  const ftm = spec.ftm ?? 2;
  const fta = spec.fta ?? 3;
  return {
    playerVersionId: versionId,
    seconds: spec.seconds ?? 1440,
    started: spec.started ?? false,
    points: spec.pts ?? fgm * 2 + ftm,
    fieldGoalsMade: fgm,
    fieldGoalsAttempted: fga,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: ftm,
    freeThrowsAttempted: fta,
    offensiveRebounds: spec.orb ?? 1,
    defensiveRebounds: spec.drb ?? 4,
    assists: spec.ast ?? 2,
    steals: spec.stl ?? 1,
    blocks: spec.blk ?? 1,
    turnovers: spec.tov ?? 1,
    fouls: spec.pf ?? 2,
  };
}
function boxOf(franchiseId: string, lines: readonly SeasonCompactPlayerLine[]): SeasonTeamBox {
  const sum = (pick: (entry: SeasonCompactPlayerLine) => number) =>
    lines.reduce((total, entry) => total + pick(entry), 0);
  return {
    franchiseId,
    points: sum((entry) => entry.points),
    fieldGoalsMade: sum((entry) => entry.fieldGoalsMade),
    fieldGoalsAttempted: sum((entry) => entry.fieldGoalsAttempted),
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: sum((entry) => entry.freeThrowsMade),
    freeThrowsAttempted: sum((entry) => entry.freeThrowsAttempted),
    offensiveRebounds: sum((entry) => entry.offensiveRebounds),
    defensiveRebounds: sum((entry) => entry.defensiveRebounds),
    assists: sum((entry) => entry.assists),
    steals: sum((entry) => entry.steals),
    blocks: sum((entry) => entry.blocks),
    turnovers: sum((entry) => entry.turnovers),
    fouls: sum((entry) => entry.fouls),
    possessions: 100,
  };
}
const LAKERS = 'lakers';
const CELTICS = 'celtics';
function fillerOf(franchiseId: string, startIndex: number): string[] {
  return Array.from({ length: 10 }, (_, index) => ver(startIndex + index));
}
function rostersOf(): SeasonRoster[] {
  const entry = (franchiseId: string, versionId: string, index: number) => ({
    playerVersionId: versionId,
    playerId: `p-${franchiseId}-${String(index)}`,
    franchiseId,
    eraId: 'modern',
    seasonKey: '2024-25',
    displayName: `Player ${versionId.slice(-4)}`,
  });
  return [LAKERS, CELTICS].map((franchiseId, teamIndex) => ({
    franchiseId,
    players: fillerOf(franchiseId, teamIndex === 0 ? 50 : 70).map((versionId, index) =>
      entry(franchiseId, versionId, index),
    ),
  }));
}
interface GameSpec {
  homeLines?: Record<string, LineSpec>;
  awayLines?: Record<string, LineSpec>;
  homeScore?: number;
  awayScore?: number;
  forfeit?: boolean;
}
function summary(round: number, spec: GameSpec = {}): SeasonGameSummary {
  const homeIds = fillerOf(LAKERS, 50);
  const awayIds = fillerOf(CELTICS, 70);
  const lineupOf = (
    filler: string[],
    overrides?: Record<string, LineSpec>,
  ): SeasonCompactPlayerLine[] => {
    const ids = [...(overrides !== undefined ? Object.keys(overrides) : []), ...filler]
      .filter((id, index, all) => all.indexOf(id) === index)
      .slice(0, 10);
    return ids.map((versionId, index) =>
      line(versionId, {
        started: index < 5,
        ...(overrides?.[versionId] ?? {}),
      }),
    );
  };
  const homeLines = lineupOf(homeIds, spec.homeLines);
  const awayLines = lineupOf(awayIds, spec.awayLines);
  const homeBox = boxOf(LAKERS, homeLines);
  const awayBox = boxOf(CELTICS, awayLines);
  const homeScore = spec.homeScore ?? homeBox.points + 1;
  const awayScore = spec.awayScore ?? awayBox.points;
  if (homeScore === awayScore) {
    throw new Error('fixture game cannot be tied');
  }
  const gameId = `s${String(round).padStart(6, '0')}`;
  if (spec.forfeit === true) {
    return {
      schemaVersion: 1,
      summaryVersion: 'season-game-summary-v3',
      gameId,
      round,
      homeFranchiseId: LAKERS,
      awayFranchiseId: CELTICS,
      status: 'forfeit',
      overtimePeriods: 0,
      homeScore: 2,
      awayScore: 0,
      forfeitLoserFranchiseId: CELTICS,
      homeBox: { ...homeBox, points: 0 },
      awayBox: { ...awayBox, points: 0 },
      homePlayers: [],
      awayPlayers: [],
      injuryEvents: [],
    };
  }
  return {
    schemaVersion: 1,
    summaryVersion: 'season-game-summary-v3',
    gameId,
    round,
    homeFranchiseId: LAKERS,
    awayFranchiseId: CELTICS,
    status: 'final',
    overtimePeriods: 0,
    homeScore,
    awayScore,
    forfeitLoserFranchiseId: null,
    homeBox,
    awayBox,
    homePlayers: homeLines,
    awayPlayers: awayLines,
    injuryEvents: [],
  };
}
function games(count: number, spec: GameSpec = {}): SeasonGameSummary[] {
  return Array.from({ length: count }, (_, index) => summary(index + 1, spec));
}
const STAR = ver(1);
const SECOND = ver(2);
const STAR_LINE: LineSpec = {
  seconds: 2400,
  started: true,
  pts: 40,
  fgm: 20,
  fga: 28,
  ftm: 0,
  fta: 0,
  orb: 2,
  drb: 8,
  ast: 8,
  stl: 2,
  blk: 1,
  tov: 2,
  pf: 2,
};
describe('season awards derivation (M2.6, awards-v1)', () => {
  it('selects the dominant star as MVP and reports its franchise', () => {
    const rosters = rostersOf();
    const spec: GameSpec = {
      homeLines: { [STAR]: STAR_LINE },
      awayLines: { [SECOND]: { seconds: 2400, started: true, pts: 25, fgm: 11, fga: 22 } },
    };
    const awards = deriveSeasonAwards({ runId: 'run-1', rosters, summaries: games(10, spec) });
    expect(awards.mvp.playerVersionId).toBe(STAR);
    expect(awards.mvp.franchiseId).toBe(LAKERS);
    expect(() => seasonAwardsSchema.parse(awards)).not.toThrow();
  });
  it('rewards efficiency: identical volume with better true shooting wins', () => {
    const rosters = rostersOf();
    const efficient = ver(3);
    const inefficient = ver(4);
    const spec: GameSpec = {
      homeLines: {
        [efficient]: { seconds: 2400, started: true, pts: 20, fgm: 10, fga: 10, tov: 1 },
        [inefficient]: { seconds: 2400, started: true, pts: 20, fgm: 10, fga: 20, tov: 1 },
      },
    };
    const awards = deriveSeasonAwards({ runId: 'run-1', rosters, summaries: games(10, spec) });
    expect(awards.mvp.playerVersionId).toBe(efficient);
  });
  it('never counts zero-second lines as appearances', () => {
    const rosters = rostersOf();
    const zeroMinutes = ver(5);
    const spec: GameSpec = {
      homeLines: {
        [STAR]: STAR_LINE,
        [zeroMinutes]: { seconds: 0, started: false, pts: 0, fgm: 0, fga: 0 },
      },
    };
    const awards = deriveSeasonAwards({ runId: 'run-1', rosters, summaries: games(10, spec) });
    expect(awards.mvp.playerVersionId).toBe(STAR);
    expect(awards.allLeagueFirstTeam.some((entry) => entry.playerVersionId === zeroMinutes)).toBe(
      false,
    );
  });
  it('counts starts only from the actual opening unit', () => {
    const rosters = rostersOf();
    const started = ver(6);
    const benched = ver(7);
    const spec: GameSpec = {
      homeLines: {
        [started]: { seconds: 2400, started: true, pts: 20, fgm: 10, fga: 20 },
        [benched]: { seconds: 2400, started: false, pts: 20, fgm: 10, fga: 20 },
      },
    };
    const awards = deriveSeasonAwards({ runId: 'run-1', rosters, summaries: games(10, spec) });
    expect(awards.sixthManOfYear.playerVersionId).toBe(benched);
    expect(awards.sixthManOfYear.franchiseId).toBe(LAKERS);
  });
  it('aggregates traded players by version with the most-appearance franchise', () => {
    const rosters = rostersOf();
    const traded = ver(8);
    const spec: GameSpec = {
      homeLines: { [traded]: STAR_LINE },
    };
    const summaries = [
      ...Array.from({ length: 6 }, (_, index) => summary(index + 1, spec)),
      ...Array.from({ length: 4 }, (_, index) =>
        summary(index + 7, { awayLines: { [traded]: STAR_LINE } }),
      ),
    ];
    const awards = deriveSeasonAwards({ runId: 'run-1', rosters, summaries });
    expect(awards.mvp.playerVersionId).toBe(traded);
    expect(awards.mvp.franchiseId).toBe(LAKERS);
  });
  it('breaks traded-player franchise ties by starts then franchise id', () => {
    const rosters = rostersOf();
    const traded = ver(9);
    const fiveFive: GameSpec = {
      homeLines: { [traded]: STAR_LINE },
      awayLines: { [traded]: { ...STAR_LINE, started: true } },
    };
    const summaries = [
      ...Array.from({ length: 5 }, (_, index) => summary(index + 1, fiveFive)),
      ...Array.from({ length: 5 }, (_, index) =>
        summary(index + 6, {
          ...fiveFive,
          awayLines: { [traded]: { ...STAR_LINE, started: false } },
        }),
      ),
    ];
    const awards = deriveSeasonAwards({ runId: 'run-1', rosters, summaries });
    expect(awards.mvp.playerVersionId).toBe(traded);
    expect(awards.mvp.franchiseId).toBe(LAKERS);
  });
  it('enforces the 70% appearance gate at the exact boundary', () => {
    const rosters = rostersOf();
    const full = ver(10);
    const partial = ver(11);
    const spec: GameSpec = {
      homeLines: { [full]: { seconds: 2400, started: true, pts: 30, fgm: 15, fga: 28 } },
      awayLines: { [partial]: { seconds: 2400, started: true, pts: 45, fgm: 20, fga: 30 } },
    };
    const summaries = [
      ...Array.from({ length: 6 }, (_, index) => summary(index + 1, spec)),
      summary(7, {
        homeLines: { [full]: { seconds: 2400, started: true, pts: 30, fgm: 15, fga: 28 } },
      }),
      ...Array.from({ length: 3 }, (_, index) => summary(index + 8, {})),
    ];
    const awards = deriveSeasonAwards({ runId: 'run-1', rosters, summaries });
    expect(awards.mvp.playerVersionId).toBe(full);
  });
  it('applies the availability factor to identical per-game production', () => {
    const rosters = rostersOf();
    const full = ver(12);
    const reduced = ver(13);
    const lineSpec: LineSpec = { seconds: 2400, started: true, pts: 30, fgm: 14, fga: 26 };
    const both: GameSpec = { homeLines: { [full]: lineSpec, [reduced]: lineSpec } };
    const summaries = [
      ...Array.from({ length: 7 }, (_, index) => summary(index + 1, both)),
      ...Array.from({ length: 3 }, (_, index) =>
        summary(index + 8, { homeLines: { [full]: lineSpec } }),
      ),
    ];
    const awards = deriveSeasonAwards({ runId: 'run-1', rosters, summaries });
    expect(awards.mvp.playerVersionId).toBe(full);
  });
  it('awards DPOY for steals, blocks, defensive rebounds, and minutes', () => {
    const rosters = rostersOf();
    const stopper = ver(14);
    const scorer = ver(15);
    const spec: GameSpec = {
      homeLines: {
        [stopper]: {
          seconds: 2400,
          started: true,
          pts: 12,
          fgm: 5,
          fga: 12,
          stl: 4,
          blk: 3,
          drb: 9,
        },
        [scorer]: {
          seconds: 2400,
          started: true,
          pts: 35,
          fgm: 15,
          fga: 26,
          stl: 1,
          blk: 1,
          drb: 4,
        },
      },
    };
    const awards = deriveSeasonAwards({ runId: 'run-1', rosters, summaries: games(10, spec) });
    expect(awards.defensivePlayerOfYear.playerVersionId).toBe(stopper);
  });
  it('breaks award ties by unrounded score, primary component, seconds, then id', () => {
    const rosters = rostersOf();
    const a = ver(16);
    const b = ver(17);
    const identical: LineSpec = { seconds: 2400, started: true, pts: 25, fgm: 12, fga: 24 };
    const spec: GameSpec = { homeLines: { [a]: identical, [b]: identical } };
    const awards = deriveSeasonAwards({ runId: 'run-1', rosters, summaries: games(10, spec) });
    expect(awards.mvp.playerVersionId).toBe(a);
    const c = ver(18);
    const moreMinutes: LineSpec = { seconds: 2880, started: true, pts: 25, fgm: 12, fga: 24 };
    const spec2: GameSpec = { homeLines: { [a]: identical, [c]: moreMinutes } };
    const awards2 = deriveSeasonAwards({ runId: 'run-1', rosters, summaries: games(10, spec2) });
    expect(awards2.mvp.playerVersionId).toBe(c);
  });
  it('derives awards from exactly the passed regular-season summaries', () => {
    const rosters = rostersOf();
    const spec: GameSpec = { homeLines: { [STAR]: STAR_LINE } };
    const summaries = games(10, spec);
    const first = deriveSeasonAwards({ runId: 'run-1', rosters, summaries });
    const shuffled = [...summaries].reverse();
    const second = deriveSeasonAwards({ runId: 'run-1', rosters, summaries: shuffled });
    expect(second).toEqual(first);
    const withForfeit = [...summaries.slice(0, 9), summary(10, { forfeit: true })];
    const third = deriveSeasonAwards({ runId: 'run-1', rosters, summaries: withForfeit });
    expect(third.mvp.playerVersionId).toBe(STAR);
  });
  it('drops the eligibility gate when nobody qualifies, excluding zero-appearance players', () => {
    const rosters = rostersOf();
    const best = ver(19);
    const zeroMinutes = ver(20);
    const spec: GameSpec = {
      homeLines: {
        [best]: { seconds: 2400, started: true, pts: 30, fgm: 14, fga: 26 },
        [zeroMinutes]: { seconds: 0, started: false },
      },
    };
    const summaries = games(3, spec);
    const awards = deriveSeasonAwards({ runId: 'run-1', rosters, summaries });
    expect(awards.mvp.playerVersionId).toBe(best);
    expect(awards.allLeagueFirstTeam.some((entry) => entry.playerVersionId === zeroMinutes)).toBe(
      false,
    );
  });
  it('produces a self-consistent deterministic digest that tracks recipients', () => {
    const rosters = rostersOf();
    const spec: GameSpec = { homeLines: { [STAR]: STAR_LINE } };
    const awards = deriveSeasonAwards({ runId: 'run-1', rosters, summaries: games(10, spec) });
    expect(awards.digest).toMatch(/^[0-9a-f]{32}$/);
    expect(awards.digest).toBe(seasonAwardsDigest(awards));
    expect(deriveSeasonAwards({ runId: 'run-1', rosters, summaries: games(10, spec) })).toEqual(
      awards,
    );
    const different: GameSpec = { homeLines: { [SECOND]: STAR_LINE } };
    const other = deriveSeasonAwards({ runId: 'run-1', rosters, summaries: games(10, different) });
    expect(other.digest).not.toBe(awards.digest);
    expect(seasonAwardsDigest({ ...awards, digest: 'f'.repeat(32) })).toBe(awards.digest);
  });
  it('selects five distinct All-League First Team recipients', () => {
    const rosters = rostersOf();
    const spec: GameSpec = {
      homeLines: {
        [ver(21)]: STAR_LINE,
        [ver(22)]: { seconds: 2400, started: true, pts: 32, fgm: 15, fga: 27 },
        [ver(23)]: { seconds: 2400, started: true, pts: 28, fgm: 13, fga: 25 },
        [ver(24)]: { seconds: 2400, started: true, pts: 26, fgm: 12, fga: 24 },
        [ver(25)]: { seconds: 2400, started: true, pts: 24, fgm: 11, fga: 23 },
        [ver(26)]: { seconds: 2400, started: true, pts: 22, fgm: 10, fga: 22 },
      },
    };
    const awards = deriveSeasonAwards({ runId: 'run-1', rosters, summaries: games(10, spec) });
    expect(awards.allLeagueFirstTeam).toHaveLength(5);
    const ids = awards.allLeagueFirstTeam.map((entry) => entry.playerVersionId);
    expect(new Set(ids).size).toBe(5);
    expect(ids).not.toContain(ver(26));
  });
});
