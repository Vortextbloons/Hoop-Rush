import { z } from 'zod';
import {
  HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
  HAVOC_MULTIPLAYER_SERIES_GAMES,
  HAVOC_MULTIPLAYER_SERIES_WINS,
  commandIdSchema,
  havocBattleResultSchema,
  havocBattleTapeSchema,
  havocDigestSchema,
  havocMultiplayerActiveStateSchema,
  havocMultiplayerCommandEntrySchema,
  havocMultiplayerCommandPayloadSchema,
  havocMultiplayerCompletionRecapSchema,
  havocMultiplayerGameOutputSchema,
  havocMultiplayerParticipantIdSchema,
  havocMultiplayerSeriesMvpSchema,
  type HavocMultiplayerActiveState,
  type HavocMultiplayerCommandEntry,
  type HavocMultiplayerCompletionRecap,
  type HavocMultiplayerGameOutput,
  type HavocMultiplayerSeriesMvp,
} from '@hoop-rush/data-contracts';

const roomIdSchema = z.string().min(1).max(64);
const roomRecordIdSchema = z.string().min(1).max(64);
const isoDateSchema = z.string().min(1).max(64);
const gameNumberSchema = z.number().int().min(1).max(HAVOC_MULTIPLAYER_SERIES_GAMES);

// Domain values are canonical in `@hoop-rush/data-contracts`, because the
// application describes saves with them. Re-exported for existing imports.
export {
  havocMultiplayerActiveStateSchema,
  havocMultiplayerCommandEntrySchema,
  havocMultiplayerCompletionRecapSchema,
  havocMultiplayerGameOutputSchema,
  havocMultiplayerSeriesMvpSchema,
};
export type {
  HavocMultiplayerActiveState,
  HavocMultiplayerCommandEntry,
  HavocMultiplayerCompletionRecap,
  HavocMultiplayerGameOutput,
  HavocMultiplayerSeriesMvp,
};

export const storedHavocMultiplayerActiveSchema = havocMultiplayerActiveStateSchema
  .extend({
    saveSchemaVersion: z.literal(HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION),
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.snapshot.roomId !== row.roomId) {
      ctx.addIssue({ code: 'custom', message: 'stored snapshot room id does not match its row' });
    }
  });
export type StoredHavocMultiplayerActive = z.infer<typeof storedHavocMultiplayerActiveSchema>;

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

export const storedHavocMultiplayerCompletedSchema = havocMultiplayerCompletionRecapSchema.extend({
  saveSchemaVersion: z.literal(HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION),
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
