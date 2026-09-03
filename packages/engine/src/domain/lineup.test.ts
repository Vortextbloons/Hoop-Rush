import { describe, expect, it } from 'vitest';
import type { Lineup, LineupAssignment, PositionUnion } from '@hoop-rush/data-contracts';
import { LINEUP_STRUCTURE } from '@hoop-rush/data-contracts';
import { assignLineup, canFillSlot, slotRequirement, validateLineup } from './lineup.ts';
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
describe('validateLineup', () => {
  it('accepts a legal five', () => {
    const result = validateLineup(
      five([
        assignment(0, 'a', ['PG']),
        assignment(1, 'b', ['PG', 'SF']),
        assignment(2, 'c', ['SF']),
        assignment(3, 'd', ['PF']),
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
        assignment(1, 'b', ['PG']),
        assignment(2, 'c', ['SF']),
        assignment(3, 'd', ['PF']),
        assignment(4, 'e', ['C']),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'slot-mismatch')).toBe(true);
  });
  it('rejects duplicate players', () => {
    const result = validateLineup(
      five([
        assignment(0, 'a', ['PG']),
        assignment(1, 'a', ['SG']),
        assignment(2, 'c', ['SF']),
        assignment(3, 'd', ['PF']),
        assignment(4, 'e', ['C']),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'duplicate-player')).toBe(true);
  });
  it('rejects an uncovered slot', () => {
    const result = validateLineup(
      five([
        assignment(0, 'a', ['PG']),
        assignment(0, 'b', ['SG']),
        assignment(2, 'c', ['SF']),
        assignment(3, 'd', ['PF']),
        assignment(4, 'e', ['C']),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'slot-missing')).toBe(true);
  });
  it('rejects a bad slot index', () => {
    const result = validateLineup(
      five([
        assignment(7, 'a', ['PG']),
        assignment(1, 'b', ['SG']),
        assignment(2, 'c', ['SF']),
        assignment(3, 'd', ['PF']),
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
      { playerId: 'a', positions: ['PG'] as PositionUnion },
      { playerId: 'b', positions: ['PG', 'SF'] as PositionUnion },
      { playerId: 'c', positions: ['SF'] as PositionUnion },
      { playerId: 'd', positions: ['PF'] as PositionUnion },
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
      { playerId: 'a', positions: ['PF', 'C'] as PositionUnion },
      { playerId: 'b', positions: ['PF', 'C'] as PositionUnion },
      { playerId: 'c', positions: ['PF', 'C'] as PositionUnion },
      { playerId: 'd', positions: ['PF', 'C'] as PositionUnion },
      { playerId: 'e', positions: ['C'] as PositionUnion },
    ];
    expect(assignLineup(players)).toBeNull();
  });
  it('returns null for a wrong count or duplicate ids', () => {
    expect(assignLineup([{ playerId: 'a', positions: ['PG'] }])).toBeNull();
    expect(
      assignLineup([
        { playerId: 'a', positions: ['PG'] },
        { playerId: 'a', positions: ['SG'] },
        { playerId: 'c', positions: ['SF'] },
        { playerId: 'd', positions: ['PF'] },
        { playerId: 'e', positions: ['C'] },
      ]),
    ).toBeNull();
  });
});
