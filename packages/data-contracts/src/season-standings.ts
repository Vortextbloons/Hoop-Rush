import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { SEASON_STANDINGS_VERSION, SEASON_TEAM_COUNT } from './season-versions.ts';
export const seasonHeadToHeadRecordSchema = z.object({
    franchiseId: franchiseIdSchema,
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
});
export type SeasonHeadToHeadRecord = z.infer<typeof seasonHeadToHeadRecordSchema>;
export const seasonStandingsRowSchema = z.object({
    franchiseId: franchiseIdSchema,
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    gamesPlayed: z.number().int().nonnegative(),
    homeWins: z.number().int().nonnegative(),
    homeLosses: z.number().int().nonnegative(),
    awayWins: z.number().int().nonnegative(),
    awayLosses: z.number().int().nonnegative(),
    conferenceWins: z.number().int().nonnegative(),
    conferenceLosses: z.number().int().nonnegative(),
    divisionWins: z.number().int().nonnegative(),
    divisionLosses: z.number().int().nonnegative(),
    pointsFor: z.number().int().nonnegative(),
    pointsAgainst: z.number().int().nonnegative(),
    headToHead: z.array(seasonHeadToHeadRecordSchema),
});
export type SeasonStandingsRow = z.infer<typeof seasonStandingsRowSchema>;
export const seasonStandingsSchema = z.object({
    schemaVersion: z.literal(1),
    standingsVersion: z.literal(SEASON_STANDINGS_VERSION),
    rows: z.array(seasonStandingsRowSchema).length(SEASON_TEAM_COUNT),
});
export type SeasonStandings = z.infer<typeof seasonStandingsSchema>;
