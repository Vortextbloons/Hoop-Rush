import { z } from 'zod';
import { CLASSIC_DRAFT_SCHEMA_VERSION, classicDraftStateSchema } from '@hoop-rush/data-contracts';
export const classicDraftRecordSchema = z.object({
  recordId: z.literal('classic-draft'),
  saveSchemaVersion: z.literal(CLASSIC_DRAFT_SCHEMA_VERSION),
  draft: classicDraftStateSchema,
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredClassicDraft = z.infer<typeof classicDraftRecordSchema>;
