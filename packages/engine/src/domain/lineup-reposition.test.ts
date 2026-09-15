import { describe, expect, it } from 'vitest';
import { playerIdSchema, type PlayerId, type Position } from '@hoop-rush/data-contracts';
import { planLineupReposition, type LineupRepositionPlayer } from './lineup-reposition.ts';

const pid = (value: string): PlayerId => playerIdSchema.parse(value);

function player(
  playerId: string,
  positions: Position[],
  slotIndex: 0 | 1 | 2 | 3 | 4,
): LineupRepositionPlayer {
  return { playerId: pid(playerId), positions, slotIndex };
}

const deepLineup = [
  player('a', ['PG', 'SF'], 0),
  player('e', ['SG'], 1),
  player('b', ['SF', 'PF'], 2),
  player('c', ['PF', 'C'], 3),
  player('d', ['C', 'PG'], 4),
];

describe('planLineupReposition', () => {
  it('finds a deterministic multi-hop chain through occupied slots', () => {
    const plan = planLineupReposition(
      deepLineup,
      { playerId: pid('a'), positions: ['PG', 'SF'] },
      2,
    );

    expect(plan).not.toBeNull();
    expect(plan?.placements).toEqual([
      { playerId: pid('d'), slotIndex: 0 },
      { playerId: pid('e'), slotIndex: 1 },
      { playerId: pid('a'), slotIndex: 2 },
      { playerId: pid('b'), slotIndex: 3 },
      { playerId: pid('c'), slotIndex: 4 },
    ]);
    expect(plan?.moves).toEqual([
      { playerId: pid('d'), fromSlot: 4, toSlot: 0 },
      { playerId: pid('a'), fromSlot: 0, toSlot: 2 },
      { playerId: pid('b'), fromSlot: 2, toSlot: 3 },
      { playerId: pid('c'), fromSlot: 3, toSlot: 4 },
    ]);
  });

  it('can insert a new player into a partial lineup with a deep chain', () => {
    const plan = planLineupReposition(
      deepLineup.slice(1),
      { playerId: pid('a'), positions: ['PG', 'SF'] },
      2,
    );

    expect(plan?.placements).toEqual([
      { playerId: pid('d'), slotIndex: 0 },
      { playerId: pid('e'), slotIndex: 1 },
      { playerId: pid('a'), slotIndex: 2 },
      { playerId: pid('b'), slotIndex: 3 },
      { playerId: pid('c'), slotIndex: 4 },
    ]);
  });

  it('returns null when no complete assignment exists', () => {
    const players = [
      player('a', ['PG', 'SF'], 0),
      player('e', ['SG'], 1),
      player('b', ['SF'], 2),
      player('c', ['PF'], 3),
      player('d', ['C'], 4),
    ];

    expect(
      planLineupReposition(players, { playerId: pid('a'), positions: ['PG', 'SF'] }, 2),
    ).toBeNull();
  });
});
