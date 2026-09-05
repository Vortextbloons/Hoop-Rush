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
export const seasonRunMismatchRejectionSchema = z.object({
  code: z.literal('run-mismatch'),
  expectedRunId: z.string().min(1).max(64),
});
export type SeasonRunMismatchRejection = z.infer<typeof seasonRunMismatchRejectionSchema>;
export const seasonDuplicateCommandRejectionSchema = z.object({
  code: z.literal('duplicate-command'),
  commandId: z.string().min(1).max(64),
});
export type SeasonDuplicateCommandRejection = z.infer<typeof seasonDuplicateCommandRejectionSchema>;
export const seasonStaleStateRejectionSchema = z.object({
  code: z.literal('stale-state'),
  expectedStateRevision: z.number().int().nonnegative(),
  expectedStateDigest: seasonCheckpointDigestSchema,
  currentStateRevision: z.number().int().nonnegative(),
  currentStateDigest: seasonCheckpointDigestSchema,
});
export type SeasonStaleStateRejection = z.infer<typeof seasonStaleStateRejectionSchema>;
export const blockIndexSchema = z.number().int().min(0).max(8);
export const objectiveBlockIndexSchema = z.number().int().min(0).max(7);
export const inquiryIdSchema = z.string().regex(/^inq-[0-9a-f]{32}$/);
