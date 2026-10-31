import { z } from 'zod';
import {
  CAP_RUSH_MULTIPLAYER_SAVE_SCHEMA_VERSION,
  capRushLeagueGameSchema,
  capRushMultiplayerCommandReceiptSchema,
  capRushMultiplayerCommandSchema,
  capRushMultiplayerReportSchema,
  capRushMultiplayerRoomSnapshotSchema,
  capRushMultiplayerSeatIdSchema,
  capRushMultiplayerStateSchema,
  commandIdSchema,
  idSchema,
} from '@hoop-rush/data-contracts';

export const storedCapRushMultiplayerActiveRowSchema = z
  .object({
    saveSchemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_SAVE_SCHEMA_VERSION),
    roomId: idSchema,
    snapshot: capRushMultiplayerRoomSnapshotSchema,
    state: capRushMultiplayerStateSchema,
    commandCursor: z.number().int().nonnegative(),
    updatedAtIso: z.iso.datetime(),
  })
  .superRefine((row, ctx) => {
    if (row.snapshot.roomId !== row.roomId) {
      ctx.addIssue({ code: 'custom', message: 'the stored snapshot belongs to another room' });
    }
    if (row.snapshot.revision !== row.commandCursor) {
      ctx.addIssue({ code: 'custom', message: 'the stored command cursor is stale' });
    }
  });
export type StoredCapRushMultiplayerActiveRow = z.infer<
  typeof storedCapRushMultiplayerActiveRowSchema
>;

export const storedCapRushMultiplayerCommandRowSchema = z.object({
  saveSchemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_SAVE_SCHEMA_VERSION),
  roomId: idSchema,
  ordinal: z.number().int().nonnegative(),
  commandId: commandIdSchema,
  actorParticipantId: capRushMultiplayerSeatIdSchema,
  acceptedAtIso: z.iso.datetime(),
  payload: capRushMultiplayerCommandSchema.shape.payload,
  receipt: capRushMultiplayerCommandReceiptSchema,
  storedAtIso: z.iso.datetime(),
});
export type StoredCapRushMultiplayerCommandRow = z.infer<
  typeof storedCapRushMultiplayerCommandRowSchema
>;

export const storedCapRushMultiplayerGameRowSchema = z.object({
  saveSchemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_SAVE_SCHEMA_VERSION),
  roomId: idSchema,
  gameId: z.string().min(1).max(80),
  slot: z.number().int().min(1).max(82),
  game: capRushLeagueGameSchema,
  updatedAtIso: z.iso.datetime(),
});
export type StoredCapRushMultiplayerGameRow = z.infer<typeof storedCapRushMultiplayerGameRowSchema>;

export const storedCapRushMultiplayerCompletedRowSchema = z.object({
  saveSchemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_SAVE_SCHEMA_VERSION),
  roomId: idSchema,
  report: capRushMultiplayerReportSchema,
  snapshot: capRushMultiplayerRoomSnapshotSchema,
  completedAtIso: z.iso.datetime(),
});
export type StoredCapRushMultiplayerCompletedRow = z.infer<
  typeof storedCapRushMultiplayerCompletedRowSchema
>;

export const storedCapRushMultiplayerHistoryRowSchema = z.object({
  saveSchemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_SAVE_SCHEMA_VERSION),
  recordId: z.string().min(1).max(96),
  roomId: idSchema,
  championTeamId: z.string().min(1).max(64),
  completedAtIso: z.iso.datetime(),
});
export type StoredCapRushMultiplayerHistoryRow = z.infer<
  typeof storedCapRushMultiplayerHistoryRowSchema
>;
