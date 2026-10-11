import { describe, expect, it } from 'vitest';
import { poolRemovalRobustAfterAdd } from './pool.ts';
import type { GenerationState, PoolTeam } from './types.ts';

function fixture(masks: number[], remainingSlots = 0, availableMasks: number[] = []) {
  const ids = masks.map((_, index) => String(index));
  const availableIds = availableMasks.map((_, index) => `available-${String(index)}`);
  const counts = new Array<number>(32).fill(0);
  for (const mask of availableMasks) counts[mask] = (counts[mask] ?? 0) + 1;
  return {
    state: {
      targets: { policy: { poolSize: masks.length + remainingSlots } },
      maskByVersion: new Map([
        ...masks.map((mask, index): [string, number] => [String(index), mask]),
        ...availableMasks.map((mask, index): [string, number] => [
          `available-${String(index)}`,
          mask,
        ]),
      ]),
      unassigned: new Set(availableIds),
      unassignedMaskCountsArr: counts,
    } as GenerationState,
    team: { pool: ids } as PoolTeam,
  };
}

describe('AI pool removal robustness', () => {
  it('rejects two guards covering both guard positions without a third guard', () => {
    const { state, team } = fixture([3, 3, 4, 4, 8, 8, 16, 16, 16, 16]);
    expect(poolRemovalRobustAfterAdd(state, team, null)).toBe(false);
  });

  it('allows a remaining slot to add the missing guard', () => {
    const { state, team } = fixture([3, 3, 4, 4, 8, 8, 16, 16, 16], 1, [1]);
    expect(poolRemovalRobustAfterAdd(state, team, null)).toBe(true);
    expect(poolRemovalRobustAfterAdd(state, team, 'available-0')).toBe(true);
  });

  it('rejects filling the final slot with another center', () => {
    const { state, team } = fixture([3, 3, 4, 4, 8, 8, 16, 16, 16], 1, [1, 16]);
    expect(poolRemovalRobustAfterAdd(state, team, 'available-1')).toBe(false);
  });

  it('does not count the added player twice in future availability', () => {
    const { state, team } = fixture([4, 4, 8, 8, 16, 16], 3, [3, 3]);
    expect(poolRemovalRobustAfterAdd(state, team, 'available-0')).toBe(false);
  });
});
