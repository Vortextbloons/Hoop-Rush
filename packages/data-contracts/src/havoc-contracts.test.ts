import { describe, expect, it } from 'vitest';
import {
  HAVOC_MUTATION_IDS,
  HAVOC_TIER_ONE_MUTATION_IDS,
  HAVOC_TIER_THREE_MUTATION_IDS,
  HAVOC_TIER_TWO_MUTATION_IDS,
  havocMutationDefinitionSchema,
  havocMutationPackageSchema,
} from './havoc-mutations.ts';
import { seedSchema } from './ids.ts';
import {
  havocDigestSchema,
  havocVersionSetSchema,
  HAVOC_SCHEMA_VERSION,
} from './havoc-versions.ts';
import {
  havocGameSeed,
  havocDraftCardSeed,
  havocDraftPlayersSeed,
  havocDraftWindowSeed,
  havocMutationStreamSeed,
} from './havoc-seeds.ts';
import { seedFromString } from './season-hash.ts';

const runSeed = seedSchema.parse(seedFromString('havoc-test-run'));

describe('havoc mutation catalog', () => {
  it('ships the launch tier counts', () => {
    expect(HAVOC_TIER_ONE_MUTATION_IDS).toHaveLength(14);
    expect(HAVOC_TIER_TWO_MUTATION_IDS).toHaveLength(10);
    expect(HAVOC_TIER_THREE_MUTATION_IDS).toHaveLength(6);
    expect(new Set(HAVOC_MUTATION_IDS).size).toBe(30);
  });

  it('rejects tier-1 definitions with event rules or no operations', () => {
    expect(
      havocMutationDefinitionSchema.safeParse({
        mutationId: 'sniper-gene',
        tier: 1,
        name: 'Sniper Gene',
        description: 'desc',
        downside: '',
        operations: [{ op: 'raise-rating', field: 'threePoint', value: 97 }],
        eventRules: [],
      }).success,
    ).toBe(true);
    expect(
      havocMutationDefinitionSchema.safeParse({
        mutationId: 'sniper-gene',
        tier: 1,
        name: 'Sniper Gene',
        description: 'desc',
        downside: '',
        operations: [],
        eventRules: [],
      }).success,
    ).toBe(false);
    expect(
      havocMutationDefinitionSchema.safeParse({
        mutationId: 'sniper-gene',
        tier: 1,
        name: 'Sniper Gene',
        description: 'desc',
        downside: '',
        operations: [{ op: 'raise-rating', field: 'threePoint', value: 97 }],
        eventRules: ['heat-check'],
      }).success,
    ).toBe(false);
  });

  it('requires exactly one event rule for tier-2 and tier-3 definitions', () => {
    expect(
      havocMutationDefinitionSchema.safeParse({
        mutationId: 'four-point-dunk',
        tier: 2,
        name: 'Four-Point Dunk',
        description: 'desc',
        downside: '',
        operations: [],
        eventRules: ['four-point-dunk'],
      }).success,
    ).toBe(true);
    expect(
      havocMutationDefinitionSchema.safeParse({
        mutationId: 'clone-army',
        tier: 3,
        name: 'Clone Army',
        description: 'desc',
        downside: '',
        operations: [],
        eventRules: ['clone-army'],
      }).success,
    ).toBe(true);
    expect(
      havocMutationDefinitionSchema.safeParse({
        mutationId: 'clone-army',
        tier: 3,
        name: 'Clone Army',
        description: 'desc',
        downside: '',
        operations: [{ op: 'height-set', inches: 60 }],
        eventRules: ['clone-army'],
      }).success,
    ).toBe(true);
    expect(
      havocMutationDefinitionSchema.safeParse({
        mutationId: 'clone-army',
        tier: 3,
        name: 'Clone Army',
        description: 'desc',
        downside: '',
        operations: [
          { op: 'cap-rating', field: 'threePoint', value: 30 },
          { op: 'cap-rating', field: 'midrange', value: 40 },
          { op: 'cap-rating', field: 'freeThrow', value: 70 },
          { op: 'cap-rating', field: 'ballHandling', value: 20 },
          { op: 'cap-rating', field: 'speed', value: 15 },
        ],
        eventRules: ['clone-army'],
      }).success,
    ).toBe(false);
  });

  it('validates mutation packages', () => {
    expect(
      havocMutationPackageSchema.safeParse([
        { mutationId: 'growth-spurt', sampledHeightDelta: 9 },
        { mutationId: 'sniper-gene' },
      ]).success,
    ).toBe(true);
    expect(havocMutationPackageSchema.safeParse([{ mutationId: 'growth-spurt' }]).success).toBe(
      false,
    );
    expect(
      havocMutationPackageSchema.safeParse([
        { mutationId: 'sniper-gene' },
        { mutationId: 'sniper-gene' },
      ]).success,
    ).toBe(false);
    expect(
      havocMutationPackageSchema.safeParse([{ mutationId: 'sniper-gene', sampledHeightDelta: 8 }])
        .success,
    ).toBe(false);
  });

  it('keeps the version set literal', () => {
    const parsed = havocVersionSetSchema.safeParse({
      schemaVersion: HAVOC_SCHEMA_VERSION,
      rulesVersion: 'havoc-rules-v3',
      mutationCatalogVersion: 'havoc-mutations-v3',
      seedDerivationVersion: 'havoc-seeds-v1',
      engineVersion: 'm3-engine-v24',
      profileVersion: 'p',
      dataVersion: 'd',
      catalogVersion: 'season-draft-catalog-v4',
      catalogHash: 'a'.repeat(64),
      bracketHash: 'b'.repeat(64),
      profileHash: 'c'.repeat(64),
    });
    expect(parsed.success).toBe(true);
    expect(havocDigestSchema.safeParse('f'.repeat(32)).success).toBe(true);
    expect(havocDigestSchema.safeParse('f'.repeat(64)).success).toBe(false);
  });
});

describe('havoc seeds', () => {
  it('derives stable, distinct streams', () => {
    expect(havocGameSeed(runSeed, 1)).toBe(havocGameSeed(runSeed, 1));
    expect(havocGameSeed(runSeed, 1)).not.toBe(havocGameSeed(runSeed, 2));
    expect(havocDraftWindowSeed(runSeed, 1, 0)).not.toBe(havocDraftPlayersSeed(runSeed, 1, 0));
    expect(havocDraftCardSeed(runSeed, 1, 0, 0, 'tier')).not.toBe(
      havocDraftCardSeed(runSeed, 1, 0, 0, 'mutations'),
    );
    expect(havocDraftCardSeed(runSeed, 1, 0, 0, 'tier')).toBe(
      havocDraftCardSeed(runSeed, 1, 0, 0, 'tier'),
    );
    expect(havocMutationStreamSeed(runSeed, 1, 'hvi-0000', 'roulette', 0)).not.toBe(
      havocMutationStreamSeed(runSeed, 1, 'hvi-0000', 'roulette', 1),
    );
    expect(() => havocGameSeed(runSeed, 0)).toThrow();
    expect(() => havocGameSeed(runSeed, 83)).toThrow();
  });
});
