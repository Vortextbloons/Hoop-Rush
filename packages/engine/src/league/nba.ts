import {
  CAP_RUSH_CONFERENCE_DIVISIONS,
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_DIVISION_TEAMS,
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  CAP_RUSH_TAKEOVER_TEAMS,
  capRushAlignmentOf,
  capRushFranchiseAssignmentSeed,
  capRushLeagueGameId,
  capRushScheduleSeed,
  type CapRushConference,
  type CapRushDivision,
} from '@hoop-rush/data-contracts';
import type { LeagueScheduleRules } from './schedule.ts';

export const NBA_LEAGUE_RULES: LeagueScheduleRules<CapRushConference, CapRushDivision> = {
  label: 'cap rush',
  teamCount: CAP_RUSH_TAKEOVER_TEAMS,
  teamIds: CAP_RUSH_FRANCHISE_ALIGNMENT.map((entry) => entry.franchiseId),
  gamesPerTeam: CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  divisionGamesPerTeam: 16,
  conferenceGamesPerTeam: 36,
  conferences: ['east', 'west'],
  divisions: CAP_RUSH_DIVISION_TEAMS,
  conferenceDivisions: CAP_RUSH_CONFERENCE_DIVISIONS,
  oppositeConferencePairs: [['west', 'east']],
  alignmentOf: capRushAlignmentOf,
  gameIdOf: capRushLeagueGameId,
  scheduleSeed: capRushScheduleSeed,
  assignmentSeed: capRushFranchiseAssignmentSeed,
};
