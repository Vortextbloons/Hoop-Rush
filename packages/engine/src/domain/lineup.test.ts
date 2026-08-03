import { describe, expect, it } from 'vitest';
import type { Lineup, LineupAssignment, PositionUnion } from '@hoop-rush/data-contracts';
import { LINEUP_STRUCTURE } from '@hoop-rush/data-contracts';
import { assignLineup, canFillSlot, slotRequirement, validateLineup } from './lineup.js';

const structure = { structure: LINEUP_STRUCTURE };

function assignment(
  slotIndex: number,
  playerId: string,
  positions: PositionUnion,
): LineupAssignment {
  return { slotIndex: slotIndex, playerId, positions };
}

function lineup(assignments: LineupAssignment[]): Lineup {
  return { ...structure, assignments };
}

const five = (assignments: LineupAssignment[]): Lineup => lineup(assignments);

describe('slotRequirement', () => {
  it('follows the fixed G,G,F,F,C structure', () => {
    expect([0, 1, 2, 3, 4].map((s) => slotRequirement(s))).toEqual(['G', 'G', 'F', 'F', 'C']);
  });
});

describe('canFillSlot', () => {
  it('accepts the exact position', () => {
    expect(canFillSlot(['G'], 0)).toBe(true);
    expect(canFillSlot(['C'], 4)).toBe(true);
  });
  it('rejects a mismatched position', () => {
    expect(canFillSlot(['C'], 0)).toBe(false);
    expect(canFillSlot(['G'], 4)).toBe(false);
  });
  it('accepts flexible players in any eligible slot', () => {
    const flex = ['F', 'G'] as PositionUnion;
    expect(canFillSlot(flex, 0)).toBe(true);
    expect(canFillSlot(flex, 2)).toBe(true);
    expect(canFillSlot(flex, 4)).toBe(false);
  });
});

describe('validateLineup', () => {
  it('accepts a legal five', () => {
    const result = validateLineup(
      five([
        assignment(0, 'a', ['G']),
        assignment(1, 'b', ['F', 'G']),
        assignment(2, 'c', ['F']),
        assignment(3, 'd', ['F']),
        assignment(4, 'e', ['C']),
      ]),
    );
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects a player in an unlisted position', () => {
    const result = validateLineup(
      five([
        assignment(0, 'a', ['C']),
        assignment(1, 'b', ['G']),
        assignment(2, 'c', ['F']),
        assignment(3, 'd', ['F']),
        assignment(4, 'e', ['C']),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'slot-mismatch')).toBe(true);
  });

  it('rejects duplicate players', () => {
    const result = validateLineup(
      five([
        assignment(0, 'a', ['G']),
        assignment(1, 'a', ['G']),
        assignment(2, 'c', ['F']),
        assignment(3, 'd', ['F']),
        assignment(4, 'e', ['C']),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'duplicate-player')).toBe(true);
  });

  it('rejects an uncovered slot', () => {
    const result = validateLineup(
      five([
        assignment(0, 'a', ['G']),
        assignment(0, 'b', ['G']),
        assignment(2, 'c', ['F']),
        assignment(3, 'd', ['F']),
        assignment(4, 'e', ['C']),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'slot-missing')).toBe(true);
  });

  it('rejects a bad slot index', () => {
    const result = validateLineup(
      five([
        assignment(7, 'a', ['G']),
        assignment(1, 'b', ['G']),
        assignment(2, 'c', ['F']),
        assignment(3, 'd', ['F']),
        assignment(4, 'e', ['C']),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'bad-slot')).toBe(true);
  });
});

describe('assignLineup', () => {
  it('assigns a flexible five to legal slots', () => {
    const players = [
      { playerId: 'a', positions: ['G'] as PositionUnion },
      { playerId: 'b', positions: ['F', 'G'] as PositionUnion },
      { playerId: 'c', positions: ['F'] as PositionUnion },
      { playerId: 'd', positions: ['F'] as PositionUnion },
      { playerId: 'e', positions: ['C'] as PositionUnion },
    ];
    const result = assignLineup(players);
    expect(result).not.toBeNull();
    if (result === null) {
      throw new Error('expected a legal assignment');
    }
    expect(validateLineup({ ...structure, assignments: result }).ok).toBe(true);
  });

  it('returns null when no legal assignment exists (four bigs)', () => {
    const players = [
      { playerId: 'a', positions: ['F', 'C'] as PositionUnion },
      { playerId: 'b', positions: ['F', 'C'] as PositionUnion },
      { playerId: 'c', positions: ['F', 'C'] as PositionUnion },
      { playerId: 'd', positions: ['F', 'C'] as PositionUnion },
      { playerId: 'e', positions: ['C'] as PositionUnion },
    ];
    expect(assignLineup(players)).toBeNull();
  });

  it('returns null for a wrong count or duplicate ids', () => {
    expect(assignLineup([{ playerId: 'a', positions: ['G'] }])).toBeNull();
    expect(
      assignLineup([
        { playerId: 'a', positions: ['G'] },
        { playerId: 'a', positions: ['G'] },
        { playerId: 'c', positions: ['F'] },
        { playerId: 'd', positions: ['F'] },
        { playerId: 'e', positions: ['C'] },
      ]),
    ).toBeNull();
  });
});
