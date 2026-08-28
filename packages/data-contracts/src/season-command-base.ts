import { z } from 'zod';
import { commandIdSchema, idSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { SEASON_RUN_SCHEMA_VERSION } from './season-versions.ts';
export const seasonRunCommandBaseSchema = z.object({
    schemaVersion: z.union([z.literal(SEASON_RUN_SCHEMA_VERSION), z.literal(11)]),
    commandId: commandIdSchema,
    runId: idSchema,
    expectedStateRevision: z.number().int().nonnegative(),
    expectedStateDigest: seasonCheckpointDigestSchema,
});
export type SeasonRunCommandBase = z.infer<typeof seasonRunCommandBaseSchema>;
