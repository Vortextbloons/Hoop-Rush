import { z } from 'zod';
import { classicDraftStateSchema } from '@hoop-rush/data-contracts';

/**
 * Stored-record schema for the active Classic draft (spec/01 Classic game
 * mode, M4). Exactly one record exists at a time, keyed by the literal
 * 'classic-draft'. Persistence wraps the accepted domain draft state with
 * storage metadata; it never implements draft rules. Every read validates
 * the stored value at the runtime boundary, so corrupt records are surfaced
 * instead of silently entering application state.
 */

export const classicDraftRecordSchema = z.object({
  /** Single active Classic draft slot; at most one row may exist. */
  recordId: z.literal('classic-draft'),
  saveSchemaVersion: z.literal(1),
  draft: classicDraftStateSchema,
  /** Written by the adapter, never by domain logic. */
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredClassicDraft = z.infer<typeof classicDraftRecordSchema>;
