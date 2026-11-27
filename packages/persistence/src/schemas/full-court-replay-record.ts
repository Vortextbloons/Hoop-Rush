import {
  FULL_COURT_WATCHED_REPLAY_SCHEMA_VERSION,
  fullCourtWatchedReplaySchema,
  idSchema,
} from '@hoop-rush/data-contracts';
import { z } from 'zod';

export const fullCourtWatchedReplayRecordSchema = z
  .object({
    saveSchemaVersion: z.literal(FULL_COURT_WATCHED_REPLAY_SCHEMA_VERSION),
    runId: idSchema,
    replay: fullCourtWatchedReplaySchema,
    updatedAtIso: z.iso.datetime(),
  })
  .refine((row) => row.runId === row.replay.identity.runId, {
    message: 'Full Court watched replay run ID differs from its key',
  });
export type StoredFullCourtWatchedReplay = z.infer<typeof fullCourtWatchedReplayRecordSchema>;
