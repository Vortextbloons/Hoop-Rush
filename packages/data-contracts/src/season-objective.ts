import { z } from 'zod';
import { SEASON_OBJECTIVE_VERSION } from './season-versions.ts';

/**
 * M2.5 block objective contracts (spec/2.0 M2.5, season-objective-v1). Six
 * fixed objectives are offered to the HUMAN franchise in deterministic
 * three-choice sets before each full ten-game block (blocks 0-7); the final
 * two-game block (block 8) has no objective. Objectives are human-only: AI
 * franchises earn only block grants. Selection is a typed command locked
 * into the block submission; evaluation happens at block assembly from
 * saved facts only (never invented numbers). Success awards +1 Influence at
 * block commit; failure awards nothing extra and never refunds prior
 * rewards or the base block grant.
 */

/** The six fixed M2.5 block objectives. */
export const seasonObjectiveIdSchema = z.enum([
  'win-six',
  'defense-108',
  'rebound-plus-20',
  'availability-eight',
  'bench-320',
  'turnover-130',
]);
export type SeasonObjectiveId = z.infer<typeof seasonObjectiveIdSchema>;

/** One catalog entry: identity plus fixed display facts and measure. */
export const seasonObjectiveDefinitionSchema = z.object({
  objectiveId: seasonObjectiveIdSchema,
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(256),
  measure: z.string().min(1).max(256),
});
export type SeasonObjectiveDefinition = z.infer<typeof seasonObjectiveDefinitionSchema>;

/**
 * Frozen catalog of the six fixed objectives (M2.5 brief measures recorded
 * verbatim). The catalog inside `SeasonObjectiveState` must match this set;
 * the engine evaluates from these measures and nothing else.
 */
export const SEASON_OBJECTIVE_CATALOG = [
  {
    objectiveId: 'win-six',
    name: 'Win Six',
    description: "Win at least 6 of the block's team games.",
    measure: "wins >= 6 across the block's team games",
  },
  {
    objectiveId: 'defense-108',
    name: 'Defense 108',
    description: 'Allow at most 1,080 total points across the block.',
    measure: 'pointsAllowed <= 1080 across the block',
  },
  {
    objectiveId: 'rebound-plus-20',
    name: 'Rebound +20',
    description: 'Finish the block with at least a +20 total rebound margin.',
    measure: 'reboundMargin >= 20 across the block',
  },
  {
    objectiveId: 'availability-eight',
    name: 'Availability Eight',
    description: 'Field at least 8 available players at every tipoff (forfeit games excluded).',
    measure: 'tipsWithAtLeastEightAvailable == tipsTotal (forfeit games have no tipoff)',
  },
  {
    objectiveId: 'bench-320',
    name: 'Bench 320',
    description: 'Non-starters record at least 320 total minutes.',
    measure: 'benchMinutes >= 320 across the block',
  },
  {
    objectiveId: 'turnover-130',
    name: 'Turnover 130',
    description: 'Commit at most 130 turnovers across the block.',
    measure: 'turnovers <= 130 across the block',
  },
] as const satisfies readonly SeasonObjectiveDefinition[];

/**
 * Recorded evaluation facts, measured from saved game summaries and
 * aggregates only. `tipCountedGames` counts the games with an actual tipoff:
 * forfeits have no tipoff and are excluded from availability-eight.
 */
export const seasonObjectiveEvaluationFactsSchema = z.object({
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  pointsAllowed: z.number().int().nonnegative(),
  reboundMargin: z.number().int(),
  tipsWithAtLeastEightAvailable: z.number().int().nonnegative(),
  tipsTotal: z.number().int().nonnegative(),
  benchMinutes: z.number().int().nonnegative(),
  turnovers: z.number().int().nonnegative(),
});
export type SeasonObjectiveEvaluationFacts = z.infer<typeof seasonObjectiveEvaluationFactsSchema>;

/**
 * One objective evaluation at block assembly. `success` is derived from the
 * recorded facts through the frozen measure; `tipCountedGames` excludes
 * forfeited games from availability-eight (LEAD DECISION).
 */
export const seasonObjectiveEvaluationSchema = z.object({
  objectiveId: seasonObjectiveIdSchema,
  blockIndex: z.number().int().min(0).max(8),
  success: z.boolean(),
  facts: seasonObjectiveEvaluationFactsSchema,
  tipCountedGames: z.number().int().nonnegative(),
});
export type SeasonObjectiveEvaluation = z.infer<typeof seasonObjectiveEvaluationSchema>;

/**
 * One recorded selection for a block (blocks 0-7). `selectedByCommandId`
 * ties the selection to its typed command; `success` is null until the
 * block assembles its evaluation.
 */
export const seasonObjectiveSelectionSchema = z.object({
  objectiveId: seasonObjectiveIdSchema,
  selectedByCommandId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._:-]*$/),
  success: z.boolean().nullable(),
});
export type SeasonObjectiveSelection = z.infer<typeof seasonObjectiveSelectionSchema>;

/**
 * The run-scoped objective state (schema 1, season-objective-v1): the fixed
 * six-entry catalog and the selections record keyed by block index 0-7 (the
 * final two-game block 8 never selects).
 */
export const seasonObjectiveStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    objectiveVersion: z.literal(SEASON_OBJECTIVE_VERSION),
    catalog: z.array(seasonObjectiveDefinitionSchema).length(6),
    selections: z.record(z.number().int().min(0).max(7), seasonObjectiveSelectionSchema),
  })
  .superRefine((state, ctx) => {
    const ids = new Set<string>();
    for (const entry of state.catalog) {
      if (ids.has(entry.objectiveId)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate objective in catalog: ${entry.objectiveId}`,
        });
      }
      ids.add(entry.objectiveId);
    }
    if (ids.size !== 6) {
      ctx.addIssue({
        code: 'custom',
        message: `catalog must hold all six fixed objectives (found ${String(ids.size)})`,
      });
    }
  });
export type SeasonObjectiveState = z.infer<typeof seasonObjectiveStateSchema>;
