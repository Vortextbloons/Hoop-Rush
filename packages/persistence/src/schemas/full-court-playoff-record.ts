import {
  FULL_COURT_PLAYOFFS_VERSION,
  fullCourtPlayoffCheckpointSchema,
  idSchema,
} from '@hoop-rush/data-contracts';
import { z } from 'zod';

export const fullCourtPlayoffRecordSchema = z
  .object({
    saveSchemaVersion: z.literal(FULL_COURT_PLAYOFFS_VERSION),
    runId: idSchema,
    checkpoint: fullCourtPlayoffCheckpointSchema,
  })
  .refine((row) => row.runId === row.checkpoint.runId, 'Full Court playoff run ID mismatch');
export type StoredFullCourtPlayoffs = z.infer<typeof fullCourtPlayoffRecordSchema>;
