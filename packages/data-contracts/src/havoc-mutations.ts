import { z } from 'zod';
import { REQUIRED_RATING_KEYS } from './simulation.ts';

export const HAVOC_TIER_ONE_MUTATION_IDS = [
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
  'opposite-day',
  'tiny-titan',
  'mr-everything',
  'foul-merchant',
  'the-specialist',
] as const;

export const HAVOC_TIER_TWO_MUTATION_IDS = [
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
  'buzzer-bandit',
  'charity-casino',
] as const;

export const HAVOC_TIER_THREE_MUTATION_IDS = [
  'clone-army',
  'time-lord',
  'body-snatcher',
  'reverse-basketball',
  'double-or-nothing',
  'the-great-equalizer',
  'fusion-dance',
  'basketball-darwinism',
] as const;

export const HAVOC_MUTATION_IDS = [
  ...HAVOC_TIER_ONE_MUTATION_IDS,
  ...HAVOC_TIER_TWO_MUTATION_IDS,
  ...HAVOC_TIER_THREE_MUTATION_IDS,
] as const;

export const havocMutationIdSchema = z.enum([
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
  'opposite-day',
  'tiny-titan',
  'mr-everything',
  'foul-merchant',
  'the-specialist',
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
  'buzzer-bandit',
  'charity-casino',
  'clone-army',
  'time-lord',
  'body-snatcher',
  'reverse-basketball',
  'double-or-nothing',
  'the-great-equalizer',
  'fusion-dance',
  'basketball-darwinism',
]);
export type HavocMutationId = z.infer<typeof havocMutationIdSchema>;

export const HAVOC_TEAM_EXCLUSIVE_MUTATION_IDS: readonly HavocMutationId[] = [
  'time-lord',
  'reverse-basketball',
  'the-great-equalizer',
  'fusion-dance',
];

export const havocTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type HavocTier = z.infer<typeof havocTierSchema>;

export const HAVOC_TENDENCY_FIELDS = [
  'usageRate',
  'passRate',
  'shotRate',
  'driveRate',
  'postUpRate',
  'rimFrequency',
  'shortMidFrequency',
  'longMidFrequency',
  'cornerThreeFrequency',
  'aboveBreakThreeFrequency',
  'threePointRate',
  'freeThrowRate',
  'turnoverRate',
  'isolationRate',
  'pickAndRollBallHandlerRate',
  'pickAndRollRollManRate',
  'spotUpRate',
  'transitionRate',
  'cutRate',
  'foulRate',
  'stealAttemptRate',
  'blockAttemptRate',
  'crashOffensiveGlassRate',
] as const;

export const havocRatingFieldSchema = z.enum(REQUIRED_RATING_KEYS);
export type HavocRatingField = z.infer<typeof havocRatingFieldSchema>;
export const havocTendencyFieldSchema = z.enum(HAVOC_TENDENCY_FIELDS);
export type HavocTendencyField = z.infer<typeof havocTendencyFieldSchema>;

export const HAVOC_SPECIALIST_CATEGORY_IDS = [
  'scoring',
  'playmaking',
  'defense',
  'rebounding',
  'athleticism',
] as const;
export const havocSpecialistCategorySchema = z.enum(HAVOC_SPECIALIST_CATEGORY_IDS);
export type HavocSpecialistCategory = z.infer<typeof havocSpecialistCategorySchema>;

export const HAVOC_SPECIALIST_CATEGORY_RATINGS: Readonly<
  Record<HavocSpecialistCategory, readonly HavocRatingField[]>
> = {
  scoring: ['insideScoring', 'closeShot', 'midrange', 'threePoint', 'freeThrow'],
  playmaking: ['ballHandling', 'passing', 'offensiveIq'],
  defense: ['perimeterDefense', 'interiorDefense', 'steal', 'block', 'defensiveIq'],
  rebounding: ['offensiveRebound', 'defensiveRebound'],
  athleticism: ['speed', 'strength', 'vertical'],
};

export const HAVOC_SCORING_RATING_FIELDS: readonly HavocRatingField[] =
  HAVOC_SPECIALIST_CATEGORY_RATINGS.scoring;

export const havocProfileOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('raise-rating'),
    field: havocRatingFieldSchema,
    value: z.number().int().min(0).max(100),
  }),
  z.object({
    op: z.literal('raise-tendency'),
    field: havocTendencyFieldSchema,
    value: z.number().min(0).max(100),
  }),
  z.object({
    op: z.literal('cap-rating'),
    field: havocRatingFieldSchema,
    value: z.number().int().min(0).max(100),
  }),
  z.object({
    op: z.literal('cap-tendency'),
    field: havocTendencyFieldSchema,
    value: z.number().min(0).max(100),
  }),
  z.object({
    op: z.literal('add-rating'),
    field: havocRatingFieldSchema,
    value: z.number().int().min(-100).max(100),
  }),
  z.object({
    op: z.literal('add-tendency'),
    field: havocTendencyFieldSchema,
    value: z.number().min(-100).max(100),
  }),
  z.object({
    op: z.literal('height-add'),
    minInches: z.number().int().min(1).max(36),
    maxInches: z.number().int().min(1).max(36),
  }),
  z.object({
    op: z.literal('height-set'),
    inches: z.number().int().min(50).max(108),
  }),
  z.object({
    op: z.literal('height-subtract'),
    inches: z.number().int().min(1).max(108),
  }),
  z.object({
    op: z.literal('reach-add'),
    inches: z.number().int().min(1).max(36),
  }),
  z.object({
    op: z.literal('set-rating'),
    field: havocRatingFieldSchema,
    value: z.number().int().min(0).max(100),
  }),
  z.object({
    op: z.literal('shift-extreme-ratings'),
    count: z.number().int().min(1).max(9),
    bestDelta: z.number().int().min(-100).max(100),
    worstDelta: z.number().int().min(-100).max(100),
  }),
  z.object({
    op: z.literal('set-category-ratings'),
    value: z.number().int().min(0).max(100),
  }),
  z.object({
    op: z.literal('add-outside-category-ratings'),
    value: z.number().int().min(-100).max(100),
  }),
]);
export type HavocProfileOperation = z.infer<typeof havocProfileOperationSchema>;

export const havocAuthoritativeChannelSchema = z.enum([
  'two-point-accuracy',
  'three-point-accuracy',
  'three-point-volume',
  'free-throw-accuracy',
  'block-anchor',
  'assist-anchor',
  'rebound-weights',
  'turnover-blend',
  'offensive-allocation',
]);
export type HavocAuthoritativeChannel = z.infer<typeof havocAuthoritativeChannelSchema>;

export const havocEventRuleIdSchema = z.enum([
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
  'buzzer-bandit',
  'charity-casino',
  'fusion-dance',
  'basketball-darwinism',
]);
export type HavocEventRuleId = z.infer<typeof havocEventRuleIdSchema>;

export const havocMutationDefinitionSchema = z
  .object({
    mutationId: havocMutationIdSchema,
    tier: havocTierSchema,
    name: z.string().min(1).max(64),
    description: z.string().min(1).max(320),
    downside: z.string().max(320),
    operations: z.array(havocProfileOperationSchema).max(48),
    eventRules: z.array(havocEventRuleIdSchema).max(1),
    teamExclusive: z.boolean().optional(),
  })
  .superRefine((definition, ctx) => {
    if (definition.tier === 1) {
      if (definition.operations.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'tier-1 mutations require profile operations' });
      }
      if (definition.eventRules.length !== 0) {
        ctx.addIssue({ code: 'custom', message: 'tier-1 mutations cannot own event rules' });
      }
      return;
    }
    if (definition.eventRules.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'tier-2/3 mutations require exactly one event rule',
      });
    }
    if (definition.operations.length > 4) {
      ctx.addIssue({
        code: 'custom',
        message: 'tier-2/3 mutations own at most four downside profile operations',
      });
    }
  });
export type HavocMutationDefinition = z.infer<typeof havocMutationDefinitionSchema>;

export const havocMutationEntrySchema = z
  .object({
    mutationId: havocMutationIdSchema,
    sampledHeightDelta: z.number().int().min(6).max(12).optional(),
    specialistCategory: havocSpecialistCategorySchema.optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.mutationId === 'growth-spurt') {
      if (entry.sampledHeightDelta === undefined) {
        ctx.addIssue({ code: 'custom', message: 'growth-spurt requires a sampled height delta' });
      }
    } else if (entry.sampledHeightDelta !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `sampled height delta is only valid for growth-spurt (${entry.mutationId})`,
      });
    }
    if (entry.mutationId === 'the-specialist') {
      if (entry.specialistCategory === undefined) {
        ctx.addIssue({ code: 'custom', message: 'the-specialist requires a sampled category' });
      }
    } else if (entry.specialistCategory !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `specialist category is only valid for the-specialist (${entry.mutationId})`,
      });
    }
  });
export type HavocMutationEntry = z.infer<typeof havocMutationEntrySchema>;

export const havocMutationPackageSchema = z
  .array(havocMutationEntrySchema)
  .max(3)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.mutationId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate mutation ${entry.mutationId}` });
      }
      seen.add(entry.mutationId);
    }
  });
export type HavocMutationPackage = z.infer<typeof havocMutationPackageSchema>;
