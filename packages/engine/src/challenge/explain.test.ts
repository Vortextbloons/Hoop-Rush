import { describe, expect, it } from 'vitest';
import type {
  ChallengeRun,
  GameResult,
  PlayerBoxScore,
  TeamResult,
} from '@hoop-rush/data-contracts';
import { playerIdSchema } from '@hoop-rush/data-contracts';
import { buildChallengeRun } from '@hoop-rush/test-fixtures';
import { EXPLAIN_THRESHOLDS, explainSeason, opponentSeasonTotals } from './explain.ts';
function player(overrides: Partial<PlayerBoxScore> = {}): PlayerBoxScore {
  return {
    playerId: playerIdSchema.parse('p-x'),
    minutes: 36,
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
    ...overrides,
  };
}
function team(
  teamId: string,
  overrides: {
    points?: number;
    fieldGoals?: {
      made: number;
      attempted: number;
    };
    freeThrows?: {
      made: number;
      attempted: number;
    };
    turnovers?: number;
    possessions?: number;
    offensiveRebounds?: number;
    defensiveRebounds?: number;
    zones?: Array<{
      zone: 'rim' | 'shortMid' | 'longMid' | 'cornerThree' | 'aboveBreakThree';
      attempts: number;
      makes: number;
    }>;
  } = {},
): TeamResult {
  const players = Array.from({ length: 5 }, (_, i) =>
    player({
      playerId: playerIdSchema.parse(`${teamId}-${String(i)}`),
      fieldGoals: overrides.fieldGoals ?? { made: 0, attempted: 0 },
      turnovers: overrides.turnovers ?? 0,
    }),
  );
  const box = {
    teamId,
    points: overrides.points ?? 0,
    fieldGoals: overrides.fieldGoals ?? { made: 0, attempted: 0 },
    threes: { made: 0, attempted: 0 },
    freeThrows: overrides.freeThrows ?? { made: 0, attempted: 0 },
    rebounds: {
      total: (overrides.offensiveRebounds ?? 0) + (overrides.defensiveRebounds ?? 0),
      offensive: overrides.offensiveRebounds ?? 0,
      defensive: overrides.defensiveRebounds ?? 0,
      team: 0,
    },
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: overrides.turnovers ?? 0,
    fouls: 0,
    possessions: overrides.possessions ?? 100,
    diagnostics: {
      assistedFieldGoals: 0,
      unassistedFieldGoals: 0,
      reboundOpportunities: 40,
      contestedShots: 30,
    },
  };
  const zoneTemplate = [
    { zone: 'rim' as const, attempts: 0, makes: 0 },
    { zone: 'shortMid' as const, attempts: 0, makes: 0 },
    { zone: 'longMid' as const, attempts: 0, makes: 0 },
    { zone: 'cornerThree' as const, attempts: 0, makes: 0 },
    { zone: 'aboveBreakThree' as const, attempts: 0, makes: 0 },
  ];
  const zoneOverrides = new Map((overrides.zones ?? []).map((zone) => [zone.zone, zone]));
  const zones = zoneTemplate.map((template) => zoneOverrides.get(template.zone) ?? template);
  return { teamId, displayName: teamId, box, players, shotZones: zones };
}
function game(home: TeamResult, away: TeamResult, winner: 'home' | 'away'): GameResult {
  return {
    schemaVersion: 1,
    gameNumber: 1,
    seed: 'explain-test',
    engineVersion: 'test',
    dataVersion: 'test',
    profileVersion: 'test',
    home,
    away,
    periodScores: { home: [0, 0, 0, 0], away: [0, 0, 0, 0] },
    winner,
    overtimePeriods: 0,
    facts: [],
  };
}
const RIM_80: Array<{
  zone: 'rim';
  attempts: number;
  makes: number;
}> = [{ zone: 'rim', attempts: 80, makes: 50 }];
const RIM_30: Array<{
  zone: 'rim';
  attempts: number;
  makes: number;
}> = [{ zone: 'rim', attempts: 80, makes: 30 }];
function threeGameRun(): ChallengeRun {
  const homeBase = team('user', {
    fieldGoals: { made: 30, attempted: 80 },
    zones: RIM_80,
  });
  const awayBase = team('away', {
    fieldGoals: { made: 30, attempted: 80 },
    zones: RIM_30,
  });
  const games = [
    game(homeBase, { ...awayBase, box: { ...awayBase.box, turnovers: 15 } }, 'home'),
    game(
      { ...homeBase, box: { ...homeBase.box, turnovers: 12 } },
      { ...awayBase, box: { ...awayBase.box, turnovers: 8 } },
      'home',
    ),
    game(
      { ...homeBase, box: { ...homeBase.box, turnovers: 12 } },
      { ...awayBase, box: { ...awayBase.box, turnovers: 12 } },
      'away',
    ),
  ];
  const run = buildChallengeRun({ games });
  return {
    ...run,
    aggregates: {
      team: {
        wins: 2,
        losses: 1,
        gamesPlayed: 3,
        points: 300,
        fieldGoals: { made: 90, attempted: 240 },
        threes: { made: 0, attempted: 0 },
        freeThrows: { made: 8, attempted: 12 },
        rebounds: { total: 120, offensive: 60, defensive: 60, team: 0 },
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 20,
        fouls: 0,
        possessions: 250,
      },
      players: [
        {
          playerId: playerIdSchema.parse('p-1'),
          gamesPlayed: 3,
          minutes: 120,
          points: 130,
          fieldGoals: { made: 55, attempted: 130 },
          threes: { made: 0, attempted: 0 },
          freeThrows: { made: 8, attempted: 10 },
          rebounds: { total: 20, offensive: 5, defensive: 15 },
          assists: 10,
          steals: 2,
          blocks: 1,
          turnovers: 10,
          fouls: 3,
        },
        ...Array.from({ length: 4 }, (_, i) => ({
          playerId: playerIdSchema.parse(`p-${String(i + 2)}`),
          gamesPlayed: 3,
          minutes: 120,
          points: 45,
          fieldGoals: { made: 10, attempted: 40 },
          threes: { made: 0, attempted: 0 },
          freeThrows: { made: 1, attempted: 2 },
          rebounds: { total: 20, offensive: 10, defensive: 10 },
          assists: 5,
          steals: 1,
          blocks: 0,
          turnovers: 4,
          fouls: 3,
        })),
      ],
    },
  };
}
describe('opponentSeasonTotals', () => {
  it('folds the away side of every game into exact totals', () => {
    const totals = opponentSeasonTotals(threeGameRun());
    expect(totals.gamesPlayed).toBe(3);
    expect(totals.points).toBe(0);
    expect(totals.turnovers).toBe(15 + 8 + 12);
    expect(totals.fieldGoals.attempted).toBe(240);
    expect(totals.reboundOpportunities).toBe(120);
    const rim = totals.shotZones.find((zone) => zone.zone === 'rim');
    expect(rim).toBeDefined();
    expect(rim?.attempts).toBe(240);
    expect(rim?.makes).toBe(90);
  });
  it('keeps zone attempts reconciled with field-goal attempts', () => {
    const totals = opponentSeasonTotals(threeGameRun());
    const zoneAttempts = totals.shotZones.reduce((sum, zone) => sum + zone.attempts, 0);
    expect(zoneAttempts).toBe(totals.fieldGoals.attempted);
  });
});
describe('explainSeason', () => {
  it('counts turnover battles per game, including ties as neither side', () => {
    const explanation = explainSeason(threeGameRun());
    expect(explanation.turnoverBattleWins).toBe(1);
    expect(explanation.turnoverBattleLosses).toBe(1);
  });
  it('computes net rating per 100 from recorded possessions', () => {
    const explanation = explainSeason(threeGameRun());
    expect(explanation.netRatingPer100).toBeCloseTo((300 / 250) * 100, 6);
  });
  it('picks the largest meaningful zone make-rate edge', () => {
    const explanation = explainSeason(threeGameRun());
    expect(explanation.zoneAdvantage).not.toBeNull();
    expect(explanation.zoneAdvantage?.zone).toBe('rim');
    expect(explanation.zoneAdvantage?.edge).toBeCloseTo(50 / 80 - 30 / 80, 6);
  });
  it('reports no zone advantage below the attempt minimum', () => {
    const run = buildChallengeRun({ games: [] });
    const explanation = explainSeason({
      ...run,
      aggregates: run.aggregates,
      games: [
        game(
          team('user', { zones: [{ zone: 'rim', attempts: 5, makes: 5 }] }),
          team('away'),
          'home',
        ),
      ],
    });
    expect(explanation.zoneAdvantage).toBeNull();
  });
  it('flags weak defensive glass from the opponent offensive-rebound rate', () => {
    const explanation = explainSeason(threeGameRun());
    expect(explanation.opponentOffensiveReboundRate).toBeLessThan(
      EXPLAIN_THRESHOLDS.opponentOffensiveReboundRate,
    );
    expect(explanation.defensiveReboundPct).toBeCloseTo(60 / (60 + 0), 6);
  });
  it('names the usage leader from the accepted aggregates', () => {
    const explanation = explainSeason(threeGameRun());
    expect(explanation.usageLeader).not.toBeNull();
    expect(explanation.usageLeader?.playerId).toBe('p-1');
    expect(explanation.usageLeader?.usageShare).toBeCloseTo(144.4 / 265.28, 6);
    expect(explanation.usageLeader?.usageShare).toBeGreaterThanOrEqual(
      EXPLAIN_THRESHOLDS.usageShare,
    );
  });
});
