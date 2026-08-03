import { z } from 'zod';
import { eraIdSchema, franchiseIdSchema, playerIdSchema, seedSchema } from './ids.js';
import { slotIndexSchema } from './lineup.js';
import { positionUnionSchema } from './positions.js';
import { CLASSIC_DRAFT_SCHEMA_VERSION } from './versions.js';

/**
 * Classic draft contracts (spec/01 Classic game mode, M4). Classic builds the
 * user's five through five deterministic franchise-era rolls with one franchise
 * and one era reroll across the whole draft. The draft state is authoritative
 * domain data: every roll derives from the saved seed plus the round and reroll
 * event, so drafts resume and reproduce byte-for-byte.
 */

export const classicVariantSchema = z.enum(['ratings', 'ball-knowledge']);
export type ClassicVariant = z.infer<typeof classicVariantSchema>;

export const classicRoundSchema = z.number().int().min(1).max(5);
export type ClassicRound = z.infer<typeof classicRoundSchema>;

export const classicDraftStatusSchema = z.enum(['drafting', 'complete']);
export type ClassicDraftStatus = z.infer<typeof classicDraftStatusSchema>;

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
export type ClassicRerollState = z.infer<typeof classicRerollStateSchema>;

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
    /** Immutable. Every roll derives from this seed plus round and reroll event. */
    seed: seedSchema,
    /** Data snapshot the rolls were derived against (frozen at creation). */
    dataVersion: z.string().min(1).max(64),
    round: classicRoundSchema,
    status: classicDraftStatusSchema,
    /** Current roll for the round; null once the draft is complete. */
    roll: classicRollContextSchema.nullable(),
    rerolls: classicRerollStateSchema,
    /** Accepted picks in round order; at most five, unique playerIds and slotIndexes. */
    picks: z.array(classicPickSchema).max(5),
  })
  .superRefine((state, ctx) => {
    // A drafting draft always carries an active roll; a null roll is only
    // legal once the draft is complete.
    if (state.status === 'drafting' && state.roll === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'a drafting classic draft must carry an active roll',
      });
    }
  });
export type ClassicDraftState = z.infer<typeof classicDraftStateSchema>;

/** Draft snapshot persisted on classic runs (run.classicDraft). */
export const classicCompletedDraftSchema = z.object({
  draftId: z.string().min(1).max(64),
  variant: classicVariantSchema,
  seed: seedSchema,
  /** Exactly five accepted picks in round order. */
  picks: z.array(classicPickSchema).length(5),
});
export type ClassicCompletedDraft = z.infer<typeof classicCompletedDraftSchema>;

/** Minimal per-player catalog record used to derive rolls without pool loads. */
export const classicCatalogPlayerSchema = z.object({
  playerId: playerIdSchema,
  /** Career-wide detailed playable union (PG/SG/SF/PF/C). */
  positions: positionUnionSchema,
});
export type ClassicCatalogPlayer = z.infer<typeof classicCatalogPlayerSchema>;

export const classicCatalogEntrySchema = z.object({
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  players: z.array(classicCatalogPlayerSchema),
});
export type ClassicCatalogEntry = z.infer<typeof classicCatalogEntrySchema>;

/** Draft-command surface alias for a catalog entry (classicCatalogEntrySchema). */
export type ClassicDraftCatalogEntry = ClassicCatalogEntry;

export const classicDraftCatalogSchema = z.array(classicCatalogEntrySchema).min(1);
export type ClassicDraftCatalog = z.infer<typeof classicDraftCatalogSchema>;
