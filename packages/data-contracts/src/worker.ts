import { z } from 'zod';
import { eraSimulationProfileSchema } from './era-sim-profile.ts';
import { challengeRunSchema } from './run.ts';
import { gameResultSchema } from './result.ts';

export const WORKER_WIRE_SCHEMA_VERSION = 1 as const;

export const workerSimulateRequestSchema = z.object({
  schemaVersion: z.literal(WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('simulate'),
  requestId: z.string().min(1).max(64),

  run: challengeRunSchema,

  startGameNumber: z.number().int().min(1).max(82),

  profile: eraSimulationProfileSchema,

  engineVersion: z.string().min(1).max(64),
});
export type WorkerSimulateRequest = z.infer<typeof workerSimulateRequestSchema>;

export const workerCancelRequestSchema = z.object({
  schemaVersion: z.literal(WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('cancel'),
  requestId: z.string().min(1).max(64),
});
export type WorkerCancelRequest = z.infer<typeof workerCancelRequestSchema>;

export const workerStartRequestSchema = z.object({
  schemaVersion: z.literal(WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('start'),
  requestId: z.string().min(1).max(64),

  run: challengeRunSchema,

  profile: eraSimulationProfileSchema,

  engineVersion: z.string().min(1).max(64),
});
export type WorkerStartRequest = z.infer<typeof workerStartRequestSchema>;

export const workerRequestSchema = z.discriminatedUnion('type', [
  workerSimulateRequestSchema,
  workerStartRequestSchema,
  workerCancelRequestSchema,
]);
export type WorkerRequest = z.infer<typeof workerRequestSchema>;

export const workerResultsMessageSchema = z.object({
  schemaVersion: z.literal(WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('results'),
  requestId: z.string().min(1).max(64),

  fromGameNumber: z.number().int().min(1).max(82),
  results: z.array(gameResultSchema).min(1).max(8),
});
export type WorkerResultsMessage = z.infer<typeof workerResultsMessageSchema>;

export const workerCompleteMessageSchema = z.object({
  schemaVersion: z.literal(WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('complete'),
  requestId: z.string().min(1).max(64),
  gamesDelivered: z.number().int().nonnegative(),
  cancelled: z.boolean(),
});
export type WorkerCompleteMessage = z.infer<typeof workerCompleteMessageSchema>;

export const workerErrorMessageSchema = z.object({
  schemaVersion: z.literal(WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('error'),
  requestId: z.string().min(1).max(64),
  message: z.string().min(1).max(512),
});
export type WorkerErrorMessage = z.infer<typeof workerErrorMessageSchema>;

export const workerStartResultMessageSchema = z.object({
  schemaVersion: z.literal(WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('start-result'),
  requestId: z.string().min(1).max(64),
  chosenRunSeed: z.string().min(1).max(64),
  chosenWins: z.number().int().nonnegative(),
  chosenLosses: z.number().int().nonnegative(),
  chosenDifferential: z.number().int(),
});
export type WorkerStartResultMessage = z.infer<typeof workerStartResultMessageSchema>;

export const workerMessageSchema = z.discriminatedUnion('type', [
  workerResultsMessageSchema,
  workerCompleteMessageSchema,
  workerErrorMessageSchema,
  workerStartResultMessageSchema,
]);
export type WorkerMessage = z.infer<typeof workerMessageSchema>;
