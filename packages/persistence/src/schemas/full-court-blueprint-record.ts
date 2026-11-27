import { z } from 'zod';
import {
  FULL_COURT_BLUEPRINT_SCHEMA_VERSION,
  fullCourtBlueprintSchema,
} from '@hoop-rush/data-contracts';

export const fullCourtBlueprintRecordSchema = z.object({
  saveSchemaVersion: z.literal(FULL_COURT_BLUEPRINT_SCHEMA_VERSION),
  key: z.string().min(1),
  blueprint: fullCourtBlueprintSchema,
});
export type StoredFullCourtBlueprint = z.infer<typeof fullCourtBlueprintRecordSchema>;
