import { z } from 'zod';
import { collectionCardIdSchema } from './collection.ts';
import { COLLECTION_OBJECTIVE_VERSION } from './collection-versions.ts';

export const collectionObjectiveIdSchema = z.enum([
  'obj-three-barrage-v1',
  'obj-lock-score-v1',
  'obj-bench-spark-v1',
  'obj-ball-pressure-v1',
  'obj-own-glass-v1',
  'obj-box-score-star-v1',
]);
export type CollectionObjectiveId = z.infer<typeof collectionObjectiveIdSchema>;

export const COLLECTION_OBJECTIVE_IDS = collectionObjectiveIdSchema.options;

export const collectionDoubleStatCategorySchema = z.enum([
  'points',
  'totalRebounds',
  'assists',
  'steals',
  'blocks',
]);
export type CollectionDoubleStatCategory = z.infer<typeof collectionDoubleStatCategorySchema>;

export const collectionObjectiveConditionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('player-team-three-pointers-made'),
      threshold: z.number().int().min(0).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal('cpu-team-points-at-most'),
      threshold: z.number().int().min(0).max(300),
    })
    .strict(),
  z
    .object({
      kind: z.literal('player-bench-points-at-least'),
      threshold: z.number().int().min(0).max(300),
    })
    .strict(),
  z
    .object({
      kind: z.literal('cpu-team-turnovers-at-least'),
      threshold: z.number().int().min(0).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal('player-rebound-margin-at-least'),
      threshold: z.number().int().min(-200).max(200),
    })
    .strict(),
  z
    .object({
      kind: z.literal('player-double-stat'),
      threshold: z.number().int().min(1).max(100),
      categories: z.number().int().min(2).max(5),
    })
    .strict(),
]);
export type CollectionObjectiveCondition = z.infer<typeof collectionObjectiveConditionSchema>;

export const collectionObjectiveFeasibilityRequirementSchema = z
  .object({
    minimumBenchPlayers: z.number().int().nonnegative(),
    minimumPlannedBenchMinutes: z.number().int().nonnegative(),
  })
  .strict();
export type CollectionObjectiveFeasibilityRequirement = z.infer<
  typeof collectionObjectiveFeasibilityRequirementSchema
>;

export const collectionObjectiveDefinitionSchema = z
  .object({
    objectiveVersion: z.literal(COLLECTION_OBJECTIVE_VERSION),
    objectiveId: collectionObjectiveIdSchema,
    title: z.string().min(1).max(64),
    condition: collectionObjectiveConditionSchema,
    feasibility: collectionObjectiveFeasibilityRequirementSchema,
  })
  .strict();
export type CollectionObjectiveDefinition = z.infer<typeof collectionObjectiveDefinitionSchema>;

export const collectionObjectiveOfferSchema = z
  .object({
    objectiveVersion: z.literal(COLLECTION_OBJECTIVE_VERSION),
    objectiveId: collectionObjectiveIdSchema,
    title: z.string().min(1).max(64),
    condition: collectionObjectiveConditionSchema,
  })
  .strict();
export type CollectionObjectiveOffer = z.infer<typeof collectionObjectiveOfferSchema>;

export const collectionObjectiveFeasibilityFactsSchema = z
  .object({
    rosterSize: z.number().int().nonnegative(),
    benchPlayerCount: z.number().int().nonnegative(),
    plannedBenchMinutes: z.number().int().nonnegative(),
  })
  .strict();
export type CollectionObjectiveFeasibilityFacts = z.infer<
  typeof collectionObjectiveFeasibilityFactsSchema
>;

export const collectionObjectiveSelectionSchema = z
  .object({
    objectiveId: collectionObjectiveIdSchema.nullable(),
  })
  .strict();
export type CollectionObjectiveSelection = z.infer<typeof collectionObjectiveSelectionSchema>;

export const collectionObjectiveSupportingFactSchema = z
  .object({
    cardId: collectionCardIdSchema,
    category: z.enum(['points', 'totalRebounds', 'assists', 'steals', 'blocks']),
    value: z.number().int().nonnegative(),
  })
  .strict();
export type CollectionObjectiveSupportingFact = z.infer<
  typeof collectionObjectiveSupportingFactSchema
>;

export const collectionObjectiveEvaluationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not-selected') }).strict(),
  z
    .object({
      kind: z.literal('forfeit'),
      objectiveId: collectionObjectiveIdSchema,
      success: z.literal(false),
      explanation: z.string().min(1).max(240),
    })
    .strict(),
  z
    .object({
      kind: z.literal('evaluated'),
      objectiveId: collectionObjectiveIdSchema,
      condition: collectionObjectiveConditionSchema,
      threshold: z.number().int(),
      actualValue: z.number().int(),
      success: z.boolean(),
      supportingCardIds: z.array(collectionCardIdSchema),
      supportingFacts: z.array(collectionObjectiveSupportingFactSchema),
      explanation: z.string().min(1).max(240),
    })
    .strict(),
]);
export type CollectionObjectiveEvaluation = z.infer<typeof collectionObjectiveEvaluationSchema>;

export function collectionObjectiveThresholdOf(condition: CollectionObjectiveCondition): number {
  return condition.threshold;
}

export function collectionObjectiveFeasible(input: {
  requirement: CollectionObjectiveFeasibilityRequirement;
  facts: CollectionObjectiveFeasibilityFacts;
}): boolean {
  return (
    input.facts.benchPlayerCount >= input.requirement.minimumBenchPlayers &&
    input.facts.plannedBenchMinutes >= input.requirement.minimumPlannedBenchMinutes
  );
}
