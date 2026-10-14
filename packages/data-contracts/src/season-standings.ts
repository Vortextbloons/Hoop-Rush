import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import type { SeasonLeague } from './season-league.ts';
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

export function createEmptyStandingsRow(
  franchiseId: string,
  franchiseIds: readonly string[],
): SeasonStandingsRow {
  return {
    franchiseId: franchiseIdSchema.parse(franchiseId),
    wins: 0,
    losses: 0,
    gamesPlayed: 0,
    homeWins: 0,
    homeLosses: 0,
    awayWins: 0,
    awayLosses: 0,
    conferenceWins: 0,
    conferenceLosses: 0,
    divisionWins: 0,
    divisionLosses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    headToHead: franchiseIds
      .filter((other) => other !== franchiseId)
      .map((other) => ({ franchiseId: franchiseIdSchema.parse(other), wins: 0, losses: 0 })),
  };
}

export function createEmptyStandings(league: SeasonLeague): SeasonStandings {
  const franchiseIds = league.teams.map((team) => team.franchiseId);
  return {
    schemaVersion: 1,
    standingsVersion: SEASON_STANDINGS_VERSION,
    rows: franchiseIds.map((franchiseId) => createEmptyStandingsRow(franchiseId, franchiseIds)),
  };
}
