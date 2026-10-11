import { describe, expect, it } from 'vitest';
import type { SeasonRosterRole } from '@hoop-rush/data-contracts';
import { zeroScores } from './state.ts';
import type { GenerationState } from './types.ts';
import { coverageFeasibleFromPool } from './reachability.ts';

function stateWithCoverage(...roles: SeasonRosterRole[][]): GenerationState {
  return {
    roleScores: new Map(
      roles.map((covered, index) => {
        const scores = zeroScores();
        for (const role of covered) scores[role] = 100;
        return [String(index), scores];
      }),
    ),
  } as GenerationState;
}

describe('AI roster role reachability', () => {
  it('covers a remaining role outside the first role bit', () => {
    const state = stateWithCoverage(['defensive-rebounding']);
    expect(coverageFeasibleFromPool(state, ['defensive-rebounding'], ['0'], 1)).toBe(true);
  });

  it('allows one player to cover multiple remaining roles', () => {
    const roles: SeasonRosterRole[] = ['perimeter-defense', 'interior-defense'];
    expect(coverageFeasibleFromPool(stateWithCoverage(roles), roles, ['0'], 1)).toBe(true);
  });

  it('allows coverage to use fewer players than the remaining roster slots', () => {
    const state = stateWithCoverage(['primary-creation'], []);
    expect(coverageFeasibleFromPool(state, ['primary-creation'], ['0', '1'], 2)).toBe(true);
  });

  it('does not reuse the same player to cover disjoint role sets', () => {
    const roles: SeasonRosterRole[] = ['primary-creation', 'defensive-rebounding'];
    const state = stateWithCoverage(['primary-creation'], ['defensive-rebounding']);
    expect(coverageFeasibleFromPool(state, roles, ['0', '1'], 1)).toBe(false);
    expect(coverageFeasibleFromPool(state, roles, ['0', '1'], 2)).toBe(true);
    expect(coverageFeasibleFromPool(state, roles, ['0'], 2)).toBe(false);
  });
});
