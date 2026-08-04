import { z } from 'zod';
import { franchiseIdSchema } from './ids.js';
import { SEASON_LEAGUE_VERSION, SEASON_TEAM_COUNT } from './season-versions.js';

/**
 * Season Run league and franchise control (spec/2.0/02). A Season Run
 * contains exactly 30 teams mapped to the 30 current NBA franchise
 * identities; conferences and divisions follow this versioned manifest.
 * Franchise identity controls branding, schedule slot, conference, division,
 * and home designation; it never restricts player eligibility.
 */

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

/** Control changes how commands are submitted, never basketball rules. */
export const seasonControlSchema = z.enum(['human', 'ai']);
export type SeasonControl = z.infer<typeof seasonControlSchema>;

export const seasonTeamSchema = z.object({
  franchiseId: franchiseIdSchema,
  control: seasonControlSchema,
  conference: conferenceIdSchema,
  division: divisionIdSchema,
});
export type SeasonTeam = z.infer<typeof seasonTeamSchema>;

/** The frozen league manifest: exactly 30 teams in the accepted alignment. */
export const seasonLeagueSchema = z.object({
  schemaVersion: z.literal(1),
  leagueVersion: z.literal(SEASON_LEAGUE_VERSION),
  teams: z.array(seasonTeamSchema).length(SEASON_TEAM_COUNT),
});
export type SeasonLeague = z.infer<typeof seasonLeagueSchema>;
