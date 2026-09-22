import { z } from 'zod';
import {
  COLLECTION_PLAY_SAVE_V1_VERSION,
  COLLECTION_PLAY_SAVE_V2_VERSION,
  COLLECTION_PLAY_SAVE_VERSION,
  COLLECTION_SAVE_V1_VERSION,
  COLLECTION_SAVE_VERSION,
  collectionCommandSchema,
  collectionGameCommandSchema,
  collectionGameIdSchema,
  collectionGameRecordV1Schema,
  collectionGameRecordV2Schema,
  collectionGameRecordV3Schema,
  collectionLedgerEntrySchema,
  collectionOwnedCardSchema,
  collectionPlayStateV1Schema,
  collectionPlayStateV2Schema,
  collectionPlayStateV3Schema,
  collectionPullRecordUnionSchema,
  collectionSetClaimReceiptSchema,
  collectionStateV1Schema,
  collectionStateV2Schema,
  contentHashSchema,
  seedSchema,
  type CollectionCommand,
  type CollectionGameCommand,
  type CollectionGameRecordUnion,
  type CollectionLedgerEntry,
  type CollectionOwnedCard,
  type CollectionPlayStateUnion,
  type CollectionPullRecord,
  type CollectionSetClaimReceipt,
  type CollectionState,
  type CollectionStateUnion,
} from '@hoop-rush/data-contracts';

const storedCollectionStateRowBaseSchema = z.object({
  collectionId: z.string().min(1).max(64),
  catalogHash: contentHashSchema,
  updatedAtIso: z.string().min(1).max(64),
});

export const storedCollectionStateV1Schema = storedCollectionStateRowBaseSchema.extend({
  saveSchemaVersion: z.literal(COLLECTION_SAVE_V1_VERSION),
  state: collectionStateV1Schema,
});
export type StoredCollectionStateV1Row = z.infer<typeof storedCollectionStateV1Schema>;

export const storedCollectionStateV2Schema = storedCollectionStateRowBaseSchema.extend({
  saveSchemaVersion: z.literal(COLLECTION_SAVE_VERSION),
  state: collectionStateV2Schema,
});
export type StoredCollectionStateV2Row = z.infer<typeof storedCollectionStateV2Schema>;

export const storedCollectionStateUnionSchema = z.union([
  storedCollectionStateV2Schema,
  storedCollectionStateV1Schema,
]);
export const storedCollectionStateSchema = storedCollectionStateV2Schema;
export type StoredCollectionStateRow = z.infer<typeof storedCollectionStateUnionSchema>;

export const storedCollectionOwnershipSchema = z.object({
  collectionId: z.string().min(1).max(64),
  cardId: z.string().min(1).max(64),
  owned: collectionOwnedCardSchema,
});
export type StoredCollectionOwnershipRow = z.infer<typeof storedCollectionOwnershipSchema>;

export const storedCollectionPullSchema = z.object({
  collectionId: z.string().min(1).max(64),
  pullSequence: z.number().int().nonnegative(),
  pull: collectionPullRecordUnionSchema,
});
export type StoredCollectionPullRow = z.infer<typeof storedCollectionPullSchema>;

export const storedCollectionLedgerSchema = z.object({
  collectionId: z.string().min(1).max(64),
  transactionId: z.string().min(1).max(128),
  entry: collectionLedgerEntrySchema,
});
export type StoredCollectionLedgerRow = z.infer<typeof storedCollectionLedgerSchema>;

export const storedCollectionCommandSchema = z.object({
  collectionId: z.string().min(1).max(64),
  commandId: z.string().min(1).max(128),
  command: collectionCommandSchema,
  accepted: z.boolean(),
  rejectionCode: z.string().min(1).max(64).nullable(),
  postRevision: z.number().int().nonnegative().nullable(),
  postDigest: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .nullable(),
  pullSequence: z.number().int().nonnegative().nullable(),
  setReceipt: collectionSetClaimReceiptSchema.nullable().optional(),
  recordedAtIso: z.string().min(1).max(64),
});
export type StoredCollectionCommandRow = z.infer<typeof storedCollectionCommandSchema>;

export type StoredCollectionState = CollectionStateUnion;
export type StoredCollectionOwned = CollectionOwnedCard;
export type StoredCollectionPull = CollectionPullRecord;
export type StoredCollectionLedger = CollectionLedgerEntry;
export type StoredCollectionCommand = CollectionCommand;
export type StoredCollectionSetClaimReceipt = CollectionSetClaimReceipt;

const storedCollectionPlayStateRowBaseSchema = z.object({
  collectionId: z.string().min(1).max(64),
  rootSeed: seedSchema,
  catalogHash: contentHashSchema,
  updatedAtIso: z.string().min(1).max(64),
});

export const storedCollectionPlayStateV1Schema = storedCollectionPlayStateRowBaseSchema.extend({
  saveSchemaVersion: z.literal(COLLECTION_PLAY_SAVE_V1_VERSION),
  playState: collectionPlayStateV1Schema,
});

export const storedCollectionPlayStateV2Schema = storedCollectionPlayStateRowBaseSchema.extend({
  saveSchemaVersion: z.literal(COLLECTION_PLAY_SAVE_V2_VERSION),
  playState: collectionPlayStateV2Schema,
});

export const storedCollectionPlayStateV3Schema = storedCollectionPlayStateRowBaseSchema.extend({
  saveSchemaVersion: z.literal(COLLECTION_PLAY_SAVE_VERSION),
  playState: collectionPlayStateV3Schema,
});

export const storedCollectionPlayStateUnionSchema = z.union([
  storedCollectionPlayStateV3Schema,
  storedCollectionPlayStateV2Schema,
  storedCollectionPlayStateV1Schema,
]);

export const storedCollectionPlayStateSchema = storedCollectionPlayStateV3Schema;

export type StoredCollectionPlayStateV1Row = z.infer<typeof storedCollectionPlayStateV1Schema>;
export type StoredCollectionPlayStateV2Row = z.infer<typeof storedCollectionPlayStateV2Schema>;
export type StoredCollectionPlayStateV3Row = z.infer<typeof storedCollectionPlayStateV3Schema>;
export type StoredCollectionPlayStateRow = z.infer<typeof storedCollectionPlayStateUnionSchema>;

const storedCollectionGameRowBaseSchema = z.object({
  collectionId: z.string().min(1).max(64),
  gameId: collectionGameIdSchema,
  gameSequence: z.number().int().nonnegative(),
});

export const storedCollectionGameV1Schema = storedCollectionGameRowBaseSchema.extend({
  record: collectionGameRecordV1Schema,
});

export const storedCollectionGameV2Schema = storedCollectionGameRowBaseSchema.extend({
  record: collectionGameRecordV2Schema,
});

export const storedCollectionGameV3Schema = storedCollectionGameRowBaseSchema.extend({
  record: collectionGameRecordV3Schema,
});

export const storedCollectionGameUnionSchema = z.union([
  storedCollectionGameV3Schema,
  storedCollectionGameV2Schema,
  storedCollectionGameV1Schema,
]);

export const storedCollectionGameSchema = storedCollectionGameUnionSchema;

export type StoredCollectionGameRow = z.infer<typeof storedCollectionGameUnionSchema>;
export type StoredCollectionGameV2Row = z.infer<typeof storedCollectionGameV2Schema>;
export type StoredCollectionGameV3Row = z.infer<typeof storedCollectionGameV3Schema>;

export const storedCollectionGameCommandSchema = z.object({
  collectionId: z.string().min(1).max(64),
  commandId: z.string().min(1).max(128),
  command: collectionGameCommandSchema,
  accepted: z.boolean(),
  rejectionCode: z.string().min(1).max(64).nullable(),
  postRevision: z.number().int().nonnegative().nullable(),
  postDigest: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .nullable(),
  gameId: collectionGameIdSchema.nullable(),
  gameSequence: z.number().int().nonnegative().nullable(),
  recordedAtIso: z.string().min(1).max(64),
});
export type StoredCollectionGameCommandRow = z.infer<typeof storedCollectionGameCommandSchema>;

export type StoredCollectionPlayState = CollectionPlayStateUnion;
export type StoredCollectionGame = CollectionGameRecordUnion;
export type StoredCollectionGameCommand = CollectionGameCommand;
