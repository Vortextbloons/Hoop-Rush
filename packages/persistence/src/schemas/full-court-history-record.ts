import { z } from 'zod';
import {
  FULL_COURT_HISTORY_SCHEMA_VERSION,
  fullCourtHistoryRecordSchema,
  idSchema,
} from '@hoop-rush/data-contracts';

export const fullCourtHistoryStoredRecordSchema = z
  .object({
    saveSchemaVersion: z.literal(FULL_COURT_HISTORY_SCHEMA_VERSION),
    runId: idSchema,
    completedAtIso: z.iso.datetime(),
    record: fullCourtHistoryRecordSchema,
  })
  .superRefine((row, context) => {
    if (row.record.runId !== row.runId) {
      context.addIssue({
        code: 'custom',
        path: ['record', 'runId'],
        message: 'History record runId must match its storage key',
      });
    }
    if (row.record.completedAtIso !== row.completedAtIso) {
      context.addIssue({
        code: 'custom',
        path: ['completedAtIso'],
        message: 'History completion timestamp must match its index',
      });
    }
  });
export type StoredFullCourtHistory = z.infer<typeof fullCourtHistoryStoredRecordSchema>;
