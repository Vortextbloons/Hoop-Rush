import { z } from 'zod';
import { playerIdSchema, seasonKeySchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';

export const CAP_RUSH_PLAYOFF_FORMULA_VERSION = 'cap-rush-playoff-formula-v1';
export const CAP_RUSH_PLAYOFF_SAMPLE_MINUTES = 180;
export const CAP_RUSH_PLAYOFF_MAX_PLAYERS = 320;

export const CAP_RUSH_PLAYOFF_CAPS = {
  fieldGoalPct: 0.04,
  threePointPct: 0.04,
  fieldGoalAttemptsPerGame: 2.5,
  passRate: 6,
  assistsPerGame: 1.8,
  offensiveReboundsPerGame: 0.66,
  defensiveReboundsPerGame: 1.54,
  turnoverRate: 4,
} as const;

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

export const capRushPlayoffObservedSchema = z.object({
  tsPct: z.number().nullable(),
  pointsPer36: z.number().nullable(),
  assistsPer36: z.number().nullable(),
  reboundsPer36: z.number().nullable(),
  turnoversPer36: z.number().nullable(),
});
export type CapRushPlayoffObserved = z.infer<typeof capRushPlayoffObservedSchema>;

export const capRushPlayoffAppliedSchema = z.object({
  fieldGoalPct: z
    .number()
    .min(-CAP_RUSH_PLAYOFF_CAPS.fieldGoalPct)
    .max(CAP_RUSH_PLAYOFF_CAPS.fieldGoalPct),
  threePointPct: z
    .number()
    .min(-CAP_RUSH_PLAYOFF_CAPS.threePointPct)
    .max(CAP_RUSH_PLAYOFF_CAPS.threePointPct),
  fieldGoalAttemptsPerGame: z
    .number()
    .min(-CAP_RUSH_PLAYOFF_CAPS.fieldGoalAttemptsPerGame)
    .max(CAP_RUSH_PLAYOFF_CAPS.fieldGoalAttemptsPerGame),
  passRate: z.number().min(-CAP_RUSH_PLAYOFF_CAPS.passRate).max(CAP_RUSH_PLAYOFF_CAPS.passRate),
  assistsPerGame: z
    .number()
    .min(-CAP_RUSH_PLAYOFF_CAPS.assistsPerGame)
    .max(CAP_RUSH_PLAYOFF_CAPS.assistsPerGame),
  offensiveReboundsPerGame: z
    .number()
    .min(-CAP_RUSH_PLAYOFF_CAPS.offensiveReboundsPerGame)
    .max(CAP_RUSH_PLAYOFF_CAPS.offensiveReboundsPerGame),
  defensiveReboundsPerGame: z
    .number()
    .min(-CAP_RUSH_PLAYOFF_CAPS.defensiveReboundsPerGame)
    .max(CAP_RUSH_PLAYOFF_CAPS.defensiveReboundsPerGame),
  turnoverRate: z
    .number()
    .min(-CAP_RUSH_PLAYOFF_CAPS.turnoverRate)
    .max(CAP_RUSH_PLAYOFF_CAPS.turnoverRate),
});
export type CapRushPlayoffApplied = z.infer<typeof capRushPlayoffAppliedSchema>;

export const capRushPlayoffPlayerSchema = z.object({
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema,
  seasonKey: seasonKeySchema,
  weight: z.number().min(0).max(1),
  observed: capRushPlayoffObservedSchema,
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
