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

export const SEASON_WORKER_WIRE_SCHEMA_VERSION = 6 as const;

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

    commandId: commandIdSchema,

    run: seasonBlockRunContextSchema,

    schedule: seasonScheduleSchema,
    homeCourt: seasonHomeCourtProfileSchema,

    humanFranchiseId: franchiseIdSchema.nullable(),

    catalogUrl: z.string().min(1).max(512),
    catalogHash: contentHashSchema,

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
export type SeasonWorkerStartRequest = z.infer<typeof seasonWorkerStartRequestSchema>;

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

    rotations: seasonBlockRunContextSchema.shape.rotations,

    catalogUrl: z.string().min(1).max(512),
    catalogHash: contentHashSchema,

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

export const seasonWorkerErrorMessageSchema = z.object({
  schemaVersion: z.literal(SEASON_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('season-block-error'),
  requestId: z.string().min(1).max(64),
  code: seasonWorkerErrorCodeSchema,
  message: z.string().min(1).max(512),

  seed: seedSchema.nullable(),

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
