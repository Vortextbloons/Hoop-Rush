import { describe, expect, it } from 'vitest';
import { seedSchema } from '@hoop-rush/data-contracts';
import { seedFromString } from '@hoop-rush/test-fixtures';
import { resolveHavocRushedPossession } from './possession.ts';
import { createRng } from './rng.ts';

function rng(): ReturnType<typeof createRng> {
  return createRng(seedSchema.parse(seedFromString('havoc-rush-unit')));
}

describe('resolveHavocRushedPossession', () => {
  it('scales the make penalty with the clock overrun and caps it', () => {
    const slight = resolveHavocRushedPossession(rng(), 13, 12);
    const heavy = resolveHavocRushedPossession(rng(), 30, 12);
    expect(slight.makePenalty).toBeGreaterThanOrEqual(0.02);
    expect(heavy.makePenalty).toBeGreaterThan(slight.makePenalty);
    expect(heavy.makePenalty).toBeLessThanOrEqual(0.1);
  });

  it('charges the floor penalty when the possession fits the clock', () => {
    const fits = resolveHavocRushedPossession(rng(), 12, 12);
    expect(fits.makePenalty).toBeCloseTo(0.02, 10);
  });

  it('is deterministic for a fixed seed', () => {
    const first = resolveHavocRushedPossession(rng(), 16, 12);
    const second = resolveHavocRushedPossession(rng(), 16, 12);
    expect(first).toEqual(second);
    expect(typeof first.violation).toBe('boolean');
  });
});
