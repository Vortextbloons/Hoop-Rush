import { z } from 'zod';
import { commandIdSchema, idSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { SEASON_RUN_SCHEMA_VERSION } from './season-versions.ts';
export const seasonRunCommandBaseSchema = z.object({
  schemaVersion: z.union([z.literal(SEASON_RUN_SCHEMA_VERSION), z.literal(12), z.literal(11)]),
  commandId: commandIdSchema,
  runId: idSchema,
  expectedStateRevision: z.number().int().nonnegative(),
  expectedStateDigest: seasonCheckpointDigestSchema,
});
export type SeasonRunCommandBase = z.infer<typeof seasonRunCommandBaseSchema>;
export const windowIndexSchema = z.number().int().min(0).max(2);
export const blockIndexSchema = z.number().int().min(0).max(8);
export const objectiveBlockIndexSchema = z.number().int().min(0).max(7);
export const inquiryIdSchema = z.string().regex(/^inq-[0-9a-f]{32}$/);
