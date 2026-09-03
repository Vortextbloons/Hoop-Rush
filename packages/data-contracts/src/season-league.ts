import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { SEASON_LEAGUE_VERSION, SEASON_TEAM_COUNT } from './season-versions.ts';
export const conferenceIdSchema = z.enum(['east', 'west']);
export type ConferenceId = z.infer<typeof conferenceIdSchema>;
export const divisionIdSchema = z.enum([
    'atlantic',
    'central',
    'southeast',
    'northwest',
    'pacific',
    'southwest',
]);
export type DivisionId = z.infer<typeof divisionIdSchema>;
export const seasonControlSchema = z.enum(['human', 'ai']);
export type SeasonControl = z.infer<typeof seasonControlSchema>;
export const seasonTeamSchema = z.object({
    franchiseId: franchiseIdSchema,
    control: seasonControlSchema,
    conference: conferenceIdSchema,
    division: divisionIdSchema,
});
export type SeasonTeam = z.infer<typeof seasonTeamSchema>;
export const seasonLeagueSchema = z.object({
    schemaVersion: z.literal(1),
    leagueVersion: z.literal(SEASON_LEAGUE_VERSION),
    teams: z.array(seasonTeamSchema).length(SEASON_TEAM_COUNT),
});
export type SeasonLeague = z.infer<typeof seasonLeagueSchema>;
