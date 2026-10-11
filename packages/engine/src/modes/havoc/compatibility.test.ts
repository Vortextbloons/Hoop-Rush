import { describe, expect, it } from 'vitest';
import type { HavocMutationId, HavocProfileOperation } from '@hoop-rush/data-contracts';
import { havocMutationDefinitionOf } from './mutations.ts';
import {
  enumerateHavocBundles,
  havocBundleIsCompatible,
  havocDefinitionsConflict,
  havocOperationsConflict,
} from './compatibility.ts';

const MUTATION_IDS = [
  'growth-spurt',
  'alien-arms',
  'mini-monster',
  'super-soldier',
  'sniper-gene',
  'point-god',
  'brick-wall',
  'glass-eater',
  'trigger-happy',
  'walking-bucket',
  'butterfingers',
  'freak-athlete',
  'the-statue',
  'reverse-evolution',
  'four-point-dunk',
  'golden-assist',
  'heat-check',
  'second-chance-jackpot',
  'and-one-machine',
  'possession-refund',
  'rebound-loop',
  'the-bounty',
  'foul-thief',
  'basketball-roulette',
  'clone-army',
  'time-lord',
  'body-snatcher',
  'reverse-basketball',
  'double-or-nothing',
  'the-great-equalizer',
] as const satisfies readonly HavocMutationId[];

function allDefinitions() {
  return MUTATION_IDS.map((mutationId) => havocMutationDefinitionOf(mutationId));
}

describe('havoc operation compatibility', () => {
  it('rejects a floor plus a lower cap on the same field', () => {
    const floor: HavocProfileOperation = { op: 'raise-tendency', field: 'passRate', value: 95 };
    const lowerCap: HavocProfileOperation = { op: 'cap-tendency', field: 'passRate', value: 2 };
    const higherCap: HavocProfileOperation = { op: 'cap-tendency', field: 'passRate', value: 97 };
    expect(havocOperationsConflict(floor, lowerCap)).toBe(true);
    expect(havocOperationsConflict(lowerCap, floor)).toBe(true);
    expect(havocOperationsConflict(floor, higherCap)).toBe(false);
  });

  it('allows positive floors, adds, and caps on different fields to coexist', () => {
    const raiseThree: HavocProfileOperation = {
      op: 'raise-rating',
      field: 'threePoint',
      value: 97,
    };
    const raiseQuick: HavocProfileOperation = { op: 'raise-rating', field: 'speed', value: 99 };
    const addMid: HavocProfileOperation = { op: 'add-rating', field: 'midrange', value: 30 };
    const capMid: HavocProfileOperation = { op: 'cap-rating', field: 'midrange', value: 40 };
    expect(havocOperationsConflict(raiseThree, raiseQuick)).toBe(false);
    expect(havocOperationsConflict(addMid, capMid)).toBe(false);
  });

  it('rejects conflicting height operations', () => {
    const heightSet: HavocProfileOperation = { op: 'height-set', inches: 60 };
    const heightAdd: HavocProfileOperation = { op: 'height-add', minInches: 6, maxInches: 12 };
    const heightSubtract: HavocProfileOperation = { op: 'height-subtract', inches: 10 };
    const reachAdd: HavocProfileOperation = { op: 'reach-add', inches: 18 };
    expect(havocOperationsConflict(heightSet, heightAdd)).toBe(true);
    expect(havocOperationsConflict(heightSet, heightSubtract)).toBe(true);
    expect(havocOperationsConflict(heightAdd, heightSubtract)).toBe(true);
    expect(havocOperationsConflict(heightSet, heightSet)).toBe(true);
    expect(havocOperationsConflict(heightAdd, reachAdd)).toBe(false);
    expect(havocOperationsConflict(heightSubtract, reachAdd)).toBe(false);
  });

  it('derives conflicts from definitions, not candidate identity', () => {
    const superSoldier = havocMutationDefinitionOf('super-soldier');
    const statue = havocMutationDefinitionOf('the-statue');
    const sniper = havocMutationDefinitionOf('sniper-gene');
    const glassEater = havocMutationDefinitionOf('glass-eater');
    expect(havocDefinitionsConflict(superSoldier, statue)).toBe(true);
    expect(havocDefinitionsConflict(statue, superSoldier)).toBe(true);
    expect(havocDefinitionsConflict(sniper, glassEater)).toBe(false);
  });
});

describe('havoc bundle enumeration', () => {
  it('enumerates valid bundles deterministically for every tier', () => {
    const definitions = allDefinitions();
    for (const tier of [1, 2, 3] as const) {
      const first = enumerateHavocBundles(definitions, tier);
      const second = enumerateHavocBundles(definitions, tier);
      expect(first.length).toBeGreaterThan(0);
      expect(first).toEqual(second);
      for (const bundle of first) {
        expect(bundle.tier).toBe(tier);
        expect(havocBundleIsCompatible(bundle, definitions)).toBe(true);
        if (tier === 1) expect(bundle.mutationIds).toHaveLength(3);
        if (tier === 2) expect(bundle.mutationIds).toHaveLength(2);
        if (tier === 3) expect(bundle.mutationIds).toHaveLength(1);
      }
      const keys = first.map((bundle) => bundle.mutationIds.join('+'));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('never combines contradictory tier-1 mutations', () => {
    const bundles = enumerateHavocBundles(allDefinitions(), 1);
    const keys = bundles.map((bundle) => bundle.mutationIds.join('+'));
    for (const forbidden of [
      'growth-spurt+mini-monster+super-soldier',
      'mini-monster+reverse-evolution+super-soldier',
      'glass-eater+super-soldier+the-statue',
      'freak-athlete+glass-eater+sniper-gene',
      'glass-eater+point-god+trigger-happy',
      'butterfingers+glass-eater+point-god',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(keys).toContain('brick-wall+glass-eater+sniper-gene');
  });

  it('pairs every tier-2 rule with every compatible tier-1 mutation', () => {
    const definitions = allDefinitions();
    const tierTwo = definitions.filter((definition) => definition.tier === 2);
    const tierOne = definitions.filter((definition) => definition.tier === 1);
    expect(enumerateHavocBundles(definitions, 2)).toHaveLength(tierTwo.length * tierOne.length);
    for (const bundle of enumerateHavocBundles(definitions, 2)) {
      const tiers = bundle.mutationIds.map(
        (mutationId) => havocMutationDefinitionOf(mutationId).tier,
      );
      expect(tiers.filter((tier) => tier === 2)).toHaveLength(1);
      expect(tiers.filter((tier) => tier === 1)).toHaveLength(1);
    }
  });

  it('keeps incompatibility checks independent of definition ordering', () => {
    const definitions = allDefinitions();
    const reversed = [...definitions].reverse();
    for (const tier of [1, 2, 3] as const) {
      expect(enumerateHavocBundles(reversed, tier)).toEqual(
        enumerateHavocBundles(definitions, tier),
      );
    }
  });

  it('rejects incompatible bundles structurally', () => {
    const definitions = allDefinitions();
    expect(
      havocBundleIsCompatible(
        { tier: 1, mutationIds: ['growth-spurt', 'mini-monster', 'super-soldier'] },
        definitions,
      ),
    ).toBe(false);
    expect(
      havocBundleIsCompatible(
        { tier: 2, mutationIds: ['four-point-dunk', 'sniper-gene'] },
        definitions,
      ),
    ).toBe(true);
    expect(
      havocBundleIsCompatible({ tier: 2, mutationIds: ['clone-army', 'sniper-gene'] }, definitions),
    ).toBe(false);
    expect(havocBundleIsCompatible({ tier: 3, mutationIds: ['clone-army'] }, definitions)).toBe(
      true,
    );
  });
});
