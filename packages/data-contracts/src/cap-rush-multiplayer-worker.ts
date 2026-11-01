import { z } from 'zod';
import { idSchema } from './ids.ts';
import { capRushLeagueGameSchema, capRushLeagueScheduleEntrySchema } from './cap-rush-league.ts';
import {
  capRushPlayoffGamePlanSchema,
  capRushPlayoffGameSummarySchema,
} from './cap-rush-postseason.ts';
import { capRushMultiplayerLockedInputsSchema } from './cap-rush-multiplayer-league.ts';
import {
  havocBattleInputSchema,
  havocBattleResultSchema,
  havocBattleTapeSchema,
} from './havoc-battle.ts';
import { CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION } from './cap-rush-multiplayer-versions.ts';

const base = z.object({
  schemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION),
  requestId: idSchema,
});

export const capRushMultiplayerWorkerRequestSchema = z.discriminatedUnion('kind', [
  base.extend({
    kind: z.literal('cap-rush-multiplayer-slot'),
    roomId: idSchema,
    locked: capRushMultiplayerLockedInputsSchema,
    slot: z.number().int().min(1).max(82),
    throughSlot: z.number().int().min(1).max(82).optional(),
    tapeGameIds: z.array(z.string().min(1).max(80)).max(2),
  }),
  base.extend({
    kind: z.literal('cap-rush-multiplayer-playoff-games'),
    roomId: idSchema,
    locked: capRushMultiplayerLockedInputsSchema,
    plans: z.array(capRushPlayoffGamePlanSchema).min(1).max(8),
    tapeGameIds: z.array(z.string().min(1).max(80)).max(8),
  }),
  base
    .extend({
      kind: z.literal('cap-rush-multiplayer-tape'),
      roomId: idSchema,
      locked: capRushMultiplayerLockedInputsSchema,
      entry: capRushLeagueScheduleEntrySchema.optional(),
      plan: capRushPlayoffGamePlanSchema.optional(),
    })
    .refine((value) => (value.entry === undefined) !== (value.plan === undefined), {
      message: 'a tape request needs exactly one schedule entry or playoff plan',
    }),
  base.extend({
    kind: z.literal('cap-rush-multiplayer-cancel'),
  }),
]);
export type CapRushMultiplayerWorkerRequest = z.infer<typeof capRushMultiplayerWorkerRequestSchema>;

export const capRushMultiplayerWorkerSlotMessageSchema = z.object({
  schemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION),
  kind: z.literal('cap-rush-multiplayer-slot'),
  requestId: idSchema,
  slot: z.number().int().min(1).max(82),
  games: z.array(capRushLeagueGameSchema).min(1).max(75),
  tapes: z.array(z.object({ gameId: z.string().min(1).max(80), tape: z.unknown() })).max(2),
});
export type CapRushMultiplayerWorkerSlotMessage = z.infer<
  typeof capRushMultiplayerWorkerSlotMessageSchema
>;

export const capRushMultiplayerWorkerPlayoffMessageSchema = z.object({
  schemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION),
  kind: z.literal('cap-rush-multiplayer-playoff-games'),
  requestId: idSchema,
  games: z.array(capRushPlayoffGameSummarySchema).min(1).max(8),
  tapes: z.array(z.object({ gameId: z.string().min(1).max(80), tape: z.unknown() })).max(8),
});
export type CapRushMultiplayerWorkerPlayoffMessage = z.infer<
  typeof capRushMultiplayerWorkerPlayoffMessageSchema
>;

export const capRushMultiplayerWorkerTapeMessageSchema = z.object({
  schemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION),
  kind: z.literal('cap-rush-multiplayer-tape'),
  requestId: idSchema,
  gameId: z.string().min(1).max(80),
  input: havocBattleInputSchema,
  result: havocBattleResultSchema,
  tape: havocBattleTapeSchema,
});
export type CapRushMultiplayerWorkerTapeMessage = z.infer<
  typeof capRushMultiplayerWorkerTapeMessageSchema
>;

export const capRushMultiplayerWorkerErrorMessageSchema = z.object({
  schemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION),
  kind: z.literal('cap-rush-multiplayer-error'),
  requestId: idSchema,
  code: z.enum(['audit-failure', 'stale-job', 'cancelled', 'internal']),
  message: z.string().min(1).max(400),
});
export type CapRushMultiplayerWorkerErrorMessage = z.infer<
  typeof capRushMultiplayerWorkerErrorMessageSchema
>;

export const capRushMultiplayerWorkerMessageSchema = z.union([
  capRushMultiplayerWorkerSlotMessageSchema,
  capRushMultiplayerWorkerPlayoffMessageSchema,
  capRushMultiplayerWorkerTapeMessageSchema,
  capRushMultiplayerWorkerErrorMessageSchema,
]);
export type CapRushMultiplayerWorkerMessage = z.infer<typeof capRushMultiplayerWorkerMessageSchema>;
