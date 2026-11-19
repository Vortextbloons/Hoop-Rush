import { z } from 'zod';
import {
  FULL_COURT_DRAFT_SCHEMA_VERSION,
  commandIdSchema,
  fullCourtCommandResultSchema,
  fullCourtCommandSchema,
  fullCourtDigestSchema,
  fullCourtDraftStateSchema,
  idSchema,
} from '@hoop-rush/data-contracts';

export const fullCourtDraftRecordSchema = z
  .object({
    saveSchemaVersion: z.literal(FULL_COURT_DRAFT_SCHEMA_VERSION),
    runId: idSchema,
    state: fullCourtDraftStateSchema,
    stateDigest: fullCourtDigestSchema,
  })
  .refine((row) => row.runId === row.state.runId, { message: 'Draft run ID differs from its key' });
export type StoredFullCourtDraft = z.infer<typeof fullCourtDraftRecordSchema>;

export const fullCourtDraftCommandRecordSchema = z
  .object({
    saveSchemaVersion: z.literal(FULL_COURT_DRAFT_SCHEMA_VERSION),
    runId: idSchema,
    commandId: commandIdSchema,
    command: fullCourtCommandSchema,
    result: fullCourtCommandResultSchema,
  })
  .refine(
    ({ runId, commandId, command, result }) =>
      command.runId === runId &&
      result.runId === runId &&
      command.commandId === commandId &&
      result.commandId === commandId &&
      (result.status === 'accepted'
        ? result.rejection === null &&
          result.revisionAfter === result.revisionBefore + 1 &&
          result.revisionBefore ===
            (command.command === 'create-full-court-draft' ? 0 : command.expectedRevision)
        : result.rejection !== null && result.revisionAfter === result.revisionBefore),
    { message: 'Command receipt does not match the draft command' },
  );
export type StoredFullCourtDraftCommand = z.infer<typeof fullCourtDraftCommandRecordSchema>;
