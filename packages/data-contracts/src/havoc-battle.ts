import { z } from 'zod';
import { seedSchema } from './ids.ts';
import { eraSimulationProfileSchema } from './era-sim-profile.ts';
import {
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
  havocVersionSetSchema,
} from './havoc-versions.ts';
import {
  buildHavocEventSchema,
  buildHavocGameTapeSchema,
  buildHavocMutationRollupSchema,
  buildHavocResultSchema,
  buildHavocScoringEntrySchema,
  buildHavocTeamInputSchema,
  havocHomeAwaySchema,
  havocVariantSchema,
} from './havoc-game.ts';

export const havocBattleTeamInputSchema = buildHavocTeamInputSchema(havocHomeAwaySchema);
export type HavocBattleTeamInput = z.infer<typeof havocBattleTeamInputSchema>;

export const havocBattleInputSchema = z
  .object({
    schemaVersion: z.literal(HAVOC_SCHEMA_VERSION),
    rulesVersion: z.literal(HAVOC_RULES_VERSION),
    mutationCatalogVersion: z.literal(HAVOC_MUTATION_CATALOG_VERSION),
    gameNumber: z.number().int().min(1).max(82),
    variant: havocVariantSchema,
    seed: seedSchema,
    profile: eraSimulationProfileSchema,
    home: havocBattleTeamInputSchema,
    away: havocBattleTeamInputSchema,
    versionSet: havocVersionSetSchema,
  })
  .superRefine((input, ctx) => {
    if (input.home.side !== 'home') {
      ctx.addIssue({ code: 'custom', message: 'home team must carry the home side' });
    }
    if (input.away.side !== 'away') {
      ctx.addIssue({ code: 'custom', message: 'away team must carry the away side' });
    }
    if (input.variant === 'normal') {
      if (input.home.clones.length !== 0 || input.away.clones.length !== 0) {
        ctx.addIssue({ code: 'custom', message: 'the normal variant fields no clones' });
      }
      if (
        input.home.starters.some((participant) => participant.mutationPackage.length !== 0) ||
        input.away.starters.some((participant) => participant.mutationPackage.length !== 0)
      ) {
        ctx.addIssue({ code: 'custom', message: 'the normal variant owns no mutations' });
      }
    }
  });
export type HavocBattleInput = z.infer<typeof havocBattleInputSchema>;

export const havocBattleScoringEntrySchema = buildHavocScoringEntrySchema(havocHomeAwaySchema);
export type HavocBattleScoringEntry = z.infer<typeof havocBattleScoringEntrySchema>;

export const havocBattleEventSchema = buildHavocEventSchema(havocHomeAwaySchema);
export type HavocBattleEvent = z.infer<typeof havocBattleEventSchema>;
export type HavocBattleEventKind = HavocBattleEvent['kind'];

export const havocBattleMutationRollupSchema = buildHavocMutationRollupSchema(havocHomeAwaySchema);
export type HavocBattleMutationRollup = z.infer<typeof havocBattleMutationRollupSchema>;

export const havocBattleTapeSchema = buildHavocGameTapeSchema(havocHomeAwaySchema);
export type HavocBattleTape = z.infer<typeof havocBattleTapeSchema>;

export const havocBattleResultSchema = buildHavocResultSchema(havocHomeAwaySchema);
export type HavocBattleResult = z.infer<typeof havocBattleResultSchema>;
