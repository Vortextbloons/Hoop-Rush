import { describe, expect, it } from 'vitest';
import type { HavocMutationPackage, HavocTier, Position } from '@hoop-rush/data-contracts';
import { createRng } from '../../sim/rng.ts';
import { generateHavocNickname } from './nicknames.ts';

const PACKAGES: HavocMutationPackage[] = [
  [{ mutationId: 'sniper-gene' }, { mutationId: 'point-god' }, { mutationId: 'glass-eater' }],
  [{ mutationId: 'growth-spurt', sampledHeightDelta: 9 }, { mutationId: 'brick-wall' }],
  [{ mutationId: 'four-point-dunk' }, { mutationId: 'super-soldier' }],
  [{ mutationId: 'clone-army' }],
  [{ mutationId: 'double-or-nothing' }],
];

describe('havoc nicknames', () => {
  it('produces the same nickname for the same package and seed', () => {
    for (const tier of [1, 2, 3] as HavocTier[]) {
      for (const slot of ['PG', 'SG', 'SF', 'PF', 'C'] as Position[]) {
        const input = {
          tier,
          slot,
          mutations: PACKAGES[tier - 1] ?? [{ mutationId: 'sniper-gene' as const }],
        };
        const first = generateHavocNickname(input, createRng('havoc-nickname-seed'));
        const second = generateHavocNickname(input, createRng('havoc-nickname-seed'));
        expect(first).toBe(second);
        expect(first.length).toBeGreaterThan(0);
        expect(first.length).toBeLessThanOrEqual(64);
      }
    }
  });

  it('keys names to the actual package', () => {
    const sniper = generateHavocNickname(
      {
        tier: 1,
        slot: 'SG',
        mutations: [{ mutationId: 'sniper-gene' }, { mutationId: 'point-god' }],
      },
      createRng('havoc-nickname-seed'),
    );
    expect(sniper).toContain('Sniper');
    const dunk = generateHavocNickname(
      { tier: 3, slot: 'C', mutations: [{ mutationId: 'double-or-nothing' }] },
      createRng('havoc-nickname-seed'),
    );
    expect(dunk).toContain('All-In');
    const names = new Set<string>();
    for (const [index, mutations] of PACKAGES.entries()) {
      names.add(
        generateHavocNickname(
          { tier: ((index % 3) + 1) as HavocTier, slot: 'SF', mutations },
          createRng(`havoc-nickname-variety-${String(index)}`),
        ),
      );
    }
    expect(names.size).toBeGreaterThan(1);
  });

  it('rejects an empty package', () => {
    expect(() =>
      generateHavocNickname({ tier: 1, slot: 'PG', mutations: [] }, createRng('empty')),
    ).toThrow();
  });
});
