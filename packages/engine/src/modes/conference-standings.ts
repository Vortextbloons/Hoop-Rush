import {
  CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS,
  capRushAlignmentOf,
  type CapRushConference,
  type CapRushDivision,
} from '@hoop-rush/data-contracts';
import {
  conferenceStandingOf as conferenceStandingOfLeague,
  createTeamTotals as createTeamTotalsLeague,
  rankConferenceTeams,
  recordHeadToHead,
  recordPlayed,
  type TeamTotals as LeagueTeamTotals,
} from '../league/standings.ts';

export type TeamTotals = LeagueTeamTotals<CapRushConference, CapRushDivision>;

export function createTeamTotals(team: { teamId: string; displayName: string }): TeamTotals {
  return createTeamTotalsLeague(team, capRushAlignmentOf(team.teamId));
}

export function conferenceStandingOf(team: TeamTotals, seed: number) {
  return conferenceStandingOfLeague(team, seed, CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS);
}

export { rankConferenceTeams, recordHeadToHead, recordPlayed };
