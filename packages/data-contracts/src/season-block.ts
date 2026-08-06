import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { seasonCandidateCheckpointSchema } from './season-checkpoint.ts';
import { seasonObjectiveIdSchema } from './season-objective.ts';
import { SEASON_BLOCK_VERSION, SEASON_RUN_SCHEMA_VERSION } from './season-versions.ts';

/**
 * SubmitSeasonBlock command and its typed results (spec/2.0/07 required
 * command groups, M2.3, season-block-v1; M2.5 adds the locked objective and
 * the run state assertions). Submitting a block locks the submitted
 * rotations for the block's games: the command carries the canonical digest
 * of the 30-rotation set so a stale or tampered lock is rejected before any
 * simulation runs. M2.5: the command also carries the locked objective id
 * (null for the final two-game block 8) and the expected run state
 * revision/digest the block assembles against. The engine validates the
 * cursor, revision, block boundary, command duplication, run identity,
 * rotation legality, and objective binding; it returns one candidate
 * checkpoint or one typed rejection.
 */

export const seasonSubmitBlockCommandSchema = z.object({
  schemaVersion: z.literal(SEASON_RUN_SCHEMA_VERSION),
  blockVersion: z.literal(SEASON_BLOCK_VERSION),
  command: z.literal('submit-season-block'),
  /** Unique command id; the same id is rejected twice (no double commits). */
  commandId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._:-]*$/),
  runId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._:-]*$/),
  /** Must equal the run's accepted-block count; stale cursors are rejected. */
  expectedRevision: z.number().int().nonnegative(),
  /** 0-based block index to simulate. */
  blockIndex: z.number().int().min(0).max(8),
  /** Canonical digest of the 30 rotations being locked for this block. */
  rotationDigest: z.string().regex(/^[0-9a-f]{32}$/),
  /**
   * M2.5: the locked block objective (blocks 0-7), or null for the final
   * two-game block 8. Must have been selected and offered for this block.
   */
  objectiveId: seasonObjectiveIdSchema.nullable(),
  /** M2.5: the run state facts this submission asserts. */
  expectedStateRevision: z.number().int().nonnegative(),
  expectedStateDigest: z.string().regex(/^[0-9a-f]{32}$/),
});
export type SeasonSubmitBlockCommand = z.infer<typeof seasonSubmitBlockCommandSchema>;

export const seasonStaleCursorRejectionSchema = z.object({
  code: z.literal('stale-cursor'),
  /** The run's current accepted-block count. */
  currentRevision: z.number().int().nonnegative(),
  currentCompletedRounds: z.number().int().min(0).max(82),
});
export type SeasonStaleCursorRejection = z.infer<typeof seasonStaleCursorRejectionSchema>;

export const seasonDuplicateCommandRejectionSchema = z.object({
  code: z.literal('duplicate-command'),
  commandId: z.string().min(1).max(64),
});
export type SeasonDuplicateCommandRejection = z.infer<typeof seasonDuplicateCommandRejectionSchema>;

export const seasonInvalidRotationsRejectionSchema = z.object({
  code: z.literal('invalid-rotations'),
  /** One entry per franchise with failing rotations. */
  franchiseFailures: z.array(
    z.object({
      franchiseId: franchiseIdSchema,
      reasons: z.array(z.string().min(1).max(256)).min(1),
    }),
  ),
});
export type SeasonInvalidRotationsRejection = z.infer<typeof seasonInvalidRotationsRejectionSchema>;

export const seasonNonBoundaryBlockRejectionSchema = z.object({
  code: z.literal('non-boundary-block'),
  /** The block the run cursor actually expects next. */
  expectedBlockIndex: z.number().int().min(0).max(8),
  submittedBlockIndex: z.number().int().min(0).max(8),
});
export type SeasonNonBoundaryBlockRejection = z.infer<typeof seasonNonBoundaryBlockRejectionSchema>;

export const seasonRunMismatchRejectionSchema = z.object({
  code: z.literal('run-mismatch'),
  expectedRunId: z.string().min(1).max(64),
});
export type SeasonRunMismatchRejection = z.infer<typeof seasonRunMismatchRejectionSchema>;

/**
 * M2.5: the submitted objective does not bind to this block. `expected` is
 * `required` when blocks 0-7 need the selected objective, `none` when block
 * 8 must carry null, and `not-offered` when the objective was never offered
 * for this block.
 */
export const seasonInvalidObjectiveRejectionSchema = z.object({
  code: z.literal('invalid-objective'),
  expected: z.enum(['required', 'none', 'not-offered']),
  /** The submitted objective id when one was present. */
  objectiveId: z.string().min(1).max(64).optional(),
  blockIndex: z.number().int().min(0).max(8),
});
export type SeasonInvalidObjectiveRejection = z.infer<typeof seasonInvalidObjectiveRejectionSchema>;

export const seasonSubmitBlockRejectionSchema = z.discriminatedUnion('code', [
  seasonStaleCursorRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonInvalidRotationsRejectionSchema,
  seasonNonBoundaryBlockRejectionSchema,
  seasonRunMismatchRejectionSchema,
  seasonInvalidObjectiveRejectionSchema,
]);
export type SeasonSubmitBlockRejection = z.infer<typeof seasonSubmitBlockRejectionSchema>;

export const seasonSubmitBlockResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('rejected'), rejection: seasonSubmitBlockRejectionSchema }),
  z.object({ status: z.literal('accepted'), checkpoint: seasonCandidateCheckpointSchema }),
]);
export type SeasonSubmitBlockResult = z.infer<typeof seasonSubmitBlockResultSchema>;
