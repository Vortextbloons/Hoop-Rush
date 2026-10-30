import { z } from 'zod';
import { capRushApronFactSchema } from './cap-rush-apron.ts';
import { opponentBracketSchema } from './bracket.ts';
import { CAP_RUSH_GAME_COUNT, capRushDigestSchema } from './cap-rush-versions.ts';
import { capRushGameSummarySchema } from './cap-rush-season.ts';
import { capRushLockedInputsSchema } from './cap-rush-lock.ts';
import { capRushLeagueGameSchema } from './cap-rush-league.ts';
import {
  capRushLeagueResultSchema,
  capRushPlayoffGamePlanSchema,
  capRushStoredPlayoffGameSchema,
} from './cap-rush-postseason.ts';
import {
  havocGameAuditSchema,
  havocGameInputSchema,
  havocGameResultSchema,
  havocGameTapeSchema,
} from './havoc-game.ts';
import { havocBattleInputSchema, havocBattleTapeSchema } from './havoc-battle.ts';

export const CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION = 4;

const capRushWorkerBase = z.object({
  schemaVersion: z.literal(CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION),
  requestId: z.string().min(1).max(64),
});

export const capRushWorkerBracketSchema = opponentBracketSchema;

export const capRushWorkerSimulateRequestSchema = capRushWorkerBase.extend({
  type: z.literal('cap-rush-simulate'),
  locked: capRushLockedInputsSchema,
  startGame: z.number().int().min(1).max(CAP_RUSH_GAME_COUNT),
  count: z.number().int().min(1).max(CAP_RUSH_GAME_COUNT),
  includeTape: z.boolean().optional(),
  leagueOnly: z.boolean().optional(),
  backfillLeagueFrom: z.number().int().min(1).max(CAP_RUSH_GAME_COUNT).optional(),
  backfillLeagueTo: z.number().int().min(1).max(CAP_RUSH_GAME_COUNT).optional(),
});
export type CapRushWorkerSimulateRequest = z.infer<typeof capRushWorkerSimulateRequestSchema>;

export const capRushWorkerStandingsRequestSchema = capRushWorkerBase.extend({
  type: z.literal('cap-rush-standings'),
  locked: capRushLockedInputsSchema,
  bracket: capRushWorkerBracketSchema,
});
export type CapRushWorkerStandingsRequest = z.infer<typeof capRushWorkerStandingsRequestSchema>;

export const capRushWorkerPlayoffsRequestSchema = capRushWorkerBase.extend({
  type: z.literal('cap-rush-playoffs'),
  locked: capRushLockedInputsSchema,
  games: z.array(capRushPlayoffGamePlanSchema).min(1).max(8),
  includeTape: z.boolean().optional(),
});
export type CapRushWorkerPlayoffsRequest = z.infer<typeof capRushWorkerPlayoffsRequestSchema>;

export const capRushWorkerCancelRequestSchema = capRushWorkerBase.extend({
  type: z.literal('cap-rush-cancel'),
});
export type CapRushWorkerCancelRequest = z.infer<typeof capRushWorkerCancelRequestSchema>;

export const capRushWorkerRequestSchema = z.discriminatedUnion('type', [
  capRushWorkerSimulateRequestSchema,
  capRushWorkerStandingsRequestSchema,
  capRushWorkerPlayoffsRequestSchema,
  capRushWorkerCancelRequestSchema,
]);
export type CapRushWorkerRequest = z.infer<typeof capRushWorkerRequestSchema>;

export const capRushWorkerGameMessageSchema = capRushWorkerBase.extend({
  type: z.literal('cap-rush-game'),
  cursor: z.number().int().min(1).max(CAP_RUSH_GAME_COUNT),
  inputDigest: capRushDigestSchema,
  resultDigest: capRushDigestSchema,
  isolations: z.number().int().nonnegative(),
  strikes: z.number().int().nonnegative(),
  summary: capRushGameSummarySchema,
  audit: havocGameAuditSchema,
  result: havocGameResultSchema,
  leagueGames: z.array(capRushLeagueGameSchema).max(15).optional(),
  playback: z
    .object({
      input: havocGameInputSchema,
      tape: havocGameTapeSchema,
      facts: z.array(capRushApronFactSchema),
    })
    .optional(),
});
export type CapRushWorkerGameMessage = z.infer<typeof capRushWorkerGameMessageSchema>;

export const capRushWorkerLeagueGamesMessageSchema = capRushWorkerBase.extend({
  type: z.literal('cap-rush-league-games'),
  slot: z.number().int().min(1).max(CAP_RUSH_GAME_COUNT),
  leagueGames: z.array(capRushLeagueGameSchema).min(1).max(15),
});
export type CapRushWorkerLeagueGamesMessage = z.infer<typeof capRushWorkerLeagueGamesMessageSchema>;

export const capRushWorkerPlayoffGameMessageSchema = capRushWorkerBase.extend({
  type: z.literal('cap-rush-playoff-game'),
  game: capRushStoredPlayoffGameSchema,
  playback: z
    .object({
      input: havocBattleInputSchema,
      tape: havocBattleTapeSchema,
      facts: z.array(capRushApronFactSchema),
    })
    .optional(),
});
export type CapRushWorkerPlayoffGameMessage = z.infer<typeof capRushWorkerPlayoffGameMessageSchema>;

export const capRushWorkerProgressMessageSchema = capRushWorkerBase.extend({
  type: z.literal('cap-rush-progress'),
  gamesCompleted: z.number().int().nonnegative(),
  gamesTotal: z.number().int().min(1),
});
export type CapRushWorkerProgressMessage = z.infer<typeof capRushWorkerProgressMessageSchema>;

export const capRushWorkerStandingsCompleteMessageSchema = capRushWorkerBase.extend({
  type: z.literal('cap-rush-standings-complete'),
  result: capRushLeagueResultSchema.nullable(),
  cancelled: z.boolean(),
});
export type CapRushWorkerStandingsCompleteMessage = z.infer<
  typeof capRushWorkerStandingsCompleteMessageSchema
>;

export const capRushWorkerCompleteMessageSchema = capRushWorkerBase.extend({
  type: z.literal('cap-rush-complete'),
  gamesDelivered: z.number().int().nonnegative(),
  cancelled: z.boolean(),
  lastCursor: z.number().int().min(0).max(CAP_RUSH_GAME_COUNT),
});
export type CapRushWorkerCompleteMessage = z.infer<typeof capRushWorkerCompleteMessageSchema>;

export const capRushWorkerPlayoffsCompleteMessageSchema = capRushWorkerBase.extend({
  type: z.literal('cap-rush-playoffs-complete'),
  gamesDelivered: z.number().int().nonnegative(),
  cancelled: z.boolean(),
});
export type CapRushWorkerPlayoffsCompleteMessage = z.infer<
  typeof capRushWorkerPlayoffsCompleteMessageSchema
>;

export const capRushWorkerErrorCodeSchema = z.enum([
  'audit-failure',
  'stale-job',
  'cancelled',
  'internal',
]);
export type CapRushWorkerErrorCode = z.infer<typeof capRushWorkerErrorCodeSchema>;

export const capRushWorkerErrorMessageSchema = capRushWorkerBase.extend({
  type: z.literal('cap-rush-error'),
  code: capRushWorkerErrorCodeSchema,
  message: z.string().min(1).max(512),
  gameNumber: z.number().int().min(1).max(CAP_RUSH_GAME_COUNT).nullable(),
});
export type CapRushWorkerErrorMessage = z.infer<typeof capRushWorkerErrorMessageSchema>;

export const capRushWorkerMessageSchema = z.discriminatedUnion('type', [
  capRushWorkerGameMessageSchema,
  capRushWorkerLeagueGamesMessageSchema,
  capRushWorkerPlayoffGameMessageSchema,
  capRushWorkerProgressMessageSchema,
  capRushWorkerStandingsCompleteMessageSchema,
  capRushWorkerCompleteMessageSchema,
  capRushWorkerPlayoffsCompleteMessageSchema,
  capRushWorkerErrorMessageSchema,
]);
export type CapRushWorkerMessage = z.infer<typeof capRushWorkerMessageSchema>;
