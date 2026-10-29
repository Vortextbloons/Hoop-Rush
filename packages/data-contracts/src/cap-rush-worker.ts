import { z } from 'zod';
import { CAP_RUSH_GAME_COUNT, capRushDigestSchema } from './cap-rush-versions.ts';
import { capRushGameSummarySchema } from './cap-rush-season.ts';
import { capRushLockedInputsSchema } from './cap-rush-lock.ts';
import { havocGameAuditSchema, havocGameResultSchema } from './havoc-game.ts';

export const CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION = 2;

const capRushWorkerBase = z.object({
  schemaVersion: z.literal(CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION),
  requestId: z.string().min(1).max(64),
});

export const capRushWorkerSimulateRequestSchema = capRushWorkerBase.extend({
  type: z.literal('cap-rush-simulate'),
  locked: capRushLockedInputsSchema,
  startGame: z.number().int().min(1).max(CAP_RUSH_GAME_COUNT),
  count: z.number().int().min(1).max(CAP_RUSH_GAME_COUNT),
});
export type CapRushWorkerSimulateRequest = z.infer<typeof capRushWorkerSimulateRequestSchema>;

export const capRushWorkerCancelRequestSchema = capRushWorkerBase.extend({
  type: z.literal('cap-rush-cancel'),
});
export type CapRushWorkerCancelRequest = z.infer<typeof capRushWorkerCancelRequestSchema>;

export const capRushWorkerRequestSchema = z.discriminatedUnion('type', [
  capRushWorkerSimulateRequestSchema,
  capRushWorkerCancelRequestSchema,
]);
export type CapRushWorkerRequest = z.infer<typeof capRushWorkerRequestSchema>;

export const capRushWorkerGameMessageSchema = capRushWorkerBase.extend({
  type: z.literal('cap-rush-game'),
  cursor: z.number().int().min(1).max(CAP_RUSH_GAME_COUNT),
  inputDigest: capRushDigestSchema,
  resultDigest: capRushDigestSchema,
  isolations: z.number().int().nonnegative(),
  strikes: z.number().int().nonnegative(),
  summary: capRushGameSummarySchema,
  audit: havocGameAuditSchema,
  result: havocGameResultSchema,
});
export type CapRushWorkerGameMessage = z.infer<typeof capRushWorkerGameMessageSchema>;

export const capRushWorkerProgressMessageSchema = capRushWorkerBase.extend({
  type: z.literal('cap-rush-progress'),
  gamesCompleted: z.number().int().nonnegative(),
  gamesTotal: z.number().int().min(1).max(CAP_RUSH_GAME_COUNT),
});
export type CapRushWorkerProgressMessage = z.infer<typeof capRushWorkerProgressMessageSchema>;

export const capRushWorkerCompleteMessageSchema = capRushWorkerBase.extend({
  type: z.literal('cap-rush-complete'),
  gamesDelivered: z.number().int().nonnegative(),
  cancelled: z.boolean(),
  lastCursor: z.number().int().min(0).max(CAP_RUSH_GAME_COUNT),
});
export type CapRushWorkerCompleteMessage = z.infer<typeof capRushWorkerCompleteMessageSchema>;

export const capRushWorkerErrorCodeSchema = z.enum([
  'audit-failure',
  'stale-job',
  'cancelled',
  'internal',
]);
export type CapRushWorkerErrorCode = z.infer<typeof capRushWorkerErrorCodeSchema>;

export const capRushWorkerErrorMessageSchema = capRushWorkerBase.extend({
  type: z.literal('cap-rush-error'),
  code: capRushWorkerErrorCodeSchema,
  message: z.string().min(1).max(512),
  gameNumber: z.number().int().min(1).max(CAP_RUSH_GAME_COUNT).nullable(),
});
export type CapRushWorkerErrorMessage = z.infer<typeof capRushWorkerErrorMessageSchema>;

export const capRushWorkerMessageSchema = z.discriminatedUnion('type', [
  capRushWorkerGameMessageSchema,
  capRushWorkerProgressMessageSchema,
  capRushWorkerCompleteMessageSchema,
  capRushWorkerErrorMessageSchema,
]);
export type CapRushWorkerMessage = z.infer<typeof capRushWorkerMessageSchema>;
