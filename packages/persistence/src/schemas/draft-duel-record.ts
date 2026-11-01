import { z } from 'zod';
import {
  draftDuelActiveStateSchema,
  draftDuelCommandSchema,
  draftDuelCompletionRecapSchema,
  draftDuelGameOutputSchema,
  draftDuelPartiallyVerifiedSchema,
  draftDuelParticipantIdSchema,
  draftDuelSeriesMvpSchema,
  draftDuelSeriesSnapshotSchema,
  draftDuelStandoutSchema,
  type DraftDuelActiveState,
  type DraftDuelCompletionRecap,
} from '@hoop-rush/data-contracts';

export { draftDuelActiveStateSchema, draftDuelCompletionRecapSchema };
export type { DraftDuelActiveState, DraftDuelCompletionRecap };
export const DRAFT_DUEL_SAVE_SCHEMA_VERSION = 1;
const roomIdSchema = z.string().min(1).max(64);
const roomRecordIdSchema = z.string().min(1).max(64);
const isoDateSchema = z.string().min(1).max(64);
export const storedDraftDuelActiveSchema = draftDuelActiveStateSchema.extend({
  saveSchemaVersion: z.literal(DRAFT_DUEL_SAVE_SCHEMA_VERSION),
  updatedAtIso: isoDateSchema,
});
export type StoredDraftDuelActive = z.infer<typeof storedDraftDuelActiveSchema>;
export const storedDraftDuelCommandRowSchema = z.object({
  saveSchemaVersion: z.literal(DRAFT_DUEL_SAVE_SCHEMA_VERSION),
  roomId: roomIdSchema,
  ordinal: z.number().int().nonnegative(),
  command: draftDuelCommandSchema,
  updatedAtIso: isoDateSchema,
});
export type StoredDraftDuelCommandRow = z.infer<typeof storedDraftDuelCommandRowSchema>;
export const storedDraftDuelResultRowSchema = z.object({
  saveSchemaVersion: z.literal(DRAFT_DUEL_SAVE_SCHEMA_VERSION),
  roomId: roomIdSchema,
  gameNumber: z.number().int().min(1).max(7),
  output: draftDuelGameOutputSchema,
  verified: z.boolean(),
  storedAtIso: isoDateSchema,
});
export type StoredDraftDuelResultRow = z.infer<typeof storedDraftDuelResultRowSchema>;
export const storedDraftDuelCompletedSchema = z.object({
  saveSchemaVersion: z.literal(DRAFT_DUEL_SAVE_SCHEMA_VERSION),
  roomId: roomIdSchema,
  champion: draftDuelParticipantIdSchema,
  series: draftDuelSeriesSnapshotSchema,
  mvp: draftDuelSeriesMvpSchema.nullable(),
  standouts: z.array(draftDuelStandoutSchema),
  games: z.number().int().min(1).max(7),
  completedAtIso: isoDateSchema,
});
export type StoredDraftDuelCompleted = z.infer<typeof storedDraftDuelCompletedSchema>;
export const storedDraftDuelHistoryIndexSchema = z.object({
  saveSchemaVersion: z.literal(DRAFT_DUEL_SAVE_SCHEMA_VERSION),
  recordId: roomRecordIdSchema,
  roomId: roomIdSchema,
  champion: draftDuelParticipantIdSchema,
  gameCount: z.number().int().min(1).max(7),
  completedAtIso: isoDateSchema,
});
export type StoredDraftDuelHistoryIndex = z.infer<typeof storedDraftDuelHistoryIndexSchema>;
