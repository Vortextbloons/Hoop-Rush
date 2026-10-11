import { z } from 'zod';
import { idSchema } from './ids.ts';
import { HAVOC_WORKER_WIRE_SCHEMA_VERSION, havocDigestSchema } from './havoc-versions.ts';
import { havocLockedInputsSchema } from './havoc-run.ts';
import {
  havocGameResultSchema,
  havocGameSummarySchema,
  havocGameTapeSchema,
  havocVariantSchema,
} from './havoc-game.ts';

const havocWorkerRequestBase = {
  schemaVersion: z.literal(HAVOC_WORKER_WIRE_SCHEMA_VERSION),
  requestId: z.string().min(1).max(64),
  runId: idSchema,
  revision: z.number().int().nonnegative(),
  inputDigest: havocDigestSchema,
};

export const havocWorkerSimulateRequestSchema = z
  .object({
    ...havocWorkerRequestBase,
    type: z.literal('havoc-simulate'),
    variant: havocVariantSchema,
    cursor: z.number().int().min(0).max(82),
    count: z.number().int().min(1).max(82),
    locked: havocLockedInputsSchema,
  })
  .superRefine((request, ctx) => {
    if (request.cursor + request.count > 82) {
      ctx.addIssue({ code: 'custom', message: 'simulation range exceeds 82 games' });
    }
  });
export type HavocWorkerSimulateRequest = z.infer<typeof havocWorkerSimulateRequestSchema>;

export const havocWorkerTapeRequestSchema = z.object({
  ...havocWorkerRequestBase,
  type: z.literal('havoc-tape'),
  variant: havocVariantSchema,
  gameNumber: z.number().int().min(1).max(82),
  locked: havocLockedInputsSchema,
});
export type HavocWorkerTapeRequest = z.infer<typeof havocWorkerTapeRequestSchema>;

export const havocWorkerCancelRequestSchema = z.object({
  schemaVersion: z.literal(HAVOC_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('havoc-cancel'),
  requestId: z.string().min(1).max(64),
});
export type HavocWorkerCancelRequest = z.infer<typeof havocWorkerCancelRequestSchema>;

export const havocWorkerRequestSchema = z.discriminatedUnion('type', [
  havocWorkerSimulateRequestSchema,
  havocWorkerTapeRequestSchema,
  havocWorkerCancelRequestSchema,
]);
export type HavocWorkerRequest = z.infer<typeof havocWorkerRequestSchema>;

export const havocWorkerGameMessageSchema = z.object({
  schemaVersion: z.literal(HAVOC_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('havoc-game'),
  requestId: z.string().min(1).max(64),
  variant: havocVariantSchema,
  cursor: z.number().int().min(1).max(82),
  inputDigest: havocDigestSchema,
  resultDigest: havocDigestSchema,
  summary: havocGameSummarySchema,
  result: havocGameResultSchema,
});
export type HavocWorkerGameMessage = z.infer<typeof havocWorkerGameMessageSchema>;

export const havocWorkerProgressMessageSchema = z.object({
  schemaVersion: z.literal(HAVOC_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('havoc-progress'),
  requestId: z.string().min(1).max(64),
  variant: havocVariantSchema,
  gamesCompleted: z.number().int().nonnegative(),
  gamesTotal: z.number().int().min(1).max(82),
});
export type HavocWorkerProgressMessage = z.infer<typeof havocWorkerProgressMessageSchema>;

export const havocWorkerCompleteMessageSchema = z.object({
  schemaVersion: z.literal(HAVOC_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('havoc-complete'),
  requestId: z.string().min(1).max(64),
  variant: havocVariantSchema,
  gamesDelivered: z.number().int().nonnegative(),
  cancelled: z.boolean(),
  lastCursor: z.number().int().min(0).max(82),
});
export type HavocWorkerCompleteMessage = z.infer<typeof havocWorkerCompleteMessageSchema>;

export const havocWorkerTapeMessageSchema = z.object({
  schemaVersion: z.literal(HAVOC_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('havoc-tape'),
  requestId: z.string().min(1).max(64),
  variant: havocVariantSchema,
  gameNumber: z.number().int().min(1).max(82),
  inputDigest: havocDigestSchema,
  resultDigest: havocDigestSchema,
  tapeDigest: havocDigestSchema,
  summary: havocGameSummarySchema,
  result: havocGameResultSchema,
  tape: havocGameTapeSchema,
});
export type HavocWorkerTapeMessage = z.infer<typeof havocWorkerTapeMessageSchema>;

export const havocWorkerErrorCodeSchema = z.enum([
  'invariant-failure',
  'audit-failure',
  'cancelled',
  'internal',
]);
export type HavocWorkerErrorCode = z.infer<typeof havocWorkerErrorCodeSchema>;

export const havocWorkerErrorMessageSchema = z.object({
  schemaVersion: z.literal(HAVOC_WORKER_WIRE_SCHEMA_VERSION),
  type: z.literal('havoc-error'),
  requestId: z.string().min(1).max(64),
  code: havocWorkerErrorCodeSchema,
  message: z.string().min(1).max(512),
  gameNumber: z.number().int().min(1).max(82).nullable(),
});
export type HavocWorkerErrorMessage = z.infer<typeof havocWorkerErrorMessageSchema>;

export const havocWorkerMessageSchema = z.discriminatedUnion('type', [
  havocWorkerGameMessageSchema,
  havocWorkerProgressMessageSchema,
  havocWorkerCompleteMessageSchema,
  havocWorkerTapeMessageSchema,
  havocWorkerErrorMessageSchema,
]);
export type HavocWorkerMessage = z.infer<typeof havocWorkerMessageSchema>;
