import { z } from 'zod';
import {
  FULL_COURT_COACHING_SCHEMA_VERSION,
  fullCourtCoachingPlanSchema,
  idSchema,
} from '@hoop-rush/data-contracts';

export const fullCourtCoachingRecordSchema = z.object({
  saveSchemaVersion: z.literal(FULL_COURT_COACHING_SCHEMA_VERSION),
  runId: idSchema,
  plan: fullCourtCoachingPlanSchema,
});
export type StoredFullCourtCoaching = z.infer<typeof fullCourtCoachingRecordSchema>;
