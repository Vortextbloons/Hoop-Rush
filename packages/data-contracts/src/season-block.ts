import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { seasonCandidateCheckpointSchema } from './season-checkpoint.ts';
import { SEASON_BLOCK_VERSION, SEASON_RUN_SCHEMA_VERSION } from './season-versions.ts';

/**
 * SubmitSeasonBlock command and its typed results (spec/2.0/07 required
 * command groups, M2.3, season-block-v1). Submitting a block locks the
 * submitted rotations for the block's games: the command carries the
 * canonical digest of the 30-rotation set so a stale or tampered lock is
 * rejected before any simulation runs. The engine validates the cursor,
 * revision, block boundary, command duplication, run identity, and rotation
 * legality; it returns one candidate checkpoint or one typed rejection.
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

export const seasonSubmitBlockRejectionSchema = z.discriminatedUnion('code', [
  seasonStaleCursorRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonInvalidRotationsRejectionSchema,
  seasonNonBoundaryBlockRejectionSchema,
  seasonRunMismatchRejectionSchema,
]);
export type SeasonSubmitBlockRejection = z.infer<typeof seasonSubmitBlockRejectionSchema>;

export const seasonSubmitBlockResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('rejected'), rejection: seasonSubmitBlockRejectionSchema }),
  z.object({ status: z.literal('accepted'), checkpoint: seasonCandidateCheckpointSchema }),
]);
export type SeasonSubmitBlockResult = z.infer<typeof seasonSubmitBlockResultSchema>;
