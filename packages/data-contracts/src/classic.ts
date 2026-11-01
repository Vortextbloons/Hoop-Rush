import { z } from 'zod';
import { eraIdSchema, franchiseIdSchema, playerIdSchema, seedSchema } from './ids.ts';
import { slotIndexSchema } from './lineup.ts';
import { positionUnionSchema } from './positions.ts';
import { CLASSIC_DRAFT_SCHEMA_VERSION } from './versions.ts';
export const classicVariantSchema = z.enum(['ratings', 'ball-knowledge']);
export type ClassicVariant = z.infer<typeof classicVariantSchema>;
export const classicRoundSchema = z.number().int().min(1).max(5);
export const classicDraftStatusSchema = z.enum(['drafting', 'complete']);
export const classicRollContextSchema = z.object({
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
});
export type ClassicRollContext = z.infer<typeof classicRollContextSchema>;
export const classicRerollStateSchema = z.object({
  franchiseSpent: z.boolean(),
  franchiseRound: classicRoundSchema.optional(),
  eraSpent: z.boolean(),
  eraRound: classicRoundSchema.optional(),
});
export const classicPickSchema = z.object({
  round: classicRoundSchema,
  playerId: playerIdSchema,
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  slotIndex: slotIndexSchema,
});
export type ClassicPick = z.infer<typeof classicPickSchema>;
export const classicDraftStateSchema = z
  .object({
    schemaVersion: z.literal(CLASSIC_DRAFT_SCHEMA_VERSION),
    draftId: z.string().min(1).max(64),
    variant: classicVariantSchema,
    seed: seedSchema,
    dataVersion: z.string().min(1).max(64),
    round: classicRoundSchema,
    status: classicDraftStatusSchema,
    roll: classicRollContextSchema.nullable(),
    rerolls: classicRerollStateSchema,
    picks: z.array(classicPickSchema).max(5),
  })
  .superRefine((state, ctx) => {
    if (state.status === 'drafting' && state.roll === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'a drafting classic draft must carry an active roll',
      });
    }
  });
export type ClassicDraftState = z.infer<typeof classicDraftStateSchema>;
export const classicCompletedDraftSchema = z.object({
  draftId: z.string().min(1).max(64),
  variant: classicVariantSchema,
  seed: seedSchema,
  picks: z.array(classicPickSchema).length(5),
});
export type ClassicCompletedDraft = z.infer<typeof classicCompletedDraftSchema>;
export const classicCatalogPlayerSchema = z.object({
  playerId: playerIdSchema,
  positions: positionUnionSchema,
});
export const classicCatalogEntrySchema = z.object({
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  players: z.array(classicCatalogPlayerSchema),
});
export type ClassicCatalogEntry = z.infer<typeof classicCatalogEntrySchema>;
export type ClassicDraftCatalogEntry = ClassicCatalogEntry;
export const classicDraftCatalogSchema = z.array(classicCatalogEntrySchema).min(1);
export type ClassicDraftCatalog = z.infer<typeof classicDraftCatalogSchema>;
