import { z } from 'zod';
import {
  commandIdSchema,
  contentHashSchema,
  franchiseIdSchema,
  idSchema,
  seasonGameIdSchema,
  seedSchema,
} from './ids.ts';
import {
  seasonCandidateCheckpointSchema,
  seasonCheckpointDigestSchema,
} from './season-checkpoint.ts';
import { seasonRotationSetDigestSchema } from './season-digests.ts';
import { seasonEffectsStateSchema } from './season-effects.ts';
import { seasonGameSummarySchema } from './season-game-summary.ts';
import { seasonHealthStateSchema } from './season-health.ts';
import { seasonHomeCourtProfileSchema } from './season-home-court.ts';
import { seasonInfluenceStateSchema } from './season-influence.ts';
import { seasonObjectiveIdSchema } from './season-objective.ts';
import { seasonPendingBlockCandidateSchema } from './season-pending-block.ts';
import { seasonBlockRunContextSchema } from './season-run.ts';
import { seasonScheduleSchema } from './season-schedule.ts';
import { seasonTransactionEntrySchema } from './season-transactions.ts';

/**
 * Season block worker wire schema version (6 since the M2.6.5 roster-depth
 * milestone: the complete message carries the post-block free-agency state
 * inside the checkpoint-v4 candidate, and start requests carry the
 * 10-15-player rosters of the schema-10 run context): every season worker
 * envelope is validated against this literal. The version history lives in
 * the module docstring below.
 */
export const SEASON_WORKER_WIRE_SCHEMA_VERSION = 6 as const;

/**
 * Season Run block worker envelopes (spec/2.0/07 background execution, M2.3;
 * wire schema version 5 since the M2.5 scoreline progress payload). Schema 3
 * slims the block wire: the start request carries only the run context the
 * pipeline reads (identity, cursor, league, rosters, locked rotations,
 * versions); the 1,230 scheduled `games`, standings, draft, ownership,
 * postseason, AI assignments, evaluations, and generation audit stay in the
 * persisted snapshot. Prior summaries travel once per fresh worker
 * (`priorSummaries`, full reset) or as a per-block delta (`newSummaries`,
 * appended by the persistent worker); exactly one form is required. Wire 4
 * (M2.5) threads health state like effects (`priorHealth`), `startGameId`
 * resumes mid-block from an interrupted pending candidate, and `objectiveId`
 * carries the locked block objective; the complete message returns either a
 * committed checkpoint or an interrupted pending candidate. Wire 5 slims the
 * throttled progress payload to the compact scoreline. The worker receives
 * one validated block input, never touches IndexedDB, throttles progress to
 * at most four messages per second, yields between games so cancellation is
 * observed, stops on invariant failure with seed/version/game diagnostics,
 * and returns one bounded candidate checkpoint (≤ 2 MB).
 */

/**
 * Compact scoreline carried by the throttled progress messages: everything
 * the UI renders for a live game (identities + points). The full compact
 * summary travels only inside the complete message.
 */
export const seasonScorelineSchema = z.object({
  gameId: seasonGameIdSchema,
  homeFranchiseId: franchiseIdSchema,
  homeScore: z.number().int().nonnegative(),
  awayScore: z.number().int().nonnegative(),
  awayFranchiseId: franchiseIdSchema,
});
export type SeasonScoreline = z.infer<typeof seasonScorelineSchema>;

export const seasonWorkerStartRequestSchema = z
  .object({
    schemaVersion: z.literal(SEASON_WORKER_WIRE_SCHEMA_VERSION),
    type: z.literal('season-block-start'),
    requestId: z.string().min(1).max(64),
    runId: idSchema,
    rootSeed: seedSchema,
    blockIndex: z.number().int().min(0).max(8),
    expectedRevision: z.number().int().nonnegative(),
    rotationDigest: seasonRotationSetDigestSchema,
    /** Unique command id of this submission (idempotency at the commit). */
    commandId: commandIdSchema,
    /** Run context at the block boundary (cursor, league, rosters, locked rotations, versions, seed), validated via `seasonBlockRunContextSchema`. */
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
    /** Full compact summaries of every earlier block, in stable schedule order (empty for block 0); sent only when the worker has no state for this run. */
    priorSummaries: z.array(seasonGameSummarySchema).max(1200).optional(),
    /** Summaries accepted since the worker's last block (one block's worth), appended when the worker already holds the earlier blocks. Exactly one of `priorSummaries`/`newSummaries` is present. */
    newSummaries: z.array(seasonGameSummarySchema).max(150).optional(),
    /** M2.4: effects state (300 loads + 1,350 pair chemistries) carried into this block, or null for block 0. */
    priorEffects: seasonEffectsStateSchema.nullable().optional(),
    /** M2.5: health state (append-only injury records) carried into this block, or null for block 0; threaded like effects. */
    priorHealth: seasonHealthStateSchema.nullable().optional(),
    /** M2.5: resume mid-block from an interrupted pending candidate — next game to simulate (null at block start). */
    startGameId: seasonGameIdSchema.nullable(),
    /** M2.5: locked block objective (blocks 0-7); null for the final two-game block 8. */
    objectiveId: seasonObjectiveIdSchema.nullable(),
    /** M2.5: pre-block Influence state (30 balances + ledger + spend tracking); the worker folds this block's grants and objective reward on top of it. */
    priorInfluence: seasonInfluenceStateSchema.nullable(),
    /** M2.5: authoritative run-scoped transaction log entering the block (empty for block 0); the worker appends so worker and CLI candidates digest identically. */
    priorTransactions: z.array(seasonTransactionEntrySchema).max(2000).optional(),
    /** M2.5: run state facts this submission asserts (typed command's expected revision/digest); authoritative post-block facts are computed by the commit side. */
    expectedStateRevision: z.number().int().nonnegative(),
    expectedStateDigest: seasonCheckpointDigestSchema,
  })
  .refine((value) => (value.priorSummaries === undefined) !== (value.newSummaries === undefined), {
    message: 'exactly one of priorSummaries or newSummaries is required',
  });
export type SeasonWorkerStartRequest = z.infer<typeof seasonWorkerStartRequestSchema>;

/**
 * Wire-v5 continuation: sent instead of the full start request when the
 * persistent worker already holds the run context (schedule, league, rosters,
 * home-court profile) for this runId; carries only the per-block deltas. A
 * worker that lost its context (terminated, fresh process) rejects it and the
 * runner falls back to a full start request.
 */
export const seasonWorkerContinueRequestSchema = z
  .object({
    schemaVersion: z.literal(SEASON_WORKER_WIRE_SCHEMA_VERSION),
    type: z.literal('season-block-continue'),
    requestId: z.string().min(1).max(64),
    runId: idSchema,
    rootSeed: seedSchema,
    blockIndex: z.number().int().min(0).max(8),
    expectedRevision: z.number().int().nonnegative(),
    rotationDigest: seasonRotationSetDigestSchema,
    commandId: commandIdSchema,
    humanFranchiseId: franchiseIdSchema.nullable(),
    /** The LOCKED rotation set for this block (the only run context that changes per block). */
    rotations: seasonBlockRunContextSchema.shape.rotations,
    /** Packaged draft catalog the worker fetches and hash-verifies itself (cached by hash). */
    catalogUrl: z.string().min(1).max(512),
    catalogHash: contentHashSchema,
    /** Packaged era simulation profile the worker fetches and verifies. */
    profileUrl: z.string().min(1).max(512),
    profileHash: contentHashSchema,
    priorSummaries: z.array(seasonGameSummarySchema).max(1200).optional(),
    newSummaries: z.array(seasonGameSummarySchema).max(150).optional(),
    priorEffects: seasonEffectsStateSchema.nullable().optional(),
    priorHealth: seasonHealthStateSchema.nullable().optional(),
    startGameId: seasonGameIdSchema.nullable(),
    objectiveId: seasonObjectiveIdSchema.nullable(),
    priorInfluence: seasonInfluenceStateSchema.nullable(),
    priorTransactions: z.array(seasonTransactionEntrySchema).max(2000).optional(),
    expectedStateRevision: z.number().int().nonnegative(),
    expectedStateDigest: seasonCheckpointDigestSchema,
  })
  .refine((value) => (value.priorSummaries === undefined) !== (value.newSummaries === undefined), {
    message: 'exactly one of priorSummaries or newSummaries is required',
  });
export type SeasonWorkerContinueRequest = z.infer<typeof seasonWorkerContinueRequestSchema>;

export const seasonWorkerCancelRequestSchema = z.object({
  schemaVersion: z.literal(SEASON_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('season-block-cancel'),
  requestId: z.string().min(1).max(64),
});
export type SeasonWorkerCancelRequest = z.infer<typeof seasonWorkerCancelRequestSchema>;

/**
 * Performance pass: worker prewarm. The main thread posts this after the run
 * shell is interactive (idle callback) so the worker fetches, hash-verifies,
 * and caches the packaged catalog and era profile BEFORE the first block
 * start; a later start request then pays no download/parse time. The worker
 * responds with `season-block-warm-ack`; no simulation state is touched.
 */
export const seasonWorkerWarmRequestSchema = z.object({
  schemaVersion: z.literal(SEASON_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('season-block-warm'),
  requestId: z.string().min(1).max(64),
  catalogUrl: z.string().min(1).max(512),
  catalogHash: contentHashSchema,
  profileUrl: z.string().min(1).max(512),
  profileHash: contentHashSchema,
});
export type SeasonWorkerWarmRequest = z.infer<typeof seasonWorkerWarmRequestSchema>;

export const seasonWorkerWarmAckMessageSchema = z.object({
  schemaVersion: z.literal(SEASON_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('season-block-warm-ack'),
  requestId: z.string().min(1).max(64),
});
export type SeasonWorkerWarmAckMessage = z.infer<typeof seasonWorkerWarmAckMessageSchema>;

export const seasonWorkerRequestSchema = z.discriminatedUnion('type', [
  seasonWorkerStartRequestSchema,
  seasonWorkerContinueRequestSchema,
  seasonWorkerCancelRequestSchema,
  seasonWorkerWarmRequestSchema,
]);
export type SeasonWorkerRequest = z.infer<typeof seasonWorkerRequestSchema>;

/**
 * Throttled progress (at most four per second). Fixed-size counters plus the
 * latest game identifier and its compact scoreline; the full compact summary
 * ships only on completion.
 */
export const seasonWorkerProgressMessageSchema = z.object({
  schemaVersion: z.literal(SEASON_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('season-block-progress'),
  requestId: z.string().min(1).max(64),
  blockIndex: z.number().int().min(0).max(8),
  gamesCompleted: z.number().int().nonnegative(),
  gamesTotal: z.number().int().min(1).max(150),
  latestGameId: seasonGameIdSchema.nullable(),
  latestResult: seasonScorelineSchema.nullable(),
});
export type SeasonWorkerProgressMessage = z.infer<typeof seasonWorkerProgressMessageSchema>;

/**
 * Completion of one block run. `committed` carries the bounded candidate
 * checkpoint (≤ 2 MB) for application validation and acceptance;
 * `interrupted` carries the uncommitted pending candidate (M2.5 invalid-
 * roster interruption) for persistence and later resume.
 */
export const seasonWorkerCompleteMessageSchema = z.object({
  schemaVersion: z.literal(SEASON_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('season-block-complete'),
  requestId: z.string().min(1).max(64),
  result: z.discriminatedUnion('status', [
    z.object({ status: z.literal('committed'), checkpoint: seasonCandidateCheckpointSchema }),
    z.object({ status: z.literal('interrupted'), pending: seasonPendingBlockCandidateSchema }),
  ]),
});
export type SeasonWorkerCompleteMessage = z.infer<typeof seasonWorkerCompleteMessageSchema>;

export const seasonWorkerErrorCodeSchema = z.enum(['invariant-failure', 'cancelled', 'internal']);
export type SeasonWorkerErrorCode = z.infer<typeof seasonWorkerErrorCodeSchema>;

/** Typed failure with determinism diagnostics (seed, version, game id). */
export const seasonWorkerErrorMessageSchema = z.object({
  schemaVersion: z.literal(SEASON_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('season-block-error'),
  requestId: z.string().min(1).max(64),
  code: seasonWorkerErrorCodeSchema,
  message: z.string().min(1).max(512),
  /** Root run seed when known (reproduction diagnostics). */
  seed: seedSchema.nullable(),
  /** Game id under simulation when known. */
  gameId: seasonGameIdSchema.nullable(),
  blockIndex: z.number().int().min(0).max(8).nullable(),
});
export type SeasonWorkerErrorMessage = z.infer<typeof seasonWorkerErrorMessageSchema>;

export const seasonWorkerMessageSchema = z.discriminatedUnion('type', [
  seasonWorkerProgressMessageSchema,
  seasonWorkerCompleteMessageSchema,
  seasonWorkerErrorMessageSchema,
  seasonWorkerWarmAckMessageSchema,
]);
export type SeasonWorkerMessage = z.infer<typeof seasonWorkerMessageSchema>;
