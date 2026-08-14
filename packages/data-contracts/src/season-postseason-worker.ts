import { z } from 'zod';
import {
  commandIdSchema,
  contentHashSchema,
  franchiseIdSchema,
  idSchema,
  seedSchema,
} from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { seasonEffectsStateSchema } from './season-effects.ts';
import { seasonGameSummarySchema } from './season-game-summary.ts';
import { postseasonGameIdSchema } from './season-postseason.ts';
import { seasonPostseasonSummarySchema } from './season-postseason-summary.ts';
import { seasonRunSchema, seasonRunStageSchema } from './season-run.ts';
import { seasonAdvancePostseasonRejectionSchema } from './season-commands.ts';

/**
 * Season Run postseason worker wire schema version (1 since the M2.6
 * postseason orchestration wave). The postseason wire family is a SIBLING of
 * the block wire family (`season-worker.ts`, `SEASON_WORKER_WIRE_SCHEMA_VERSION`
 * = 5): it has its own version constant so the frozen block envelopes never
 * re-version, and the two families are validated by distinct discriminated
 * unions at their own boundaries. Every envelope in THIS module is validated
 * against `SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION`.
 *
 * ## Family contract (spec/2.0/07, M2.6 postseason orchestration)
 *
 * The worker receives one validated start request per engine advance, never
 * touches IndexedDB (commits happen on the main thread through the
 * repository), and returns the engine-produced chunk results. The start
 * request carries the FULL authoritative run snapshot (plain JSON, deep-
 * cloned at the main-thread boundary) plus the effects state the engine
 * digests, the packaged draft catalog and era profile URLs (the worker
 * fetches and hash-verifies both itself), and the command envelope facts
 * (commandId + expected state revision/digest) the worker folds into the
 * typed `advance-postseason` command.
 *
 * `targetGameId` selects the granularity: the current next game for the
 * one-game-per-commit advance loop, or the Nth upcoming game
 * (`N = min(8, remaining)`) for an eliminated-run fast-forward chunk. The
 * engine simulates exactly through the target, so one accepted complete
 * message carries either one game or one bounded chunk (≤ 8 games) — always
 * one atomic commit's worth of facts: the post-chunk run, the chunk's
 * compact summaries in play order, the advanced game ids, and the next-
 * decision facts.
 *
 * The complete message is a union: `accepted` carries the commit facts,
 * `rejected` carries the typed engine rejection (a rejected advance is a
 * VALID outcome of a well-formed request — a wrong-game target or an
 * integrity failure — and is never an error message). Worker-level failures
 * (asset load, engine invariant, cancellation) travel as `season-postseason-
 * error` messages. Progress is throttled to at most four messages per
 * second; the worker emits at least one progress message per request (the
 * per-game path emits per game, the chunk path once per chunk after the
 * engine returns the advanced games). A cancel request is observed at the
 * request boundary: the worker checks before its engine call and reports
 * `cancelled`; a chunk already inside one engine call cannot be interrupted,
 * so the main-thread runner discards its eventual result without committing
 * (the committed chunks are retained).
 */

export const SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION = 1 as const;

/**
 * Compact postseason scoreline carried by the throttled progress messages:
 * identical to the block wire's scoreline except that the game id is a
 * postseason id (`pi-...` / `po-...`), which the block wire's
 * `seasonScorelineSchema` cannot express.
 */
export const seasonPostseasonScorelineSchema = z.object({
  gameId: postseasonGameIdSchema,
  homeFranchiseId: franchiseIdSchema,
  homeScore: z.number().int().nonnegative(),
  awayScore: z.number().int().nonnegative(),
  awayFranchiseId: franchiseIdSchema,
});
export type SeasonPostseasonScoreline = z.infer<typeof seasonPostseasonScorelineSchema>;

/**
 * The engine advance request: one atomic-commit's worth of simulation.
 * `run` is the FULL validated run snapshot the runner re-read from the
 * repository (the engine output is committed verbatim, so every field the
 * commit validates must cross the wire); `effects` is the run's effects
 * state at the last accepted boundary (the persistence record keeps it
 * beside the snapshot and the engine state digest covers it).
 */
export const seasonPostseasonWorkerStartRequestSchema = z.object({
  schemaVersion: z.literal(SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('season-postseason-start'),
  requestId: z.string().min(1).max(64),
  runId: idSchema,
  rootSeed: seedSchema,
  /** Unique command id of this submission (idempotency at the commit). */
  commandId: commandIdSchema,
  /** The run state chain position the command asserts (stale-state guard). */
  expectedStateRevision: z.number().int().nonnegative(),
  expectedStateDigest: seasonCheckpointDigestSchema,
  /** The human franchise (retained detail / rotation-decision policy). */
  humanFranchiseId: franchiseIdSchema.nullable(),
  /**
   * The engine advance target: the current next game (one-game commit) or
   * the Nth upcoming game (fast-forward chunk, N ≤ 8).
   */
  targetGameId: postseasonGameIdSchema,
  /** Packaged draft catalog the worker fetches and hash-verifies itself. */
  catalogUrl: z.string().min(1).max(512),
  catalogHash: contentHashSchema,
  /** Packaged era simulation profile the worker fetches and verifies. */
  profileUrl: z.string().min(1).max(512),
  profileHash: contentHashSchema,
  /** The full authoritative run snapshot (validated at both boundaries). */
  run: seasonRunSchema,
  /** The run's effects state at the last accepted boundary. */
  effects: seasonEffectsStateSchema,
  /**
   * The recorded regular-season compact summaries (all 82 rounds, stable
   * schedule order): the worker derives the season awards (awards-v1) from
   * them when an advance reaches the playoffs or completes (the state digest
   * covers the awards). Sent once per worker session like the block wire's
   * `priorSummaries`; identical to the block worker's summary payload.
   */
  regularSeasonSummaries: z.array(seasonGameSummarySchema).max(1230),
});
export type SeasonPostseasonWorkerStartRequest = z.infer<
  typeof seasonPostseasonWorkerStartRequestSchema
>;

export const seasonPostseasonWorkerCancelRequestSchema = z.object({
  schemaVersion: z.literal(SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('season-postseason-cancel'),
  requestId: z.string().min(1).max(64),
});
export type SeasonPostseasonWorkerCancelRequest = z.infer<
  typeof seasonPostseasonWorkerCancelRequestSchema
>;

/** Performance pass: worker prewarm (catalog + era profile caches). */
export const seasonPostseasonWorkerWarmRequestSchema = z.object({
  schemaVersion: z.literal(SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('season-postseason-warm'),
  requestId: z.string().min(1).max(64),
  catalogUrl: z.string().min(1).max(512),
  catalogHash: contentHashSchema,
  profileUrl: z.string().min(1).max(512),
  profileHash: contentHashSchema,
});
export type SeasonPostseasonWorkerWarmRequest = z.infer<
  typeof seasonPostseasonWorkerWarmRequestSchema
>;

export const seasonPostseasonWorkerWarmAckMessageSchema = z.object({
  schemaVersion: z.literal(SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('season-postseason-warm-ack'),
  requestId: z.string().min(1).max(64),
});
export type SeasonPostseasonWorkerWarmAckMessage = z.infer<
  typeof seasonPostseasonWorkerWarmAckMessageSchema
>;

export const seasonPostseasonWorkerRequestSchema = z.discriminatedUnion('type', [
  seasonPostseasonWorkerStartRequestSchema,
  seasonPostseasonWorkerCancelRequestSchema,
  seasonPostseasonWorkerWarmRequestSchema,
]);
export type SeasonPostseasonWorkerRequest = z.infer<typeof seasonPostseasonWorkerRequestSchema>;

/**
 * Throttled progress (at most four per second). Carries the same compact
 * scoreline as the block wire; the full compact summaries ship inside the
 * complete message only.
 */
export const seasonPostseasonWorkerProgressMessageSchema = z.object({
  schemaVersion: z.literal(SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('season-postseason-progress'),
  requestId: z.string().min(1).max(64),
  /** Games the current request advanced (1 for the per-game path). */
  gamesCompleted: z.number().int().nonnegative(),
  /** Estimated remaining tournament games at request start (or 0). */
  gamesTotal: z.number().int().nonnegative(),
  latestGameId: postseasonGameIdSchema.nullable(),
  latestResult: seasonPostseasonScorelineSchema.nullable(),
});
export type SeasonPostseasonWorkerProgressMessage = z.infer<
  typeof seasonPostseasonWorkerProgressMessageSchema
>;

/** The accepted advance facts of one request (one atomic commit's worth). */
export const seasonPostseasonWorkerAcceptedResultSchema = z.object({
  status: z.literal('accepted'),
  /** The run stage after the advance. */
  stage: seasonRunStageSchema,
  /** Games advanced by the request, in play order. */
  advancedGameIds: z.array(postseasonGameIdSchema),
  /** The chunk's compact summaries, in play order. */
  summaries: z.array(seasonPostseasonSummarySchema),
  /** The full post-advance run snapshot (committed verbatim). */
  run: seasonRunSchema,
  /** Whether the run now needs a human rotation ('rotation') or not ('none'). */
  nextDecision: z.enum(['rotation', 'none']),
  /** The next game awaiting a human rotation, when one is needed. */
  nextGameId: postseasonGameIdSchema.nullable(),
  /** The next game to simulate with AI rotations, when the run continues. */
  aiNextGameId: postseasonGameIdSchema.nullable(),
});
export type SeasonPostseasonWorkerAcceptedResult = z.infer<
  typeof seasonPostseasonWorkerAcceptedResultSchema
>;

/**
 * Completion of one request: either the accepted advance facts (one atomic
 * commit on the main thread) or the typed engine rejection (never an error
 * message — the rejection is a valid outcome of a well-formed request).
 */
export const seasonPostseasonWorkerCompleteMessageSchema = z.object({
  schemaVersion: z.literal(SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('season-postseason-complete'),
  requestId: z.string().min(1).max(64),
  result: z.discriminatedUnion('status', [
    seasonPostseasonWorkerAcceptedResultSchema,
    z.object({
      status: z.literal('rejected'),
      commandId: commandIdSchema,
      rejection: seasonAdvancePostseasonRejectionSchema,
    }),
  ]),
});
export type SeasonPostseasonWorkerCompleteMessage = z.infer<
  typeof seasonPostseasonWorkerCompleteMessageSchema
>;

export const seasonPostseasonWorkerErrorCodeSchema = z.enum([
  'invariant-failure',
  'cancelled',
  'internal',
]);
export type SeasonPostseasonWorkerErrorCode = z.infer<typeof seasonPostseasonWorkerErrorCodeSchema>;

/** Typed failure with determinism diagnostics (seed, game id). */
export const seasonPostseasonWorkerErrorMessageSchema = z.object({
  schemaVersion: z.literal(SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('season-postseason-error'),
  requestId: z.string().min(1).max(64),
  code: seasonPostseasonWorkerErrorCodeSchema,
  message: z.string().min(1).max(512),
  /** Root run seed when known (reproduction diagnostics). */
  seed: seedSchema.nullable(),
  /** Game id under simulation when known. */
  gameId: postseasonGameIdSchema.nullable(),
});
export type SeasonPostseasonWorkerErrorMessage = z.infer<
  typeof seasonPostseasonWorkerErrorMessageSchema
>;

export const seasonPostseasonWorkerMessageSchema = z.discriminatedUnion('type', [
  seasonPostseasonWorkerProgressMessageSchema,
  seasonPostseasonWorkerCompleteMessageSchema,
  seasonPostseasonWorkerErrorMessageSchema,
  seasonPostseasonWorkerWarmAckMessageSchema,
]);
export type SeasonPostseasonWorkerMessage = z.infer<typeof seasonPostseasonWorkerMessageSchema>;
