import { z } from 'zod';
import {
  COLLECTION_PLAY_SAVE_VERSION,
  COLLECTION_SAVE_VERSION,
  collectionCommandSchema,
  collectionGameCommandSchema,
  collectionGameIdSchema,
  collectionGameRecordSchema,
  collectionLedgerEntrySchema,
  collectionOwnedCardSchema,
  collectionPlayStateSchema,
  collectionPullRecordSchema,
  collectionStateSchema,
  contentHashSchema,
  seedSchema,
  type CollectionCommand,
  type CollectionGameCommand,
  type CollectionGameRecord,
  type CollectionLedgerEntry,
  type CollectionOwnedCard,
  type CollectionPlayState,
  type CollectionPullRecord,
  type CollectionState,
} from '@hoop-rush/data-contracts';

export const storedCollectionStateSchema = z.object({
  collectionId: z.string().min(1).max(64),
  saveSchemaVersion: z.literal(COLLECTION_SAVE_VERSION),
  state: collectionStateSchema,
  catalogHash: contentHashSchema,
  updatedAtIso: z.string().min(1).max(64),
});
export type StoredCollectionStateRow = z.infer<typeof storedCollectionStateSchema>;

export const storedCollectionOwnershipSchema = z.object({
  collectionId: z.string().min(1).max(64),
  cardId: z.string().min(1).max(64),
  owned: collectionOwnedCardSchema,
});
export type StoredCollectionOwnershipRow = z.infer<typeof storedCollectionOwnershipSchema>;

export const storedCollectionPullSchema = z.object({
  collectionId: z.string().min(1).max(64),
  pullSequence: z.number().int().nonnegative(),
  pull: collectionPullRecordSchema,
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
  recordedAtIso: z.string().min(1).max(64),
});
export type StoredCollectionCommandRow = z.infer<typeof storedCollectionCommandSchema>;

export type StoredCollectionState = CollectionState;
export type StoredCollectionOwned = CollectionOwnedCard;
export type StoredCollectionPull = CollectionPullRecord;
export type StoredCollectionLedger = CollectionLedgerEntry;
export type StoredCollectionCommand = CollectionCommand;

export const storedCollectionPlayStateSchema = z.object({
  collectionId: z.string().min(1).max(64),
  saveSchemaVersion: z.literal(COLLECTION_PLAY_SAVE_VERSION),
  playState: collectionPlayStateSchema,
  rootSeed: seedSchema,
  catalogHash: contentHashSchema,
  updatedAtIso: z.string().min(1).max(64),
});
export type StoredCollectionPlayStateRow = z.infer<typeof storedCollectionPlayStateSchema>;

export const storedCollectionGameSchema = z.object({
  collectionId: z.string().min(1).max(64),
  gameId: collectionGameIdSchema,
  gameSequence: z.number().int().nonnegative(),
  record: collectionGameRecordSchema,
});
export type StoredCollectionGameRow = z.infer<typeof storedCollectionGameSchema>;

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

export type StoredCollectionPlayState = CollectionPlayState;
export type StoredCollectionGame = CollectionGameRecord;
export type StoredCollectionGameCommand = CollectionGameCommand;
