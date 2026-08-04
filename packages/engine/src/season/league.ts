import type { ConferenceId, DivisionId, SeasonLeague } from '@hoop-rush/data-contracts';

/**
 * League membership helpers for the frozen Season Run league manifest
 * (spec/2.0/02). Conference and division affiliation always comes from the
 * league manifest; nothing infers alignment from names or abbreviations.
 * Pure TypeScript: no Svelte, persistence, worker, or network code.
 */

function teamOf(league: SeasonLeague, franchiseId: string): SeasonLeague['teams'][number] {
  const team = league.teams.find((entry) => entry.franchiseId === franchiseId);
  if (!team) {
    throw new Error(`franchise ${franchiseId} is not part of the league`);
  }
  return team;
}

/** Conference of a franchise per the league manifest. */
export function conferenceOf(league: SeasonLeague, franchiseId: string): ConferenceId {
  return teamOf(league, franchiseId).conference;
}

/** Division of a franchise per the league manifest. */
export function divisionOf(league: SeasonLeague, franchiseId: string): DivisionId {
  return teamOf(league, franchiseId).division;
}

/** Every franchise id in a conference, in league-manifest order. */
export function franchisesInConference(league: SeasonLeague, conference: ConferenceId): string[] {
  return league.teams
    .filter((team) => team.conference === conference)
    .map((team) => team.franchiseId);
}

/** The four same-division opponents of a franchise. */
export function divisionOpponentsOf(league: SeasonLeague, franchiseId: string): string[] {
  const team = teamOf(league, franchiseId);
  return league.teams
    .filter((entry) => entry.division === team.division && entry.franchiseId !== franchiseId)
    .map((entry) => entry.franchiseId);
}

/** The ten same-conference, different-division opponents of a franchise. */
export function conferenceNonDivisionOpponentsOf(
  league: SeasonLeague,
  franchiseId: string,
): string[] {
  const team = teamOf(league, franchiseId);
  return league.teams
    .filter((entry) => entry.conference === team.conference && entry.division !== team.division)
    .map((entry) => entry.franchiseId);
}

/** The fifteen opposite-conference opponents of a franchise. */
export function oppositeConferenceOpponentsOf(league: SeasonLeague, franchiseId: string): string[] {
  const team = teamOf(league, franchiseId);
  return league.teams
    .filter((entry) => entry.conference !== team.conference)
    .map((entry) => entry.franchiseId);
}
