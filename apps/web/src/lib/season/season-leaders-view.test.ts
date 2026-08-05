import { describe, expect, it } from 'vitest';
import type { SeasonPlayerAggregate, SeasonTeamAggregate } from '@hoop-rush/data-contracts';
import {
  engineOrderLeaderTables,
  LEADER_CATEGORIES,
  seasonLeaderCategoryValue,
} from './season-leaders-view';

/**
 * Leaders tab ordering tests (M2.3.5): the engine-authoritative tie-break is
 * perGame desc, value desc, playerVersionId asc — NOT the value-first order
 * of the frozen web `leaderTables` helper. The eligibility gate and depth
 * mirror the frozen engine constants.
 */

function team(franchiseId: string, gamesPlayed: number): SeasonTeamAggregate {
  return {
    franchiseId,
    gamesPlayed,
    wins: 0,
    losses: 0,
    points: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    possessions: 0,
  };
}

function player(
  playerVersionId: string,
  franchiseId: string,
  gamesPlayed: number,
  overrides: Partial<SeasonPlayerAggregate> = {},
): SeasonPlayerAggregate {
  return {
    playerVersionId,
    franchiseId,
    gamesPlayed,
    seconds: gamesPlayed * 2400,
    points: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    ...overrides,
  };
}

describe('seasonLeaderCategoryValue', () => {
  it('maps every category to the right aggregate field', () => {
    const p = player('v1', 'lakers', 10, {
      points: 100,
      offensiveRebounds: 5,
      defensiveRebounds: 6,
      assists: 7,
      steals: 8,
      blocks: 9,
      threePointersMade: 4,
    });
    expect(seasonLeaderCategoryValue(p, 'points')).toBe(100);
    expect(seasonLeaderCategoryValue(p, 'rebounds')).toBe(11);
    expect(seasonLeaderCategoryValue(p, 'assists')).toBe(7);
    expect(seasonLeaderCategoryValue(p, 'steals')).toBe(8);
    expect(seasonLeaderCategoryValue(p, 'blocks')).toBe(9);
    expect(seasonLeaderCategoryValue(p, 'threePointersMade')).toBe(4);
  });
});

describe('engineOrderLeaderTables', () => {
  const teams = [team('celtics', 10), team('lakers', 10), team('hawks', 10), team('spurs', 5)];

  it('orders by per-game desc before value desc (engine tie-break)', () => {
    const players = [
      // Higher total (300) but lower rate (30/g) must rank BELOW the higher
      // rate (240 in 7 games = 34.3/g) even though the total is smaller.
      player('v-big', 'lakers', 10, { points: 300 }),
      player('v-rate', 'lakers', 7, { points: 240 }),
    ];
    const tables = engineOrderLeaderTables(players, teams);
    expect(tables.points.map((entry) => entry.playerVersionId)).toEqual(['v-rate', 'v-big']);
  });

  it('breaks per-game ties by value desc, then playerVersionId asc', () => {
    const players = [
      player('v-tie-b', 'lakers', 10, { points: 250 }),
      player('v-tie-a', 'lakers', 10, { points: 250 }),
      player('v-mid', 'lakers', 10, { points: 260 }),
    ];
    const tables = engineOrderLeaderTables(players, teams);
    expect(tables.points.map((entry) => entry.playerVersionId)).toEqual([
      'v-mid',
      'v-tie-a',
      'v-tie-b',
    ]);
  });

  it('applies the 70% game-share eligibility gate per team', () => {
    const players = [
      // 3 of 10 team games: below the 0.7 gate despite the best rate.
      player('v-ineligible', 'hawks', 3, { points: 300 }),
      player('v-eligible', 'hawks', 10, { points: 200 }),
      // 5 of 5 team games: eligible (>= 3.5); its higher rate ranks first.
      player('v-spurs', 'spurs', 5, { points: 150 }),
    ];
    const tables = engineOrderLeaderTables(players, teams);
    expect(tables.points.map((entry) => entry.playerVersionId)).toEqual(['v-spurs', 'v-eligible']);
  });

  it('caps each category at depth 5', () => {
    const players = Array.from({ length: 9 }, (_, index) =>
      player(`v-${String(index)}`, 'lakers', 10, { points: 200 - index }),
    );
    const tables = engineOrderLeaderTables(players, teams);
    for (const category of LEADER_CATEGORIES) {
      expect(tables[category].length).toBeLessThanOrEqual(5);
    }
  });

  it('drops players with zero games even when teams share the id', () => {
    // Both players belong to the lakers; the team has played one game, so a
    // zero-game player fails the 0.7 gate while a one-game player passes it.
    const lakersOneGame = [team('lakers', 1)];
    const players = [
      player('v-zero', 'lakers', 0, { points: 0 }),
      player('v-one', 'lakers', 1, { points: 30 }),
    ];
    const tables = engineOrderLeaderTables(players, lakersOneGame);
    expect(tables.points.map((entry) => entry.playerVersionId)).toEqual(['v-one']);
  });
});
