import { z } from 'zod';
import {
  FIXED_FIVE_ROOM_SCHEMA_VERSION,
  fixedFiveCommandSchema,
  fixedFiveCompetitionRunSchema,
  fixedFiveRoomSnapshotSchema,
} from '@hoop-rush/data-contracts';

export const storedFixedFiveActiveSchema = z.object({
  roomId: z.string().min(1).max(64),
  saveSchemaVersion: z.literal(FIXED_FIVE_ROOM_SCHEMA_VERSION),
  snapshot: fixedFiveRoomSnapshotSchema,
  commandCursor: z.number().int().nonnegative(),
  updatedAtIso: z.string().min(1).max(64),
});
export type StoredFixedFiveActive = z.infer<typeof storedFixedFiveActiveSchema>;

export const storedFixedFiveCommandRowSchema = z.object({
  roomId: z.string().min(1).max(64),
  ordinal: z.number().int().nonnegative(),
  command: fixedFiveCommandSchema,
  updatedAtIso: z.string().min(1).max(64),
});
export type StoredFixedFiveCommandRow = z.infer<typeof storedFixedFiveCommandRowSchema>;

export const storedFixedFivePendingResultSchema = z.object({
  roomId: z.string().min(1).max(64),
  saveSchemaVersion: z.literal(FIXED_FIVE_ROOM_SCHEMA_VERSION),
  run: fixedFiveCompetitionRunSchema,
  proposer: z.enum(['p1', 'p2']),
  updatedAtIso: z.string().min(1).max(64),
});
export type StoredFixedFivePendingResult = z.infer<typeof storedFixedFivePendingResultSchema>;

export const storedFixedFiveCompletedSchema = z.object({
  roomId: z.string().min(1).max(64),
  saveSchemaVersion: z.literal(FIXED_FIVE_ROOM_SCHEMA_VERSION),
  run: fixedFiveCompetitionRunSchema,
  completedAtIso: z.string().min(1).max(64),
});
export type StoredFixedFiveCompleted = z.infer<typeof storedFixedFiveCompletedSchema>;

export const storedFixedFiveHistoryIndexSchema = z.object({
  recordId: z.string().min(1).max(64),
  runId: z.string().min(1).max(64),
  roomId: z.string().min(1).max(64),
  mode: z.enum(['classic', 'sandbox']),
  competition: z.enum(['shared-82', 'duel']),
  winner: z.enum(['p1', 'p2']),
  completedAtIso: z.string().min(1).max(64),
});
export type StoredFixedFiveHistoryIndex = z.infer<typeof storedFixedFiveHistoryIndexSchema>;
