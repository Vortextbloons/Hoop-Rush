import { z } from 'zod';
import { commandIdSchema, idSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { SEASON_RUN_SCHEMA_VERSION } from './season-versions.ts';

/**
 * The base fields every M2.5 run command carries. Every command shares this
 * one shape — schema version, commandId, runId, and the expected run state
 * revision/digest the command asserts — so a handler can validate run
 * identity, state freshness (recomputed by the engine), and commandId
 * uniqueness uniformly before evaluating deterministic preconditions.
 * Handlers are PURE engine functions; this module owns the wire shapes.
 *
 * Living in its own module keeps `season-commands.ts` and `season-block.ts`
 * cycle-free while both compose the same envelope.
 */
export const seasonRunCommandBaseSchema = z.object({
  schemaVersion: z.literal(SEASON_RUN_SCHEMA_VERSION),
  commandId: commandIdSchema,
  runId: idSchema,
  expectedStateRevision: z.number().int().nonnegative(),
  expectedStateDigest: seasonCheckpointDigestSchema,
});
export type SeasonRunCommandBase = z.infer<typeof seasonRunCommandBaseSchema>;
