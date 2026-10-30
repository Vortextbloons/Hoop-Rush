import { z } from 'zod';
import { playerIdSchema, seasonKeySchema } from './ids.ts';
import { havocInstanceIdSchema } from './havoc-profile.ts';
import { playerVersionIdSchema } from './season-identity.ts';

export const CAP_RUSH_PLAYOFF_FORMULA_VERSION = 'cap-rush-playoff-formula-v1';
export const CAP_RUSH_PLAYOFF_SAMPLE_MINUTES = 180;
export const CAP_RUSH_PLAYOFF_MAX_PLAYERS = 512;

export const capRushPlayoffStatLineSchema = z.object({
  gamesPlayed: z.number().int().positive(),
  minutes: z.number().positive(),
  tsPct: z.number().min(0).max(1.5).nullable(),
  pointsPer36: z.number().nullable(),
  assistsPer36: z.number().nullable(),
  reboundsPer36: z.number().nullable(),
  turnoversPer36: z.number().nullable(),
});
export type CapRushPlayoffStatLine = z.infer<typeof capRushPlayoffStatLineSchema>;

export const capRushPlayoffAppliedSchema = z.object({
  fieldGoalPct: z.number().min(-0.03).max(0.03),
  threePointPct: z.number().min(-0.03).max(0.03),
  fieldGoalAttemptsPerGame: z.number().min(-2).max(2),
  passRate: z.number().min(-6).max(6),
  assistsPerGame: z.number().min(-1.5).max(1.5),
  offensiveReboundsPerGame: z.number().min(-0.45).max(0.45),
  defensiveReboundsPerGame: z.number().min(-1.05).max(1.05),
  turnoverRate: z.number().min(-4).max(4),
});
export type CapRushPlayoffApplied = z.infer<typeof capRushPlayoffAppliedSchema>;

export const capRushPlayoffPlayerSchema = z.object({
  instanceId: havocInstanceIdSchema,
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema,
  seasonKey: seasonKeySchema,
  weight: z.number().min(0).max(1),
  regularSeason: capRushPlayoffStatLineSchema,
  playoffs: capRushPlayoffStatLineSchema,
  applied: capRushPlayoffAppliedSchema,
});
export type CapRushPlayoffPlayer = z.infer<typeof capRushPlayoffPlayerSchema>;

export const capRushPlayoffPerformanceSchema = z.object({
  formulaVersion: z.literal(CAP_RUSH_PLAYOFF_FORMULA_VERSION),
  sampleMinutesAnchor: z.literal(CAP_RUSH_PLAYOFF_SAMPLE_MINUTES),
  players: z.array(capRushPlayoffPlayerSchema).max(CAP_RUSH_PLAYOFF_MAX_PLAYERS),
});
export type CapRushPlayoffPerformance = z.infer<typeof capRushPlayoffPerformanceSchema>;
