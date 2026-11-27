import { z } from 'zod';
import {
  FULL_COURT_NEXT_GAME_PLAN_SCHEMA_VERSION,
  fullCourtNextGamePlanSchema,
  idSchema,
} from '@hoop-rush/data-contracts';

export const fullCourtNextGamePlanRecordSchema = z.object({
  saveSchemaVersion: z.literal(FULL_COURT_NEXT_GAME_PLAN_SCHEMA_VERSION),
  runId: idSchema,
  plan: fullCourtNextGamePlanSchema,
});
export type StoredFullCourtNextGamePlan = z.infer<typeof fullCourtNextGamePlanRecordSchema>;
