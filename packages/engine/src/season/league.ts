import type { ConferenceId, DivisionId, SeasonLeague } from '@hoop-rush/data-contracts';
function teamOf(league: SeasonLeague, franchiseId: string): SeasonLeague['teams'][number] {
  const team = league.teams.find((entry) => entry.franchiseId === franchiseId);
  if (!team) {
    throw new Error(`franchise ${franchiseId} is not part of the league`);
  }
  return team;
}
export function conferenceOf(league: SeasonLeague, franchiseId: string): ConferenceId {
  return teamOf(league, franchiseId).conference;
}
export function divisionOf(league: SeasonLeague, franchiseId: string): DivisionId {
  return teamOf(league, franchiseId).division;
}
export function franchisesInConference(league: SeasonLeague, conference: ConferenceId): string[] {
  return league.teams
    .filter((team) => team.conference === conference)
    .map((team) => team.franchiseId);
}
export function divisionOpponentsOf(league: SeasonLeague, franchiseId: string): string[] {
  const team = teamOf(league, franchiseId);
  return league.teams
    .filter((entry) => entry.division === team.division && entry.franchiseId !== franchiseId)
    .map((entry) => entry.franchiseId);
}
export function conferenceNonDivisionOpponentsOf(
  league: SeasonLeague,
  franchiseId: string,
): string[] {
  const team = teamOf(league, franchiseId);
  return league.teams
    .filter((entry) => entry.conference === team.conference && entry.division !== team.division)
    .map((entry) => entry.franchiseId);
}
export function oppositeConferenceOpponentsOf(league: SeasonLeague, franchiseId: string): string[] {
  const team = teamOf(league, franchiseId);
  return league.teams
    .filter((entry) => entry.conference !== team.conference)
    .map((entry) => entry.franchiseId);
}
