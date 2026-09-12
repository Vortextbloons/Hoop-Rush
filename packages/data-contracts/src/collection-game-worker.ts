import { z } from 'zod';
import { contentHashSchema, seedSchema } from './ids.ts';
import {
  collectionGameEventSchema,
  collectionGameIdSchema,
  collectionGameResultUnionSchema,
  collectionGameResultV1Schema,
  collectionPreparedGameUnionSchema,
  collectionPreparedGameV1Schema,
} from './collection-game.ts';
import {
  COLLECTION_GAME_V1_WORKER_WIRE_VERSION,
  COLLECTION_GAME_WORKER_WIRE_VERSION,
} from './collection-versions.ts';

export const collectionGameWorkerSimulateRequestV1Schema = z
  .object({
    wireVersion: z.literal(COLLECTION_GAME_V1_WORKER_WIRE_VERSION),
    type: z.literal('collection-game-simulate'),
    requestId: z.string().min(1).max(64),
    prepared: collectionPreparedGameV1Schema,
    catalogUrl: z.string().min(1).max(512),
    catalogHash: contentHashSchema,
    profileUrl: z.string().min(1).max(512),
    profileHash: contentHashSchema,
  })
  .strict();
export type CollectionGameWorkerSimulateRequestV1 = z.infer<
  typeof collectionGameWorkerSimulateRequestV1Schema
>;

export const collectionGameWorkerSimulateRequestSchema = z
  .object({
    wireVersion: z.literal(COLLECTION_GAME_WORKER_WIRE_VERSION),
    type: z.literal('collection-game-simulate'),
    requestId: z.string().min(1).max(64),
    prepared: collectionPreparedGameUnionSchema,
    catalogUrl: z.string().min(1).max(512),
    catalogHash: contentHashSchema,
    profileUrl: z.string().min(1).max(512),
    profileHash: contentHashSchema,
  })
  .strict();
export type CollectionGameWorkerSimulateRequest = z.infer<
  typeof collectionGameWorkerSimulateRequestSchema
>;

export const collectionGameWorkerCancelRequestSchema = z
  .object({
    wireVersion: z.literal(COLLECTION_GAME_WORKER_WIRE_VERSION),
    type: z.literal('collection-game-cancel'),
    requestId: z.string().min(1).max(64),
  })
  .strict();
export type CollectionGameWorkerCancelRequest = z.infer<
  typeof collectionGameWorkerCancelRequestSchema
>;

export const collectionGameWorkerWarmRequestSchema = z
  .object({
    wireVersion: z.literal(COLLECTION_GAME_WORKER_WIRE_VERSION),
    type: z.literal('collection-game-warm'),
    requestId: z.string().min(1).max(64),
    catalogUrl: z.string().min(1).max(512),
    catalogHash: contentHashSchema,
    profileUrl: z.string().min(1).max(512),
    profileHash: contentHashSchema,
  })
  .strict();
export type CollectionGameWorkerWarmRequest = z.infer<typeof collectionGameWorkerWarmRequestSchema>;

export const collectionGameWorkerRequestSchema = z.discriminatedUnion('type', [
  collectionGameWorkerSimulateRequestSchema,
  collectionGameWorkerCancelRequestSchema,
  collectionGameWorkerWarmRequestSchema,
]);
export type CollectionGameWorkerRequest = z.infer<typeof collectionGameWorkerRequestSchema>;

export const collectionGameWorkerRequestUnionSchema = z.union([
  collectionGameWorkerSimulateRequestV1Schema,
  collectionGameWorkerRequestSchema,
]);
export type CollectionGameWorkerRequestUnion = z.infer<
  typeof collectionGameWorkerRequestUnionSchema
>;

export const collectionGameWorkerCompleteMessageSchema = z
  .object({
    wireVersion: z.literal(COLLECTION_GAME_WORKER_WIRE_VERSION),
    type: z.literal('collection-game-complete'),
    requestId: z.string().min(1).max(64),
    gameId: collectionGameIdSchema,
    result: collectionGameResultUnionSchema,
    events: z.array(collectionGameEventSchema).min(1),
    eventDigest: z.string().regex(/^[0-9a-f]{32}$/),
    resultDigest: z.string().regex(/^[0-9a-f]{32}$/),
  })
  .strict();
export type CollectionGameWorkerCompleteMessage = z.infer<
  typeof collectionGameWorkerCompleteMessageSchema
>;

export const collectionGameWorkerCompleteMessageV1Schema = z
  .object({
    wireVersion: z.literal(COLLECTION_GAME_V1_WORKER_WIRE_VERSION),
    type: z.literal('collection-game-complete'),
    requestId: z.string().min(1).max(64),
    gameId: collectionGameIdSchema,
    result: collectionGameResultV1Schema,
    events: z.array(collectionGameEventSchema).min(1),
    eventDigest: z.string().regex(/^[0-9a-f]{32}$/),
    resultDigest: z.string().regex(/^[0-9a-f]{32}$/),
  })
  .strict();
export type CollectionGameWorkerCompleteMessageV1 = z.infer<
  typeof collectionGameWorkerCompleteMessageV1Schema
>;

export const collectionGameWorkerErrorCodeSchema = z.enum([
  'validation-failure',
  'invariant-failure',
  'cancelled',
  'internal',
]);
export type CollectionGameWorkerErrorCode = z.infer<typeof collectionGameWorkerErrorCodeSchema>;

export const collectionGameWorkerErrorMessageSchema = z
  .object({
    wireVersion: z.literal(COLLECTION_GAME_WORKER_WIRE_VERSION),
    type: z.literal('collection-game-error'),
    requestId: z.string().min(1).max(64),
    gameId: collectionGameIdSchema.nullable(),
    code: collectionGameWorkerErrorCodeSchema,
    message: z.string().min(1).max(512),
    seed: seedSchema.nullable(),
  })
  .strict();
export type CollectionGameWorkerErrorMessage = z.infer<
  typeof collectionGameWorkerErrorMessageSchema
>;

export const collectionGameWorkerWarmAckMessageSchema = z
  .object({
    wireVersion: z.literal(COLLECTION_GAME_WORKER_WIRE_VERSION),
    type: z.literal('collection-game-warm-ack'),
    requestId: z.string().min(1).max(64),
  })
  .strict();
export type CollectionGameWorkerWarmAckMessage = z.infer<
  typeof collectionGameWorkerWarmAckMessageSchema
>;

export const collectionGameWorkerMessageSchema = z.discriminatedUnion('type', [
  collectionGameWorkerCompleteMessageSchema,
  collectionGameWorkerErrorMessageSchema,
  collectionGameWorkerWarmAckMessageSchema,
]);
export type CollectionGameWorkerMessage = z.infer<typeof collectionGameWorkerMessageSchema>;
