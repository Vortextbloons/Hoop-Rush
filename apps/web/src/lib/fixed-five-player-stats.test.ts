import { describe, expect, it } from 'vitest';
import type { FixedFiveWorkerResultEntry, PlayerBoxScore } from '@hoop-rush/data-contracts';
import { aggregateFixedFivePlayerStats } from './fixed-five-player-stats';

function box(playerId: string, points: number, assists = 0): PlayerBoxScore {
  return {
    playerId: playerId as PlayerBoxScore['playerId'],
    minutes: 30,
    points,
    fieldGoals: { made: 4, attempted: 10 },
    threes: { made: 1, attempted: 3 },
    freeThrows: { made: 2, attempted: 2 },
    rebounds: { total: 5, offensive: 1, defensive: 4 },
    assists,
    steals: 1,
    blocks: 0,
    turnovers: 2,
    fouls: 3,
  };
}

function entry(
  tag: FixedFiveWorkerResultEntry['tag'],
  homeTeamId: string,
  homePlayers: PlayerBoxScore[],
  awayTeamId: string,
  awayPlayers: PlayerBoxScore[],
  gameNumber = 1,
): FixedFiveWorkerResultEntry {
  return {
    tag,
    game: {
      gameNumber,
      home: { teamId: homeTeamId, players: homePlayers },
      away: { teamId: awayTeamId, players: awayPlayers },
      winner: 'home',
    },
  } as unknown as FixedFiveWorkerResultEntry;
}

describe('aggregateFixedFivePlayerStats', () => {
  it('returns empty lines for no entries', () => {
    expect(aggregateFixedFivePlayerStats('classic-shared-82', [])).toEqual({ p1: [], p2: [] });
    expect(aggregateFixedFivePlayerStats('duel', [])).toEqual({ p1: [], p2: [] });
  });

  it('attributes shared-82 tags: p1 and h2h-home to p1, p2 and h2h-away to p2', () => {
    const entries = [
      entry('p1', 'p1', [box('a1', 20)], 'opp-1', [box('o1', 99)]),
      entry('p2', 'p2', [box('b1', 15)], 'opp-2', [box('o2', 99)]),
      entry('h2h', 'p1', [box('a1', 10)], 'p2', [box('b1', 12)], 3),
    ];
    const stats = aggregateFixedFivePlayerStats('classic-shared-82', entries);
    const a1 = stats.p1.find((l) => l.playerId === 'a1');
    const b1 = stats.p2.find((l) => l.playerId === 'b1');
    expect(a1?.games).toBe(2);
    expect(a1?.points).toBe(30);
    expect(b1?.games).toBe(2);
    expect(b1?.points).toBe(27);
    expect(stats.p1.some((l) => l.playerId === 'o1')).toBe(false);
    expect(stats.p2.some((l) => l.playerId === 'o2')).toBe(false);
    expect(stats.p1.some((l) => l.playerId === 'b1')).toBe(false);
  });

  it('attributes duel games by team id regardless of home/away', () => {
    const entries = [
      entry('duel', 'p1', [box('a1', 20)], 'p2', [box('b1', 10)], 1),
      entry('duel', 'p2', [box('b1', 14)], 'p1', [box('a1', 22)], 2),
    ];
    const stats = aggregateFixedFivePlayerStats('duel', entries);
    expect(stats.p1.find((l) => l.playerId === 'a1')?.points).toBe(42);
    expect(stats.p1.find((l) => l.playerId === 'a1')?.games).toBe(2);
    expect(stats.p2.find((l) => l.playerId === 'b1')?.points).toBe(24);
  });

  it('ignores non-duel tags in duel mode and duel tags in shared modes', () => {
    const mixed = [entry('p1', 'p1', [box('a1', 20)], 'opp', [box('o1', 5)])];
    expect(aggregateFixedFivePlayerStats('duel', mixed)).toEqual({ p1: [], p2: [] });
    const duelOnly = [entry('duel', 'p1', [box('a1', 20)], 'p2', [box('b1', 10)])];
    const shared = aggregateFixedFivePlayerStats('sandbox-shared-82', duelOnly);
    expect(shared).toEqual({ p1: [], p2: [] });
  });

  it('accumulates every counted box field', () => {
    const stats = aggregateFixedFivePlayerStats('classic-shared-82', [
      entry('p1', 'p1', [box('a1', 20, 7)], 'opp', [box('o1', 1)]),
    ]);
    const line = stats.p1.find((l) => l.playerId === 'a1');
    expect(line).toMatchObject({
      games: 1,
      minutes: 30,
      points: 20,
      fieldGoalsMade: 4,
      fieldGoalsAttempted: 10,
      threesMade: 1,
      threesAttempted: 3,
      freeThrowsMade: 2,
      freeThrowsAttempted: 2,
      rebounds: 5,
      offensiveRebounds: 1,
      defensiveRebounds: 4,
      assists: 7,
      steals: 1,
      turnovers: 2,
      fouls: 3,
    });
  });
});
