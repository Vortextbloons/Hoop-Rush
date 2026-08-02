import { z } from 'zod';
import { eraSimulationProfileSchema } from './era-sim-profile.js';
import { challengeRunSchema } from './run.js';
import { gameResultSchema } from './result.js';

/**
 * Versioned Web Worker messages (spec/04 static deployment and workers). The
 * worker receives runtime-validated requests and posts results in batches;
 * the main thread validates every message once at its boundary. The worker
 * never writes IndexedDB directly. Every message carries the request id so
 * the main thread can ignore stale responses after a cancel or a route change.
 */

export const workerSimulateRequestSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('simulate'),
  requestId: z.string().min(1).max(64),
  /** Challenge snapshot; the sender strips recorded games to keep the post light. */
  run: challengeRunSchema,
  /** First game to compute (resume point); the worker simulates through game 82. */
  startGameNumber: z.number().int().min(1).max(82),
  /** Era profile every simulated game uses (static, versioned content). */
  profile: eraSimulationProfileSchema,
  /** Engine version the worker must report; the main thread verifies results. */
  engineVersion: z.string().min(1).max(64),
});
export type WorkerSimulateRequest = z.infer<typeof workerSimulateRequestSchema>;

export const workerCancelRequestSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('cancel'),
  requestId: z.string().min(1).max(64),
});
export type WorkerCancelRequest = z.infer<typeof workerCancelRequestSchema>;

export const workerRequestSchema = z.discriminatedUnion('type', [
  workerSimulateRequestSchema,
  workerCancelRequestSchema,
]);
export type WorkerRequest = z.infer<typeof workerRequestSchema>;

export const workerResultsMessageSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('results'),
  requestId: z.string().min(1).max(64),
  /** First game in the batch; results are consecutive games in schedule order. */
  fromGameNumber: z.number().int().min(1).max(82),
  results: z.array(gameResultSchema).min(1).max(8),
});
export type WorkerResultsMessage = z.infer<typeof workerResultsMessageSchema>;

export const workerCompleteMessageSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('complete'),
  requestId: z.string().min(1).max(64),
  gamesDelivered: z.number().int().nonnegative(),
  cancelled: z.boolean(),
});
export type WorkerCompleteMessage = z.infer<typeof workerCompleteMessageSchema>;

export const workerErrorMessageSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('error'),
  requestId: z.string().min(1).max(64),
  message: z.string().min(1).max(512),
});
export type WorkerErrorMessage = z.infer<typeof workerErrorMessageSchema>;

export const workerMessageSchema = z.discriminatedUnion('type', [
  workerResultsMessageSchema,
  workerCompleteMessageSchema,
  workerErrorMessageSchema,
]);
export type WorkerMessage = z.infer<typeof workerMessageSchema>;
