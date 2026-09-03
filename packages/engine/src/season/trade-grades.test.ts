import { describe, expect, it } from 'vitest';
import {
  seasonTradeGradeLogSchema,
  type SeasonCompactPlayerLine,
  type SeasonGameSummary,
  type SeasonPostseasonSummary,
  type SeasonTeamBox,
  type SeasonTradeOffer,
  type SeasonTradeState,
} from '@hoop-rush/data-contracts';
import {
  deriveSeasonTradeGrades,
  seasonTradeGradeLabelOf,
  SEASON_TRADE_GRADE_MIN_SAMPLE,
  SEASON_TRADE_GRADE_NEUTRAL_SCORE,
} from './trade-grades.ts';
import { buildEconomyTestRun } from './season-economy-test-support.ts';
const LAKERS = 'lakers';
const CELTICS = 'celtics';
function ver(n: number): string {
  return `pv-${String(n).padStart(32, '0')}`;
}
interface LineSpec {
  started?: boolean;
  seconds?: number;
  pts?: number;
  fgm?: number;
  fga?: number;
  ast?: number;
  stl?: number;
  blk?: number;
  tov?: number;
}
function line(versionId: string, spec: LineSpec = {}): SeasonCompactPlayerLine {
  const fgm = spec.fgm ?? 4;
  const fga = spec.fga ?? 9;
  return {
    playerVersionId: versionId,
    seconds: spec.seconds ?? 1440,
    started: spec.started ?? false,
    points: spec.pts ?? fgm * 2,
    fieldGoalsMade: fgm,
    fieldGoalsAttempted: fga,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 1,
    defensiveRebounds: 4,
    assists: spec.ast ?? 2,
    steals: spec.stl ?? 1,
    blocks: spec.blk ?? 1,
    turnovers: spec.tov ?? 1,
    fouls: 2,
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
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
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
function fillerOf(franchiseId: string, startIndex: number): string[] {
  return Array.from({ length: 10 }, (_, index) => ver(startIndex + index));
}
interface GameSpec {
  homeLines?: Record<string, LineSpec>;
  awayLines?: Record<string, LineSpec>;
  homeScore?: number;
  awayScore?: number;
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
      line(versionId, { started: index < 5, ...(overrides?.[versionId] ?? {}) }),
    );
  };
  const homeLines = lineupOf(homeIds, spec.homeLines);
  const awayLines = lineupOf(awayIds, spec.awayLines);
  const homeBox = boxOf(LAKERS, homeLines);
  const awayBox = boxOf(CELTICS, awayLines);
  const homeScore = spec.homeScore ?? homeBox.points + 1;
  const awayScore = spec.awayScore ?? awayBox.points;
  return {
    schemaVersion: 1,
    summaryVersion: 'season-game-summary-v3',
    gameId: `s${String(round).padStart(6, '0')}`,
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
function regularSeason(rounds: number, spec: GameSpec = {}): SeasonGameSummary[] {
  return Array.from({ length: rounds }, (_, index) => summary(index + 1, spec));
}
function postseasonSummary(gameId: string, spec: GameSpec = {}): SeasonPostseasonSummary {
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
      line(versionId, { started: index < 5, ...(overrides?.[versionId] ?? {}) }),
    );
  };
  const homeLines = lineupOf(homeIds, spec.homeLines);
  const awayLines = lineupOf(awayIds, spec.awayLines);
  const homeBox = boxOf(LAKERS, homeLines);
  const awayBox = boxOf(CELTICS, awayLines);
  const homeScore = spec.homeScore ?? homeBox.points + 1;
  const awayScore = spec.awayScore ?? awayBox.points;
  const homeWon = homeScore > awayScore;
  return {
    schemaVersion: 1,
    summaryVersion: 'postseason-summary-v1',
    runId: 'economy-test-run-1',
    gameId,
    phase: 'playoffs',
    round: 'finals',
    seriesId: 'finals',
    gameNumber: 1,
    conference: 'east',
    homeFranchiseId: LAKERS,
    awayFranchiseId: CELTICS,
    winnerFranchiseId: homeWon ? LAKERS : CELTICS,
    loserFranchiseId: homeWon ? CELTICS : LAKERS,
    status: 'final',
    homeScore,
    awayScore,
    forfeitLoserFranchiseId: null,
    homeBox,
    awayBox,
    homePlayers: homeLines,
    awayPlayers: awayLines,
    rotationEvidence: {
      home: { playersUsed: 10, substitutions: 20 },
      away: { playersUsed: 10, substitutions: 20 },
    },
    injuryEvents: [],
    resultDigest: '0'.repeat(32),
  };
}
const STAR = ver(1);
const SECOND = ver(2);
const STAR_LINE: LineSpec = {
  seconds: 2400,
  started: true,
  pts: 40,
  fgm: 20,
  fga: 28,
  ast: 8,
  stl: 2,
  blk: 1,
  tov: 2,
};
const BENCH_LINE: LineSpec = {
  seconds: 960,
  started: false,
  pts: 8,
  fgm: 3,
  fga: 8,
  ast: 1,
  tov: 1,
};
function offer(
  windowIndex: number,
  toFranchiseId: string,
  fromFranchiseId: string,
  outgoing: string[],
  incoming: string[],
  offerId = `off-${String(windowIndex).padStart(4, '0')}${'a'.repeat(28)}`,
): SeasonTradeOffer {
  return {
    offerId,
    windowIndex,
    seedPath: ['window', String(windowIndex), 'offer', '0'],
    toFranchiseId,
    fromFranchiseId,
    outgoingPlayerVersionIds: outgoing,
    incomingPlayerVersionIds: incoming,
    outgoingHealth: outgoing.map(() => ({ available: true, activeInjuryIds: [] })),
    incomingHealth: incoming.map(() => ({ available: true, activeInjuryIds: [] })),
    valueBand: { ratioBasisPoints: 1000, band: '85-115', qualified: true },
    roleFit: { outgoingRoles: ['G'], incomingRoles: ['G'], notes: 'fixture' },
    rosterNeedFacts: { outgoingDepth: 2, incomingDepth: 2, notes: 'fixture' },
    projectedRotationChanges: 'fixture',
    projectedChemistryDisruption: { removedPairs: 9, newPairs: 9 },
    status: 'accepted',
  };
}
function tradeState(windows: SeasonTradeState['windows']): SeasonTradeState {
  return { schemaVersion: 1, tradeVersion: 'season-trade-v3', windows };
}
function runWithTrade(): {
  run: ReturnType<typeof buildEconomyTestRun>['run'];
  catalog: ReturnType<typeof buildEconomyTestRun>['catalog'];
} {
  const { run, catalog } = buildEconomyTestRun();
  const trade = tradeState([
    {
      windowIndex: 0,
      blockIndex: 2,
      status: 'closed',
      offers: [offer(0, LAKERS, CELTICS, [SECOND], [STAR])],
    },
  ]);
  return { run: { ...run, trade }, catalog };
}
describe('season trade grade labels (trade-grade-v1)', () => {
  it('maps the frozen A/B/C/D/F cutoffs', () => {
    expect(seasonTradeGradeLabelOf(100)).toBe('A');
    expect(seasonTradeGradeLabelOf(80)).toBe('A');
    expect(seasonTradeGradeLabelOf(79)).toBe('B');
    expect(seasonTradeGradeLabelOf(65)).toBe('B');
    expect(seasonTradeGradeLabelOf(64)).toBe('C');
    expect(seasonTradeGradeLabelOf(45)).toBe('C');
    expect(seasonTradeGradeLabelOf(44)).toBe('D');
    expect(seasonTradeGradeLabelOf(30)).toBe('D');
    expect(seasonTradeGradeLabelOf(29)).toBe('F');
    expect(seasonTradeGradeLabelOf(0)).toBe('F');
  });
});
describe('season trade grade derivation (trade-grade-v1)', () => {
  it('grades both sides of an accepted trade from recorded post-trade games', () => {
    const { run } = runWithTrade();
    const summaries = [
      ...regularSeason(30),
      ...regularSeason(52, { homeLines: { [STAR]: STAR_LINE } }),
    ];
    const grades = deriveSeasonTradeGrades({
      runId: run.runId,
      run,
      summaries,
      postseasonSummaries: [
        postseasonSummary('po-finals-g1', { homeLines: { [STAR]: STAR_LINE } }),
      ],
    });
    expect(grades.grades).toHaveLength(2);
    const lakers = grades.grades.find((grade) => grade.franchiseId === LAKERS);
    const celtics = grades.grades.find((grade) => grade.franchiseId === CELTICS);
    expect(lakers).toBeDefined();
    expect(celtics).toBeDefined();
    expect(lakers?.components.production ?? 0).toBeGreaterThan(
      celtics?.components.production ?? 100,
    );
    expect(lakers?.neutral).toBe(false);
    expect(lakers?.sample).toBeGreaterThanOrEqual(SEASON_TRADE_GRADE_MIN_SAMPLE);
    expect(lakers?.receivedPlayerVersionIds).toEqual([STAR]);
    expect(lakers?.sentPlayerVersionIds).toEqual([SECOND]);
    expect(() => seasonTradeGradeLogSchema.parse(grades)).not.toThrow();
    expect(grades.digest).toMatch(/^[0-9a-f]{32}$/);
  });
  it.each([
    [34, 4],
    [0, 0],
  ] as const)(
    'grades neutral below the five-game floor with %s post-trade games',
    (rounds, expectedSample) => {
      const { run } = runWithTrade();
      const grades = deriveSeasonTradeGrades({
        runId: run.runId,
        run,
        summaries: rounds === 0 ? [] : regularSeason(rounds),
        postseasonSummaries: [],
      });
      expect(grades.grades).toHaveLength(2);
      for (const grade of grades.grades) {
        expect(grade.neutral).toBe(true);
        expect(grade.sample).toBe(expectedSample);
        expect(grade.score).toBe(SEASON_TRADE_GRADE_NEUTRAL_SCORE);
        expect(grade.label).toBe('C');
        expect(grade.reasons[0]).toContain('neutral grade');
      }
    },
  );
  it('returns an empty log for a run without trade state', () => {
    const { run } = buildEconomyTestRun();
    const grades = deriveSeasonTradeGrades({
      runId: run.runId,
      run,
      summaries: regularSeason(82),
      postseasonSummaries: [],
    });
    expect(grades.grades).toHaveLength(0);
    expect(() => seasonTradeGradeLogSchema.parse(grades)).not.toThrow();
  });
  it('ignores declined, expired, and open offers', () => {
    const { run } = buildEconomyTestRun();
    const trade = tradeState([
      {
        windowIndex: 0,
        blockIndex: 2,
        status: 'closed',
        offers: [
          { ...offer(0, LAKERS, CELTICS, [SECOND], [STAR]), status: 'declined' },
          { ...offer(0, CELTICS, LAKERS, [STAR], [SECOND]), status: 'expired' },
          { ...offer(0, LAKERS, CELTICS, [SECOND], [STAR]), status: 'open' },
        ],
      },
    ]);
    const grades = deriveSeasonTradeGrades({
      runId: run.runId,
      run: { ...run, trade },
      summaries: regularSeason(82),
      postseasonSummaries: [],
    });
    expect(grades.grades).toHaveLength(0);
  });
  it('handles a player traded twice across windows without double counting', () => {
    const { run } = buildEconomyTestRun();
    const filler = ver(90);
    const trade = tradeState([
      {
        windowIndex: 0,
        blockIndex: 2,
        status: 'closed',
        offers: [offer(0, LAKERS, CELTICS, [SECOND], [STAR])],
      },
      {
        windowIndex: 1,
        blockIndex: 4,
        status: 'closed',
        offers: [offer(1, LAKERS, CELTICS, [STAR], [filler], `off-1${'b'.repeat(31)}`)],
      },
    ]);
    const summaries = regularSeason(82, { homeLines: { [STAR]: STAR_LINE } });
    const grades = deriveSeasonTradeGrades({
      runId: run.runId,
      run: { ...run, trade },
      summaries,
      postseasonSummaries: [],
    });
    expect(grades.grades).toHaveLength(4);
    const windowZero = grades.grades.filter((grade) => grade.windowIndex === 0);
    const windowOne = grades.grades.filter((grade) => grade.windowIndex === 1);
    expect(windowZero).toHaveLength(2);
    expect(windowOne).toHaveLength(2);
    const lakersWindowOne = windowOne.find((grade) => grade.franchiseId === LAKERS);
    const celticsWindowOne = windowOne.find((grade) => grade.franchiseId === CELTICS);
    expect(celticsWindowOne?.components.production ?? 0).toBeGreaterThan(
      lakersWindowOne?.components.production ?? 100,
    );
  });
  it('is deterministic: identical inputs, identical bytes and digest', () => {
    const { run } = runWithTrade();
    const summaries = regularSeason(82, { homeLines: { [STAR]: STAR_LINE } });
    const postseason = [
      postseasonSummary('po-finals-g1', { homeLines: { [STAR]: STAR_LINE } }),
      postseasonSummary('po-finals-g2'),
    ];
    const first = deriveSeasonTradeGrades({
      runId: run.runId,
      run,
      summaries,
      postseasonSummaries: postseason,
    });
    const second = deriveSeasonTradeGrades({
      runId: run.runId,
      run,
      summaries,
      postseasonSummaries: postseason,
    });
    expect(second).toEqual(first);
    expect(second.digest).toBe(first.digest);
    const reordered = deriveSeasonTradeGrades({
      runId: run.runId,
      run,
      summaries,
      postseasonSummaries: [
        postseason[1] as SeasonPostseasonSummary,
        postseason[0] as SeasonPostseasonSummary,
      ],
    });
    expect(reordered.digest).toBe(first.digest);
  });
  it('credits the received side when production is realized through the champion', () => {
    const { run } = runWithTrade();
    const summaries = [
      ...regularSeason(30),
      ...regularSeason(52, {
        homeLines: { [STAR]: STAR_LINE },
        awayLines: { [SECOND]: BENCH_LINE },
      }),
    ];
    const postseason = Array.from({ length: 4 }, (_, index) =>
      postseasonSummary(`po-finals-g${String(index + 1)}`, {
        homeLines: { [STAR]: STAR_LINE },
        awayLines: { [SECOND]: BENCH_LINE },
      }),
    );
    const grades = deriveSeasonTradeGrades({
      runId: run.runId,
      run,
      summaries,
      postseasonSummaries: postseason,
    });
    const lakers = grades.grades.find((grade) => grade.franchiseId === LAKERS);
    expect(lakers).toBeDefined();
    expect(lakers?.components.production).toBeGreaterThanOrEqual(90);
    expect(lakers?.label).toBe('A');
    const productionReason = lakers?.reasons.find((reason) =>
      reason.startsWith('received production'),
    );
    expect(productionReason).toBeDefined();
  });
});
