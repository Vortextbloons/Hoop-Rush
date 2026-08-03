import { describe, expect, it } from 'vitest';
import type { GameResult, PlayerBoxScore, TeamResult } from '@hoop-rush/data-contracts';
import { buildFacts } from './facts.js';

function player(overrides: Partial<PlayerBoxScore> = {}): PlayerBoxScore {
  return {
    playerId: 'p-x',
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
  players: PlayerBoxScore[],
  points: number,
  overrides: Partial<TeamResult> = {},
): TeamResult {
  const turnovers = players.reduce((sum, p) => sum + p.turnovers, 0);
  const fga = players.reduce((sum, p) => sum + p.fieldGoals.attempted, 0);
  const fgm = players.reduce((sum, p) => sum + p.fieldGoals.made, 0);
  const fta = players.reduce((sum, p) => sum + p.freeThrows.attempted, 0);
  return {
    teamId,
    displayName: teamId === 'user' ? 'Your five' : 'Opponent',
    box: {
      teamId,
      points,
      fieldGoals: { made: fgm, attempted: fga },
      threes: { made: 0, attempted: 0 },
      freeThrows: { made: 0, attempted: fta },
      rebounds: { total: 0, offensive: 0, defensive: 0, team: 0 },
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers,
      fouls: 0,
      possessions: fga + Math.round(0.44 * fta),
    },
    players,
    shotZones: [
      { zone: 'rim', attempts: 0, makes: 0 },
      { zone: 'shortMid', attempts: 0, makes: 0 },
      { zone: 'longMid', attempts: 0, makes: 0 },
      { zone: 'cornerThree', attempts: 0, makes: 0 },
      { zone: 'aboveBreakThree', attempts: 0, makes: 0 },
    ],
    ...overrides,
  };
}

function game(home: TeamResult, away: TeamResult, winner: 'home' | 'away'): GameResult {
  return {
    schemaVersion: 1,
    gameNumber: 1,
    seed: 'facts-test',
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

function usageDiag(usage: number): PlayerBoxScore['diagnostics'] {
  return {
    usage,
    shotZones: [
      { zone: 'rim', attempts: 0, makes: 0 },
      { zone: 'shortMid', attempts: 0, makes: 0 },
      { zone: 'longMid', attempts: 0, makes: 0 },
      { zone: 'cornerThree', attempts: 0, makes: 0 },
      { zone: 'aboveBreakThree', attempts: 0, makes: 0 },
    ],
    assistOpportunities: 0,
    offensiveReboundChances: 0,
    defensiveReboundChances: 0,
    contestedShots: 0,
  };
}

describe('buildFacts usage fact', () => {
  it('picks the highest-usage player, not the top scorer', () => {
    // A scores 30 but uses little; B scores 8 while using most of the
    // possessions. Usage (FGA + 0.44*FTA + TOV) must drive the fact.
    const scorer = player({
      playerId: 'p-scorer',
      points: 30,
      fieldGoals: { made: 10, attempted: 20 },
      turnovers: 2,
      minutes: 38,
      diagnostics: usageDiag(10),
    });
    const workhorse = player({
      playerId: 'p-workhorse',
      points: 8,
      fieldGoals: { made: 3, attempted: 18 },
      turnovers: 6,
      minutes: 40,
      diagnostics: usageDiag(25),
    });
    const rest = Array.from({ length: 3 }, (_, i) =>
      player({ playerId: `p-rest-${String(i)}`, points: 4, diagnostics: usageDiag(0) }),
    );
    const home = team('user', [scorer, workhorse, ...rest], 50);
    const away = team(
      'away',
      Array.from({ length: 5 }, (_, i) =>
        player({ playerId: `p-away-${String(i)}`, diagnostics: usageDiag(1) }),
      ),
      40,
    );
    const result = buildFacts(game(home, away, 'home'));
    const usageFact = result.find((fact) => fact.kind === 'usage');
    expect(usageFact).toBeDefined();
    expect(usageFact?.playerIds).toEqual(['p-workhorse']);
    expect(usageFact?.evidence.usageShare).toBeCloseTo(25 / 35, 6);
    expect(usageFact?.evidence.playerUsage).toBe(25);
    expect(usageFact?.evidence.teamUsage).toBe(35);
    expect(usageFact?.magnitude).toBeCloseTo(25 / 35, 6);
  });

  it('emits no usage fact below the share threshold', () => {
    const players = Array.from({ length: 5 }, (_, i) =>
      player({ playerId: `p-${String(i)}`, points: 10, diagnostics: usageDiag(7) }),
    );
    const home = team('user', players, 50);
    const away = team(
      'away',
      Array.from({ length: 5 }, (_, i) =>
        player({ playerId: `p-away-${String(i)}`, diagnostics: usageDiag(7) }),
      ),
      40,
    );
    const result = buildFacts(game(home, away, 'home'));
    expect(result.some((fact) => fact.kind === 'usage')).toBe(false);
  });

  it('falls back to the usage formula for legacy records without diagnostics', () => {
    const workhorse = player({
      playerId: 'p-legacy',
      points: 8,
      fieldGoals: { made: 3, attempted: 16 },
      freeThrows: { made: 2, attempted: 5 },
      turnovers: 4,
      diagnostics: undefined,
    });
    const rest = Array.from({ length: 4 }, (_, i) =>
      player({ playerId: `p-rest-${String(i)}`, points: 6, diagnostics: undefined }),
    );
    const home = team('user', [workhorse, ...rest], 32);
    const away = team(
      'away',
      Array.from({ length: 5 }, (_, i) =>
        player({ playerId: `p-away-${String(i)}`, diagnostics: undefined }),
      ),
      30,
    );
    const result = buildFacts(game(home, away, 'home'));
    const usageFact = result.find((fact) => fact.kind === 'usage');
    // Legacy formula usage = 16 + 0.44*5 + 4 = 22.2 of 22.2 team usage.
    expect(usageFact).toBeDefined();
    expect(usageFact?.playerIds).toEqual(['p-legacy']);
    expect(usageFact?.evidence.usageShare).toBeCloseTo(1, 6);
  });
});
