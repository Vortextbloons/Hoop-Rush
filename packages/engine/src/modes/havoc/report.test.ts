import { describe, expect, it } from 'vitest';
import type {
  HavocGameResult,
  HavocLockedInputs,
  HavocMutationRollup,
  HavocParticipant,
  HavocParticipantLine,
  HavocRunState,
  HavocStatLine,
  HavocTeamResult,
} from '@hoop-rush/data-contracts';
import {
  canonicalJson,
  havocGameResultSchema,
  havocGameSeed,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';
import { buildHavocLockedInputs, buildHavocRunStateLocked } from '@hoop-rush/test-fixtures';
import type { HavocStoredGame } from './api.ts';
import { compareHavocSeasons, havocSeasonTotalsOf } from './comparison.ts';
import { havocGameResultDigest } from './digests.ts';
import { deriveHavocReport } from './report.ts';

const GAME_COUNT = 82;

function zeroLine(): HavocStatLine {
  return {
    secondsPlayed: 0,
    minutes: 0,
    points: 0,
    fieldGoals: { made: 0, attempted: 0 },
    threes: { made: 0, attempted: 0 },
    freeThrows: { made: 0, attempted: 0 },
    rebounds: { total: 0, offensive: 0, defensive: 0 },
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    chargedFouls: 0,
    adjustments: 0,
  };
}

function lineFor(participant: HavocParticipant): HavocParticipantLine {
  return {
    instanceId: participant.instanceId,
    kind: participant.kind,
    slot: participant.slot,
    ownerInstanceId: participant.ownerInstanceId,
    sourcePlayerId: participant.source.playerId,
    sourcePlayerVersionId: participant.source.playerVersionId,
    displayName: participant.source.displayName,
    ...zeroLine(),
  };
}

interface SyntheticSpec {
  humanScore: number;
  opponentScore: number;
  humanAdjustments?: number;
  rollups?: HavocMutationRollup[];
}

function syntheticStoredGame(
  locked: HavocLockedInputs,
  gameNumber: number,
  variant: 'havoc' | 'normal',
  spec: SyntheticSpec,
): HavocStoredGame {
  const entry = locked.schedule[gameNumber - 1];
  if (entry === undefined) throw new Error('test: missing schedule entry');
  const humanSide = entry.humanHome ? 'home' : 'away';
  const opponent = locked.opponents.find((candidate) => candidate.opponentId === entry.opponentId);
  if (opponent === undefined) throw new Error('test: unknown opponent');
  const humanTeam: HavocTeamResult = {
    side: humanSide,
    teamId: locked.human.teamId,
    displayName: locked.human.displayName,
    points: spec.humanScore,
    fieldGoals: { made: 0, attempted: 0 },
    threes: { made: 0, attempted: 0 },
    freeThrows: { made: 0, attempted: 0 },
    rebounds: { total: 0, offensive: 0, defensive: 0, team: 0 },
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    adjustments: spec.humanAdjustments ?? 0,
    periods: [spec.humanScore, 0, 0, 0],
    courtSeconds: 5 * 48 * 60,
    participants: locked.human.starters.map(lineFor),
  };
  const opponentTeam: HavocTeamResult = {
    side: humanSide === 'home' ? 'away' : 'home',
    teamId: opponent.team.teamId,
    displayName: opponent.team.displayName,
    points: spec.opponentScore,
    fieldGoals: { made: 0, attempted: 0 },
    threes: { made: 0, attempted: 0 },
    freeThrows: { made: 0, attempted: 0 },
    rebounds: { total: 0, offensive: 0, defensive: 0, team: 0 },
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    adjustments: 0,
    periods: [spec.opponentScore, 0, 0, 0],
    courtSeconds: 5 * 48 * 60,
    participants: opponent.team.starters.map(lineFor),
  };
  const result: HavocGameResult = havocGameResultSchema.parse({
    schemaVersion: 1,
    gameNumber,
    variant,
    seed: havocGameSeed(locked.runSeed, gameNumber),
    engineVersion: 'm3-engine-v24',
    rulesVersion: 'havoc-rules-v4',
    mutationCatalogVersion: 'havoc-mutations-v4',
    profileVersion: locked.profile.profileVersion,
    dataVersion: locked.versionSet.dataVersion,
    humanSide,
    home: humanSide === 'home' ? humanTeam : opponentTeam,
    away: humanSide === 'home' ? opponentTeam : humanTeam,
    winner:
      spec.humanScore > spec.opponentScore ? humanSide : humanSide === 'home' ? 'away' : 'home',
    overtimePeriods: 0,
    inputDigest: 'b'.repeat(32),
    rollups: spec.rollups ?? [],
    highlights: [],
  });
  return { gameNumber, result, resultDigest: havocGameResultDigest(result) };
}

function buildStoredSet(
  locked: HavocLockedInputs,
  variant: 'havoc' | 'normal',
  specFor: (gameNumber: number) => SyntheticSpec,
  count = GAME_COUNT,
): HavocStoredGame[] {
  return Array.from({ length: count }, (_value, index) =>
    syntheticStoredGame(locked, index + 1, variant, specFor(index + 1)),
  );
}

function rollup(
  mutationId: HavocMutationRollup['mutationId'],
  ownerInstanceId: string,
  overrides: Partial<HavocMutationRollup> = {},
): HavocMutationRollup {
  return {
    ownerInstanceId,
    mutationId,
    side: 'human',
    triggers: 0,
    pointsDelta: 0,
    freeThrowsGranted: 0,
    turnoversCancelled: 0,
    extraPossessionsEarned: 0,
    extraPossessionsUsed: 0,
    extraPossessionsExpired: 0,
    swapSeconds: 0,
    capSeconds: 0,
    activeSeconds: 0,
    ...overrides,
  };
}

function aggregateOf(games: readonly HavocStoredGame[]) {
  const totals = havocSeasonTotalsOf(games);
  return {
    games: totals.games,
    wins: totals.wins,
    losses: totals.losses,
    pointsFor: totals.pointsFor,
    pointsAgainst: totals.pointsAgainst,
    adjustments: totals.adjustments,
  };
}

function stateFor(
  locked: HavocLockedInputs,
  havocGames: readonly HavocStoredGame[],
  normalGames: readonly HavocStoredGame[],
  overrides: Partial<HavocRunState> = {},
): HavocRunState {
  const havocTotals = havocSeasonTotalsOf(havocGames);
  return buildHavocRunStateLocked({
    locked,
    havocCursor: havocGames.length,
    normalCursor: normalGames.length,
    havocAggregate: aggregateOf(havocGames),
    normalAggregate: aggregateOf(normalGames),
    perfectSeason: havocTotals.games === GAME_COUNT && havocTotals.losses === 0,
    ...overrides,
  });
}

describe('deriveHavocReport pending comparison', () => {
  it('reports havoc-only data while the comparison is pending', () => {
    const locked = buildHavocLockedInputs();
    const havocGames = buildStoredSet(locked, 'havoc', (gameNumber) =>
      gameNumber === 1
        ? { humanScore: 90, opponentScore: 100, humanAdjustments: -4 }
        : { humanScore: 100, opponentScore: 90, humanAdjustments: 2 },
    );
    const state = stateFor(locked, havocGames, []);
    const report = deriveHavocReport({
      state,
      havocGames,
      normalGames: [],
      comparison: null,
    });
    expect(report.status).toBe('comparison-pending');
    expect(report.normal).toBeNull();
    expect(report.mvp).toBeNull();
    expect(report.comparison).toBeNull();
    // Documented choice: paired differences need the normal season, so the
    // pending report carries empty gain/loss lists instead of fabricated data.
    expect(report.topGains).toEqual([]);
    expect(report.topLosses).toEqual([]);
    expect(report.havoc).toEqual(havocSeasonTotalsOf(havocGames));
    expect(report.havoc.wins).toBe(81);
    expect(report.havoc.losses).toBe(1);
    expect(report.perfectSeason).toBe(false);
    expect(report.lineup).toHaveLength(5);
    expect(report.lineup.map((entry) => entry.slot)).toEqual(['PG', 'SG', 'SF', 'PF', 'C']);
    for (const entry of report.lineup) {
      expect(entry.nickname.length).toBeGreaterThan(0);
      expect(entry.mutations.length).toBeGreaterThanOrEqual(1);
      expect([1, 2, 3]).toContain(entry.tier);
    }
  });

  it('derives wildest games and direct mutation points from havoc games alone', () => {
    const locked = buildHavocLockedInputs();
    const owner = locked.human.starters[0]?.instanceId ?? '';
    const margins = new Map<number, number>([
      [1, 30],
      [2, 20],
      [3, 10],
      [4, 5],
      [5, 1],
      [6, 25],
    ]);
    const havocGames = buildStoredSet(locked, 'havoc', (gameNumber) => {
      const margin = margins.get(gameNumber) ?? 0;
      return {
        humanScore: 100 + margin,
        opponentScore: 90,
        humanAdjustments: margin,
        rollups: [rollup('four-point-dunk', owner, { triggers: 1, pointsDelta: 2 })],
      };
    });
    const state = stateFor(locked, havocGames, []);
    const report = deriveHavocReport({
      state,
      havocGames,
      normalGames: [],
      comparison: null,
    });
    expect(report.wildestGames.map((game) => game.gameNumber)).toEqual([1, 6, 2, 3, 4]);
    expect(report.wildestGames.map((game) => game.absoluteMargin)).toEqual([40, 35, 30, 20, 15]);
    expect(report.wildestGames[0]?.adjustments).toBe(30);
    expect(report.wildestGames[0]?.opponentId).toBe(locked.schedule[0]?.opponentId);
    expect(report.directMutationPoints).toBe(82 * 2);
    expect(report.directMutationPoints).not.toBe(report.havoc.pointsFor - 82 * 90);
  });

  it('reports a mid-season run with fewer stored games', () => {
    const locked = buildHavocLockedInputs();
    const havocGames = buildStoredSet(
      locked,
      'havoc',
      () => ({
        humanScore: 100,
        opponentScore: 90,
      }),
      10,
    );
    const state = stateFor(locked, havocGames, []);
    const report = deriveHavocReport({
      state,
      havocGames,
      normalGames: [],
      comparison: null,
    });
    expect(report.havoc.games).toBe(10);
    expect(report.havoc.wins).toBe(10);
    expect(report.perfectSeason).toBe(false);
    expect(report.wildestGames).toHaveLength(5);
  });
});

describe('deriveHavocReport complete comparison', () => {
  it('embeds the comparison, normal totals, MVP, and ranked differences', () => {
    const locked = buildHavocLockedInputs();
    const havocGames = buildStoredSet(locked, 'havoc', (gameNumber) =>
      gameNumber <= 41
        ? { humanScore: 100, opponentScore: 90 }
        : { humanScore: 90, opponentScore: 100 },
    );
    const normalGames = buildStoredSet(locked, 'normal', () => ({
      humanScore: 100,
      opponentScore: 90,
    }));
    const comparison = compareHavocSeasons({
      runId: locked.runId,
      locked,
      havocGames,
      normalGames,
    });
    const state = stateFor(locked, havocGames, normalGames, {
      comparisonStatus: 'complete',
      completionState: 'complete',
    });
    const report = deriveHavocReport({
      state,
      havocGames,
      normalGames,
      comparison,
    });
    expect(report.status).toBe('complete');
    expect(report.normal).toEqual(comparison.normal);
    expect(report.mvp).toEqual(comparison.mvp);
    expect(report.comparison).toEqual(comparison);
    expect(report.topGains).toEqual(comparison.largestPositiveDifferences);
    expect(report.topLosses).toEqual(comparison.largestNegativeDifferences);
    expect(report.havoc).toEqual(comparison.havoc);
  });

  it('accepts a comparison without re-supplied normal games', () => {
    const locked = buildHavocLockedInputs();
    const havocGames = buildStoredSet(locked, 'havoc', () => ({
      humanScore: 100,
      opponentScore: 90,
    }));
    const normalGames = buildStoredSet(locked, 'normal', () => ({
      humanScore: 95,
      opponentScore: 90,
    }));
    const comparison = compareHavocSeasons({
      runId: locked.runId,
      locked,
      havocGames,
      normalGames,
    });
    const state = stateFor(locked, havocGames, normalGames, {
      comparisonStatus: 'complete',
      completionState: 'complete',
    });
    const report = deriveHavocReport({ state, havocGames, normalGames: [], comparison });
    expect(report.status).toBe('complete');
    expect(report.normal).toEqual(comparison.normal);
  });
});

describe('deriveHavocReport consistency guards', () => {
  it('throws when the state aggregate disagrees with the stored games', () => {
    const locked = buildHavocLockedInputs();
    const havocGames = buildStoredSet(locked, 'havoc', () => ({
      humanScore: 100,
      opponentScore: 90,
    }));
    const state = stateFor(locked, havocGames, []);
    const corrupted: HavocRunState = {
      ...state,
      havocAggregate: { ...state.havocAggregate, wins: state.havocAggregate.wins - 1, losses: 1 },
    };
    expect(() =>
      deriveHavocReport({ state: corrupted, havocGames, normalGames: [], comparison: null }),
    ).toThrow(/aggregate does not reconcile/);
  });

  it('throws when the perfect-season flag disagrees with the record', () => {
    const locked = buildHavocLockedInputs();
    const havocGames = buildStoredSet(locked, 'havoc', () => ({
      humanScore: 100,
      opponentScore: 90,
    }));
    const state = stateFor(locked, havocGames, []);
    const corrupted: HavocRunState = { ...state, perfectSeason: false };
    expect(() =>
      deriveHavocReport({ state: corrupted, havocGames, normalGames: [], comparison: null }),
    ).toThrow(/perfect-season/);
  });

  it('throws when the comparison belongs to another run', () => {
    const locked = buildHavocLockedInputs();
    const havocGames = buildStoredSet(locked, 'havoc', () => ({
      humanScore: 100,
      opponentScore: 90,
    }));
    const normalGames = buildStoredSet(locked, 'normal', () => ({
      humanScore: 100,
      opponentScore: 90,
    }));
    const comparison = compareHavocSeasons({
      runId: locked.runId,
      locked,
      havocGames,
      normalGames,
    });
    const state = stateFor(locked, havocGames, normalGames, {
      comparisonStatus: 'complete',
      completionState: 'complete',
    });
    const foreign = { ...comparison, runId: 'other-run' };
    expect(() =>
      deriveHavocReport({ state, havocGames, normalGames, comparison: foreign }),
    ).toThrow(/another run/);
  });
});

describe('deriveHavocReport determinism', () => {
  it('produces identical canonical JSON and digests for identical inputs', () => {
    const locked = buildHavocLockedInputs();
    const havocGames = buildStoredSet(locked, 'havoc', (gameNumber) =>
      gameNumber % 2 === 0
        ? { humanScore: 100, opponentScore: 90 }
        : { humanScore: 90, opponentScore: 100 },
    );
    const normalGames = buildStoredSet(locked, 'normal', () => ({
      humanScore: 95,
      opponentScore: 90,
    }));
    const comparison = compareHavocSeasons({
      runId: locked.runId,
      locked,
      havocGames,
      normalGames,
    });
    const state = stateFor(locked, havocGames, normalGames, {
      comparisonStatus: 'complete',
      completionState: 'complete',
    });
    const input = { state, havocGames, normalGames, comparison };
    const first = deriveHavocReport(input);
    const second = deriveHavocReport(input);
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(seasonDigestHex(canonicalJson(first))).toBe(seasonDigestHex(canonicalJson(second)));
    expect(first.lineup).toEqual(second.lineup);
  });
});
