import { z } from 'zod';
import { franchiseIdSchema, seedSchema, contentHashSchema } from './ids.ts';
import { seasonCandidateCheckpointSchema } from './season-checkpoint.ts';
import { seasonEffectsStateSchema } from './season-effects.ts';
import { seasonGameSummarySchema } from './season-game-summary.ts';
import { seasonHomeCourtProfileSchema } from './season-home-court.ts';
import { seasonBlockRunContextSchema } from './season-run.ts';
import { seasonScheduleSchema } from './season-schedule.ts';

/**
 * Season Run block worker envelopes (spec/2.0/07 background execution, M2.3).
 * Schema version 3 slims the block wire: the start request carries only the
 * run context the block pipeline reads (identity, cursor, league, rosters,
 * locked rotations, versions) — the 1,230 scheduled `games`, standings,
 * draft, ownership, postseason, AI assignments, evaluations, and generation
 * audit stay in the persisted snapshot. Prior summaries travel once per
 * fresh worker (`priorSummaries`, full reset) or as a per-block delta
 * (`newSummaries`, appended by the persistent worker); exactly one form is
 * required. The worker receives one validated block input — the run context
 * at the boundary, the schedule, the home-court profile, prior compact
 * summaries, and the asset urls/hashes for the catalog and era profile it
 * fetches and verifies itself — never touches IndexedDB, throttles progress
 * to at most four messages per second, reports fixed-size counters plus the
 * latest game identifier/result, yields between games so cancellation is
 * observed, stops on invariant failure with seed/version/game diagnostics,
 * and returns one bounded candidate checkpoint (≤ 2 MB) for application-layer
 * validation and acceptance.
 */

export const seasonWorkerStartRequestSchema = z
  .object({
    schemaVersion: z.literal(3),
    type: z.literal('season-block-start'),
    requestId: z.string().min(1).max(64),
    runId: z.string().min(1).max(64),
    rootSeed: seedSchema,
    blockIndex: z.number().int().min(0).max(8),
    expectedRevision: z.number().int().nonnegative(),
    rotationDigest: z.string().regex(/^[0-9a-f]{32}$/),
    /** The unique command id of this submission (idempotency at the commit). */
    commandId: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9._:-]*$/),
    /**
     * The run context at the block boundary: cursor, league, rosters,
     * rotations (already the locked set), versions, and root seed. The
     * worker validates it through `seasonBlockRunContextSchema` at its
     * boundary; a full `SeasonRun` satisfies the same shape.
     */
    run: seasonBlockRunContextSchema,
    /** The committed 1,230-game schedule artifact (stable game ids). */
    schedule: seasonScheduleSchema,
    homeCourt: seasonHomeCourtProfileSchema,
    /** The human franchise (retained details); null in a pure CLI/AI context. */
    humanFranchiseId: franchiseIdSchema.nullable(),
    /** Packaged draft catalog the worker fetches and hash-verifies itself. */
    catalogUrl: z.string().min(1).max(512),
    catalogHash: contentHashSchema,
    /** Packaged era simulation profile the worker fetches and verifies. */
    profileUrl: z.string().min(1).max(512),
    profileHash: contentHashSchema,
    /**
     * Full compact summaries of every earlier block, in stable schedule
     * order (empty for block 0). Sent only when the worker has no state for
     * this run (fresh worker or resumed after a route change); the worker
     * replaces its accumulator with this set.
     */
    priorSummaries: z.array(seasonGameSummarySchema).max(1200).optional(),
    /**
     * Summaries accepted since the worker's last block (one block's worth).
     * Sent when the persistent worker already holds the earlier blocks; the
     * worker appends them to its accumulator. Exactly one of
     * `priorSummaries` / `newSummaries` is present.
     */
    newSummaries: z.array(seasonGameSummarySchema).max(150).optional(),
    /**
     * M2.4: the effects state (300 player loads + 1,350 pair chemistries)
     * carried into this block, or null for block 0. The worker folds every
     * game's effects transition on top of it and reports the result inside
     * the candidate checkpoint.
     */
    priorEffects: seasonEffectsStateSchema.nullable().optional(),
  })
  .refine((value) => (value.priorSummaries === undefined) !== (value.newSummaries === undefined), {
    message: 'exactly one of priorSummaries or newSummaries is required',
  });
export type SeasonWorkerStartRequest = z.infer<typeof seasonWorkerStartRequestSchema>;

export const seasonWorkerCancelRequestSchema = z.object({
  schemaVersion: z.literal(3),
  type: z.literal('season-block-cancel'),
  requestId: z.string().min(1).max(64),
});
export type SeasonWorkerCancelRequest = z.infer<typeof seasonWorkerCancelRequestSchema>;

export const seasonWorkerRequestSchema = z.discriminatedUnion('type', [
  seasonWorkerStartRequestSchema,
  seasonWorkerCancelRequestSchema,
]);
export type SeasonWorkerRequest = z.infer<typeof seasonWorkerRequestSchema>;

/**
 * Throttled progress (at most four per second). Fixed-size counters plus the
 * latest game identifier and its compact summary; the payload stays under
 * 32 KB.
 */
export const seasonWorkerProgressMessageSchema = z.object({
  schemaVersion: z.literal(3),
  type: z.literal('season-block-progress'),
  requestId: z.string().min(1).max(64),
  blockIndex: z.number().int().min(0).max(8),
  gamesCompleted: z.number().int().nonnegative(),
  gamesTotal: z.number().int().min(1).max(150),
  latestGameId: z
    .string()
    .regex(/^s[0-9]{6}$/)
    .nullable(),
  latestResult: seasonGameSummarySchema.nullable(),
});
export type SeasonWorkerProgressMessage = z.infer<typeof seasonWorkerProgressMessageSchema>;

/** One bounded candidate checkpoint (≤ 2 MB) for application acceptance. */
export const seasonWorkerCompleteMessageSchema = z.object({
  schemaVersion: z.literal(3),
  type: z.literal('season-block-complete'),
  requestId: z.string().min(1).max(64),
  checkpoint: seasonCandidateCheckpointSchema,
});
export type SeasonWorkerCompleteMessage = z.infer<typeof seasonWorkerCompleteMessageSchema>;

export const seasonWorkerErrorCodeSchema = z.enum(['invariant-failure', 'cancelled', 'internal']);
export type SeasonWorkerErrorCode = z.infer<typeof seasonWorkerErrorCodeSchema>;

/** Typed failure with determinism diagnostics (seed, version, game id). */
export const seasonWorkerErrorMessageSchema = z.object({
  schemaVersion: z.literal(3),
  type: z.literal('season-block-error'),
  requestId: z.string().min(1).max(64),
  code: seasonWorkerErrorCodeSchema,
  message: z.string().min(1).max(512),
  /** Root run seed when known (reproduction diagnostics). */
  seed: seedSchema.nullable(),
  /** Game id under simulation when known. */
  gameId: z
    .string()
    .regex(/^s[0-9]{6}$/)
    .nullable(),
  blockIndex: z.number().int().min(0).max(8).nullable(),
});
export type SeasonWorkerErrorMessage = z.infer<typeof seasonWorkerErrorMessageSchema>;

export const seasonWorkerMessageSchema = z.discriminatedUnion('type', [
  seasonWorkerProgressMessageSchema,
  seasonWorkerCompleteMessageSchema,
  seasonWorkerErrorMessageSchema,
]);
export type SeasonWorkerMessage = z.infer<typeof seasonWorkerMessageSchema>;
