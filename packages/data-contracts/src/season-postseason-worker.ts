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
export const SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION = 1 as const;
export const seasonPostseasonScorelineSchema = z.object({
  gameId: postseasonGameIdSchema,
  homeFranchiseId: franchiseIdSchema,
  homeScore: z.number().int().nonnegative(),
  awayScore: z.number().int().nonnegative(),
  awayFranchiseId: franchiseIdSchema,
});
export type SeasonPostseasonScoreline = z.infer<typeof seasonPostseasonScorelineSchema>;
export const seasonPostseasonWorkerStartRequestSchema = z.object({
  schemaVersion: z.literal(SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('season-postseason-start'),
  requestId: z.string().min(1).max(64),
  runId: idSchema,
  rootSeed: seedSchema,
  commandId: commandIdSchema,
  expectedStateRevision: z.number().int().nonnegative(),
  expectedStateDigest: seasonCheckpointDigestSchema,
  humanFranchiseId: franchiseIdSchema.nullable(),
  targetGameId: postseasonGameIdSchema,
  catalogUrl: z.string().min(1).max(512),
  catalogHash: contentHashSchema,
  profileUrl: z.string().min(1).max(512),
  profileHash: contentHashSchema,
  run: seasonRunSchema,
  effects: seasonEffectsStateSchema,
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
export const seasonPostseasonWorkerProgressMessageSchema = z.object({
  schemaVersion: z.literal(SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('season-postseason-progress'),
  requestId: z.string().min(1).max(64),
  gamesCompleted: z.number().int().nonnegative(),
  gamesTotal: z.number().int().nonnegative(),
  latestGameId: postseasonGameIdSchema.nullable(),
  latestResult: seasonPostseasonScorelineSchema.nullable(),
});
export type SeasonPostseasonWorkerProgressMessage = z.infer<
  typeof seasonPostseasonWorkerProgressMessageSchema
>;
export const seasonPostseasonWorkerAcceptedResultSchema = z.object({
  status: z.literal('accepted'),
  stage: seasonRunStageSchema,
  advancedGameIds: z.array(postseasonGameIdSchema),
  summaries: z.array(seasonPostseasonSummarySchema),
  run: seasonRunSchema,
  nextDecision: z.enum(['rotation', 'none']),
  nextGameId: postseasonGameIdSchema.nullable(),
  aiNextGameId: postseasonGameIdSchema.nullable(),
});
export type SeasonPostseasonWorkerAcceptedResult = z.infer<
  typeof seasonPostseasonWorkerAcceptedResultSchema
>;
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
export const seasonPostseasonWorkerErrorMessageSchema = z.object({
  schemaVersion: z.literal(SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('season-postseason-error'),
  requestId: z.string().min(1).max(64),
  code: seasonPostseasonWorkerErrorCodeSchema,
  message: z.string().min(1).max(512),
  seed: seedSchema.nullable(),
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
