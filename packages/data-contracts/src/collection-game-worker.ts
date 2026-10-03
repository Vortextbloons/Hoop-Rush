import { z } from 'zod';
import { contentHashSchema, seedSchema } from './ids.ts';
import { collectionCardIdSchema } from './collection-primitives.ts';
import { collectionDifficultyProfileSchema } from './collection-difficulty.ts';
import { collectionObjectiveDefinitionSchema } from './collection-objective.ts';
import { collectionBalancesSchema, collectionLedgerEntrySchema } from './collection.ts';
import { collectionProgressionRulesSchema } from './collection-progression.ts';
import {
  collectionGameEventSchema,
  collectionGameIdSchema,
  collectionGameRecordUnionSchema,
  collectionGameResultUnionSchema,
  collectionGameResultV1Schema,
  collectionGameResultV1V2UnionSchema,
  collectionGameCommandSchema,
  collectionCpuRarityWeightsSchema,
  collectionPlayStateSchema,
  collectionPreparedGameUnionSchema,
  collectionPreparedGameV1Schema,
  collectionPreparedGameV1V2UnionSchema,
} from './collection-game.ts';
import {
  COLLECTION_GAME_V1_WORKER_WIRE_VERSION,
  COLLECTION_GAME_V2_WORKER_WIRE_VERSION,
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

export const collectionGameWorkerSimulateRequestV2Schema = z
  .object({
    wireVersion: z.literal(COLLECTION_GAME_V2_WORKER_WIRE_VERSION),
    type: z.literal('collection-game-simulate'),
    requestId: z.string().min(1).max(64),
    prepared: collectionPreparedGameV1V2UnionSchema,
    catalogUrl: z.string().min(1).max(512),
    catalogHash: contentHashSchema,
    profileUrl: z.string().min(1).max(512),
    profileHash: contentHashSchema,
  })
  .strict();
export type CollectionGameWorkerSimulateRequestV2 = z.infer<
  typeof collectionGameWorkerSimulateRequestV2Schema
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

export const collectionGameWorkerVerifyRequestSchema = z
  .object({
    wireVersion: z.literal(COLLECTION_GAME_WORKER_WIRE_VERSION),
    type: z.literal('collection-game-verify'),
    requestId: z.string().min(1).max(64),
    playState: collectionPlayStateSchema,
    command: collectionGameCommandSchema,
    catalogUrl: z.string().min(1).max(512),
    catalogHash: contentHashSchema,
    profileUrl: z.string().min(1).max(512),
    profileHash: contentHashSchema,
    rootSeed: seedSchema,
    ownedCardIds: z.array(collectionCardIdSchema),
    cpuWeights: collectionCpuRarityWeightsSchema,
    difficultyProfiles: z.array(collectionDifficultyProfileSchema),
    objectiveDefinitions: z.array(collectionObjectiveDefinitionSchema),
    rulesHash: contentHashSchema,
    balances: collectionBalancesSchema,
    priorCommands: z.array(collectionGameCommandSchema),
    progression: collectionProgressionRulesSchema.nullable(),
    progressionHash: contentHashSchema.nullable(),
  })
  .strict();
export type CollectionGameWorkerVerifyRequest = z.infer<
  typeof collectionGameWorkerVerifyRequestSchema
>;

export const collectionGameWorkerRequestSchema = z.discriminatedUnion('type', [
  collectionGameWorkerSimulateRequestSchema,
  collectionGameWorkerCancelRequestSchema,
  collectionGameWorkerWarmRequestSchema,
  collectionGameWorkerVerifyRequestSchema,
]);
export type CollectionGameWorkerRequest = z.infer<typeof collectionGameWorkerRequestSchema>;

export const collectionGameWorkerRequestUnionSchema = z.union([
  collectionGameWorkerSimulateRequestV1Schema,
  collectionGameWorkerSimulateRequestV2Schema,
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

export const collectionGameWorkerCompleteMessageV2Schema = z
  .object({
    wireVersion: z.literal(COLLECTION_GAME_V2_WORKER_WIRE_VERSION),
    type: z.literal('collection-game-complete'),
    requestId: z.string().min(1).max(64),
    gameId: collectionGameIdSchema,
    result: collectionGameResultV1V2UnionSchema,
    events: z.array(collectionGameEventSchema).min(1),
    eventDigest: z.string().regex(/^[0-9a-f]{32}$/),
    resultDigest: z.string().regex(/^[0-9a-f]{32}$/),
  })
  .strict();
export type CollectionGameWorkerCompleteMessageV2 = z.infer<
  typeof collectionGameWorkerCompleteMessageV2Schema
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

export const collectionGameWorkerPreparedGameRefSchema = z.object({
  gameId: collectionGameIdSchema,
  gameSequence: z.number().int().min(0),
});
export type CollectionGameWorkerPreparedGameRef = z.infer<
  typeof collectionGameWorkerPreparedGameRefSchema
>;

export const collectionGameWorkerAcceptedOutcomeSchema = z.object({
  status: z.literal('accepted'),
  playState: collectionPlayStateSchema,
  prepared: collectionGameWorkerPreparedGameRefSchema.optional(),
  record: collectionGameRecordUnionSchema.optional(),
  ledgerEntries: z.array(collectionLedgerEntrySchema).optional(),
  balances: collectionBalancesSchema.optional(),
});
export type CollectionGameWorkerAcceptedOutcome = z.infer<
  typeof collectionGameWorkerAcceptedOutcomeSchema
>;

export const collectionGameWorkerRejectedOutcomeSchema = z.object({
  status: z.literal('rejected'),
  rejection: z.looseObject({ code: z.string() }),
});
export type CollectionGameWorkerRejectedOutcome = z.infer<
  typeof collectionGameWorkerRejectedOutcomeSchema
>;

export const collectionGameWorkerOutcomeSchema = z.discriminatedUnion('status', [
  collectionGameWorkerAcceptedOutcomeSchema,
  collectionGameWorkerRejectedOutcomeSchema,
]);
export type CollectionGameWorkerOutcome = z.infer<typeof collectionGameWorkerOutcomeSchema>;

export const collectionGameWorkerVerifiedMessageSchema = z
  .object({
    wireVersion: z.literal(COLLECTION_GAME_WORKER_WIRE_VERSION),
    type: z.literal('collection-game-verified'),
    requestId: z.string().min(1).max(64),
    outcome: collectionGameWorkerOutcomeSchema,
  })
  .strict();
export type CollectionGameWorkerVerifiedMessage = z.infer<
  typeof collectionGameWorkerVerifiedMessageSchema
>;

export const collectionGameWorkerMessageSchema = z.discriminatedUnion('type', [
  collectionGameWorkerCompleteMessageSchema,
  collectionGameWorkerErrorMessageSchema,
  collectionGameWorkerWarmAckMessageSchema,
  collectionGameWorkerVerifiedMessageSchema,
]);
export type CollectionGameWorkerMessage = z.infer<typeof collectionGameWorkerMessageSchema>;
