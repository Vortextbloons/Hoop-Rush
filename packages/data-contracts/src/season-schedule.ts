import { z } from 'zod';
import { franchiseIdSchema, seasonGameIdSchema, seedSchema } from './ids.ts';
import { SEASON_GAME_COUNT, SEASON_LEAGUE_VERSION, SEASON_ROUND_COUNT, SEASON_SCHEDULE_FORMULA_VERSION, SEASON_SCHEDULE_VERSION, } from './season-versions.ts';
export const seasonScheduleGameSchema = z.object({
    gameId: seasonGameIdSchema,
    round: z.number().int().min(1).max(SEASON_ROUND_COUNT),
    homeFranchiseId: franchiseIdSchema,
    awayFranchiseId: franchiseIdSchema,
});
export type SeasonScheduleGame = z.infer<typeof seasonScheduleGameSchema>;
export const seasonScheduleSchema = z.object({
    schemaVersion: z.literal(1),
    scheduleVersion: z.literal(SEASON_SCHEDULE_VERSION),
    formulaVersion: z.literal(SEASON_SCHEDULE_FORMULA_VERSION),
    leagueVersion: z.literal(SEASON_LEAGUE_VERSION),
    generationSeed: seedSchema,
    rounds: z.literal(SEASON_ROUND_COUNT),
    games: z.array(seasonScheduleGameSchema).length(SEASON_GAME_COUNT),
});
export type SeasonSchedule = z.infer<typeof seasonScheduleSchema>;
