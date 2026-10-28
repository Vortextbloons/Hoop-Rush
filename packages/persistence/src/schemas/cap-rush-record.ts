import { z } from 'zod';
import {
  CAP_RUSH_SAVE_SCHEMA_VERSION,
  capRushCommandResultSchema,
  capRushCommandSchema,
  capRushDraftStateSchema,
  capRushDigestSchema,
  commandIdSchema,
  idSchema,
} from '@hoop-rush/data-contracts';

export const CAP_RUSH_ACTIVE_DRAFT_RECORD_ID = 'cap-rush-draft';
const isoDateSchema = z.iso.datetime();

export const storedCapRushDraftRowSchema = z
  .object({
    saveSchemaVersion: z.literal(CAP_RUSH_SAVE_SCHEMA_VERSION),
    recordId: z.literal(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID),
    runId: idSchema,
    revision: z.number().int().nonnegative(),
    stateDigest: capRushDigestSchema,
    draft: capRushDraftStateSchema,
    createdAtIso: isoDateSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.draft.runId !== row.runId) {
      ctx.addIssue({ code: 'custom', message: 'stored draft run id does not match its row' });
    }
    if (row.draft.revision !== row.revision) {
      ctx.addIssue({ code: 'custom', message: 'stored draft revision does not match its row' });
    }
  });
export type StoredCapRushDraftRow = z.infer<typeof storedCapRushDraftRowSchema>;

export const storedCapRushCommandRowSchema = z
  .object({
    saveSchemaVersion: z.literal(CAP_RUSH_SAVE_SCHEMA_VERSION),
    commandId: commandIdSchema,
    runId: idSchema,
    command: capRushCommandSchema,
    result: capRushCommandResultSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.command.commandId !== row.commandId) {
      ctx.addIssue({ code: 'custom', message: 'stored command does not match its command id' });
    }
    if (row.command.runId !== row.runId) {
      ctx.addIssue({ code: 'custom', message: 'stored command does not match its run id' });
    }
    if (row.result.commandId !== row.commandId || row.result.runId !== row.runId) {
      ctx.addIssue({
        code: 'custom',
        message: 'stored result does not match its command envelope',
      });
    }
  });
export type StoredCapRushCommandRow = z.infer<typeof storedCapRushCommandRowSchema>;
