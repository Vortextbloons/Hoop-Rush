import { describe, expect, it } from 'vitest';
import type { HavocMutationId, HavocProfileOperation } from '@hoop-rush/data-contracts';
import { HAVOC_MUTATION_DEFINITIONS, havocMutationDefinitionOf } from './mutations.ts';

const TIER_ONE_OPERATIONS: Record<
  | 'growth-spurt'
  | 'alien-arms'
  | 'mini-monster'
  | 'super-soldier'
  | 'sniper-gene'
  | 'point-god'
  | 'brick-wall'
  | 'glass-eater'
  | 'trigger-happy'
  | 'walking-bucket'
  | 'butterfingers'
  | 'freak-athlete'
  | 'the-statue'
  | 'reverse-evolution',
  HavocProfileOperation[]
> = {
  'growth-spurt': [{ op: 'height-add', minInches: 6, maxInches: 12 }],
  'alien-arms': [{ op: 'reach-add', inches: 18 }],
  'mini-monster': [
    { op: 'height-set', inches: 60 },
    { op: 'raise-rating', field: 'speed', value: 99 },
    { op: 'raise-rating', field: 'ballHandling', value: 99 },
  ],
  'super-soldier': [
    { op: 'raise-rating', field: 'speed', value: 99 },
    { op: 'raise-rating', field: 'strength', value: 99 },
    { op: 'raise-rating', field: 'vertical', value: 99 },
  ],
  'sniper-gene': [
    { op: 'raise-rating', field: 'threePoint', value: 97 },
    { op: 'raise-tendency', field: 'threePointRate', value: 90 },
  ],
  'point-god': [
    { op: 'raise-rating', field: 'passing', value: 99 },
    { op: 'raise-rating', field: 'ballHandling', value: 99 },
    { op: 'raise-tendency', field: 'passRate', value: 95 },
  ],
  'brick-wall': [
    { op: 'raise-rating', field: 'interiorDefense', value: 99 },
    { op: 'raise-rating', field: 'strength', value: 99 },
    { op: 'raise-rating', field: 'block', value: 99 },
    { op: 'raise-tendency', field: 'blockAttemptRate', value: 20 },
  ],
  'glass-eater': [
    { op: 'raise-rating', field: 'offensiveRebound', value: 99 },
    { op: 'raise-rating', field: 'defensiveRebound', value: 99 },
    { op: 'raise-tendency', field: 'crashOffensiveGlassRate', value: 90 },
  ],
  'trigger-happy': [
    { op: 'raise-rating', field: 'insideScoring', value: 99 },
    { op: 'raise-rating', field: 'closeShot', value: 99 },
    { op: 'raise-rating', field: 'midrange', value: 99 },
    { op: 'raise-rating', field: 'threePoint', value: 99 },
    { op: 'raise-rating', field: 'freeThrow', value: 99 },
    { op: 'raise-tendency', field: 'shotRate', value: 99 },
    { op: 'raise-tendency', field: 'usageRate', value: 45 },
    { op: 'cap-tendency', field: 'passRate', value: 2 },
  ],
  'walking-bucket': [
    { op: 'add-rating', field: 'insideScoring', value: 25 },
    { op: 'add-rating', field: 'closeShot', value: 20 },
    { op: 'add-rating', field: 'midrange', value: 30 },
    { op: 'raise-tendency', field: 'isolationRate', value: 85 },
    { op: 'raise-tendency', field: 'shortMidFrequency', value: 50 },
    { op: 'raise-tendency', field: 'longMidFrequency', value: 80 },
  ],
  butterfingers: [
    { op: 'raise-rating', field: 'insideScoring', value: 99 },
    { op: 'raise-rating', field: 'closeShot', value: 99 },
    { op: 'cap-rating', field: 'ballHandling', value: 20 },
    { op: 'raise-tendency', field: 'turnoverRate', value: 25 },
  ],
  'freak-athlete': [
    { op: 'raise-rating', field: 'vertical', value: 99 },
    { op: 'raise-rating', field: 'insideScoring', value: 99 },
    { op: 'raise-rating', field: 'closeShot', value: 99 },
    { op: 'cap-rating', field: 'threePoint', value: 30 },
    { op: 'cap-rating', field: 'midrange', value: 40 },
  ],
  'the-statue': [
    { op: 'raise-rating', field: 'strength', value: 99 },
    { op: 'raise-rating', field: 'insideScoring', value: 99 },
    { op: 'raise-rating', field: 'closeShot', value: 99 },
    { op: 'raise-tendency', field: 'postUpRate', value: 90 },
    { op: 'cap-rating', field: 'speed', value: 15 },
  ],
  'reverse-evolution': [
    { op: 'height-subtract', inches: 10 },
    { op: 'raise-rating', field: 'perimeterDefense', value: 99 },
    { op: 'raise-rating', field: 'steal', value: 99 },
    { op: 'raise-tendency', field: 'stealAttemptRate', value: 20 },
  ],
};

const TIER_TWO_RULES: Record<
  | 'four-point-dunk'
  | 'golden-assist'
  | 'heat-check'
  | 'second-chance-jackpot'
  | 'and-one-machine'
  | 'possession-refund'
  | 'rebound-loop'
  | 'the-bounty'
  | 'foul-thief'
  | 'basketball-roulette',
  string
> = {
  'four-point-dunk': 'four-point-dunk',
  'golden-assist': 'golden-assist',
  'heat-check': 'heat-check',
  'second-chance-jackpot': 'second-chance-jackpot',
  'and-one-machine': 'and-one-machine',
  'possession-refund': 'possession-refund',
  'rebound-loop': 'rebound-loop',
  'the-bounty': 'the-bounty',
  'foul-thief': 'foul-thief',
  'basketball-roulette': 'basketball-roulette',
};

const TIER_THREE_RULES: Record<
  | 'clone-army'
  | 'time-lord'
  | 'body-snatcher'
  | 'reverse-basketball'
  | 'double-or-nothing'
  | 'the-great-equalizer',
  string
> = {
  'clone-army': 'clone-army',
  'time-lord': 'time-lord',
  'body-snatcher': 'body-snatcher',
  'reverse-basketball': 'reverse-basketball',
  'double-or-nothing': 'double-or-nothing',
  'the-great-equalizer': 'the-great-equalizer',
};

describe('havoc mutation catalog', () => {
  it('ships 14 tier-1, 10 tier-2, and 6 tier-3 definitions', () => {
    const byTier = { 1: 0, 2: 0, 3: 0 };
    for (const definition of HAVOC_MUTATION_DEFINITIONS) byTier[definition.tier] += 1;
    expect(byTier).toEqual({ 1: 14, 2: 10, 3: 6 });
    expect(new Set(HAVOC_MUTATION_DEFINITIONS.map((d) => d.mutationId)).size).toBe(30);
  });

  it('authors player-facing names, descriptions, and downsides within limits', () => {
    for (const definition of HAVOC_MUTATION_DEFINITIONS) {
      expect(definition.name.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeLessThanOrEqual(320);
      expect(definition.downside.length).toBeLessThanOrEqual(320);
    }
    for (const mutationId of [
      'mini-monster',
      'trigger-happy',
      'butterfingers',
      'freak-athlete',
      'the-statue',
      'reverse-evolution',
    ] as const) {
      expect(havocMutationDefinitionOf(mutationId).downside.length).toBeGreaterThan(0);
    }
  });

  it.each(Object.entries(TIER_ONE_OPERATIONS))(
    'tier-1 %s carries its exact launch operations',
    (mutationId, operations) => {
      const definition = havocMutationDefinitionOf(mutationId as HavocMutationId);
      expect(definition.tier).toBe(1);
      expect(definition.operations).toEqual(operations);
      expect(definition.eventRules).toEqual([]);
    },
  );

  it.each(Object.entries(TIER_TWO_RULES))(
    'tier-2 %s owns exactly its event rule',
    (mutationId, rule) => {
      const definition = havocMutationDefinitionOf(mutationId as HavocMutationId);
      expect(definition.tier).toBe(2);
      expect(definition.operations).toEqual([]);
      expect(definition.eventRules).toEqual([rule]);
    },
  );

  it.each(Object.entries(TIER_THREE_RULES))(
    'tier-3 %s owns exactly its event rule',
    (mutationId, rule) => {
      const definition = havocMutationDefinitionOf(mutationId as HavocMutationId);
      expect(definition.tier).toBe(3);
      expect(definition.operations).toEqual([]);
      expect(definition.eventRules).toEqual([rule]);
    },
  );

  it('looks up every launch mutation and rejects unknown ids', () => {
    for (const definition of HAVOC_MUTATION_DEFINITIONS) {
      expect(havocMutationDefinitionOf(definition.mutationId)).toBe(definition);
    }
    expect(() => havocMutationDefinitionOf('ironman' as HavocMutationId)).toThrow();
    expect(() => havocMutationDefinitionOf('final-boss' as HavocMutationId)).toThrow();
  });
});
