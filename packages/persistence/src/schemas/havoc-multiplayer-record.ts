import { z } from 'zod';
import {
  HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
  HAVOC_MULTIPLAYER_SERIES_GAMES,
  HAVOC_MULTIPLAYER_SERIES_WINS,
  commandIdSchema,
  havocBattleResultSchema,
  havocBattleTapeSchema,
  havocDigestSchema,
  havocMultiplayerCommandPayloadSchema,
  havocMultiplayerCommandSchema,
  havocMultiplayerParticipantIdSchema,
  havocMultiplayerRoomSnapshotSchema,
  havocMultiplayerSeriesGameSchema,
  havocMultiplayerSeriesSnapshotSchema,
  havocMultiplayerVerificationReceiptSchema,
  positionSchema,
} from '@hoop-rush/data-contracts';

const roomIdSchema = z.string().min(1).max(64);
const roomRecordIdSchema = z.string().min(1).max(64);
const isoDateSchema = z.string().min(1).max(64);
const gameNumberSchema = z.number().int().min(1).max(HAVOC_MULTIPLAYER_SERIES_GAMES);

export const havocMultiplayerGameOutputSchema = z.object({
  roomId: roomIdSchema,
  gameNumber: gameNumberSchema,
  winner: havocMultiplayerParticipantIdSchema,
  result: havocBattleResultSchema,
  tape: havocBattleTapeSchema,
  inputDigest: havocDigestSchema,
  resultDigest: havocDigestSchema,
  tapeDigest: havocDigestSchema,
});
export type HavocMultiplayerGameOutput = z.infer<typeof havocMultiplayerGameOutputSchema>;

export const storedHavocMultiplayerActiveSchema = z
  .object({
    saveSchemaVersion: z.literal(HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION),
    roomId: roomIdSchema,
    snapshot: havocMultiplayerRoomSnapshotSchema,
    verification: z
      .array(havocMultiplayerVerificationReceiptSchema)
      .max(HAVOC_MULTIPLAYER_SERIES_GAMES),
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.snapshot.roomId !== row.roomId) {
      ctx.addIssue({ code: 'custom', message: 'stored snapshot room id does not match its row' });
    }
  });
export type StoredHavocMultiplayerActive = z.infer<typeof storedHavocMultiplayerActiveSchema>;
export type HavocMultiplayerActiveState = Omit<
  StoredHavocMultiplayerActive,
  'saveSchemaVersion' | 'updatedAtIso'
>;

export const havocMultiplayerCommandEntrySchema = z.object({
  ordinal: z.number().int().nonnegative(),
  command: havocMultiplayerCommandSchema,
});
export type HavocMultiplayerCommandEntry = z.infer<typeof havocMultiplayerCommandEntrySchema>;

export const storedHavocMultiplayerCommandRowSchema = z.object({
  saveSchemaVersion: z.literal(HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION),
  roomId: roomIdSchema,
  ordinal: z.number().int().nonnegative(),
  commandId: commandIdSchema,
  actorParticipantId: havocMultiplayerParticipantIdSchema,
  payload: havocMultiplayerCommandPayloadSchema,
  storedAtIso: isoDateSchema,
});
export type StoredHavocMultiplayerCommandRow = z.infer<
  typeof storedHavocMultiplayerCommandRowSchema
>;

export const storedHavocMultiplayerResultRowSchema = z
  .object({
    saveSchemaVersion: z.literal(HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION),
    roomId: roomIdSchema,
    gameNumber: gameNumberSchema,
    winner: havocMultiplayerParticipantIdSchema,
    result: havocBattleResultSchema,
    tape: havocBattleTapeSchema,
    inputDigest: havocDigestSchema,
    resultDigest: havocDigestSchema,
    tapeDigest: havocDigestSchema,
    verified: z.boolean(),
    storedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.result.gameNumber !== row.gameNumber) {
      ctx.addIssue({ code: 'custom', message: 'stored result game number does not match its row' });
    }
  });
export type StoredHavocMultiplayerResultRow = z.infer<typeof storedHavocMultiplayerResultRowSchema>;

export const havocMultiplayerSeriesMvpSchema = z.object({
  participantId: havocMultiplayerParticipantIdSchema,
  slot: positionSchema,
  index: z.number().int(),
});
export type HavocMultiplayerSeriesMvp = z.infer<typeof havocMultiplayerSeriesMvpSchema>;

export const havocMultiplayerCompletionRecapSchema = z.object({
  roomId: roomIdSchema,
  champion: havocMultiplayerParticipantIdSchema,
  series: havocMultiplayerSeriesSnapshotSchema,
  mvp: havocMultiplayerSeriesMvpSchema.nullable(),
  games: z.array(havocMultiplayerSeriesGameSchema).max(HAVOC_MULTIPLAYER_SERIES_GAMES),
});
export type HavocMultiplayerCompletionRecap = z.infer<typeof havocMultiplayerCompletionRecapSchema>;

export const storedHavocMultiplayerCompletedSchema = z.object({
  saveSchemaVersion: z.literal(HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION),
  roomId: roomIdSchema,
  champion: havocMultiplayerParticipantIdSchema,
  series: havocMultiplayerSeriesSnapshotSchema,
  mvp: havocMultiplayerSeriesMvpSchema.nullable(),
  games: z.array(havocMultiplayerSeriesGameSchema).max(HAVOC_MULTIPLAYER_SERIES_GAMES),
  completedAtIso: isoDateSchema,
});
export type StoredHavocMultiplayerCompleted = z.infer<typeof storedHavocMultiplayerCompletedSchema>;

export const storedHavocMultiplayerHistoryIndexSchema = z.object({
  saveSchemaVersion: z.literal(HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION),
  recordId: roomRecordIdSchema,
  roomId: roomIdSchema,
  championParticipantId: havocMultiplayerParticipantIdSchema,
  wins: z.number().int().min(1).max(HAVOC_MULTIPLAYER_SERIES_WINS),
  completedAtIso: isoDateSchema,
});
export type StoredHavocMultiplayerHistoryIndex = z.infer<
  typeof storedHavocMultiplayerHistoryIndexSchema
>;
