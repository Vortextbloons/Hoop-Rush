import type {
  CapRushConference,
  CapRushDivision,
  CapRushFranchiseAssignment,
  CapRushLeagueScheduleEntry,
  OpponentBracketCore,
  Seed,
} from '@hoop-rush/data-contracts';
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
} from '@hoop-rush/data-contracts';
import {
  assignLeagueFranchise,
  buildLeagueSchedule,
  leagueFieldOf,
  leagueUserScheduleOf,
  validateLeagueField,
  validateLeagueSchedule,
  type LeagueFieldTeam,
  type LeagueScheduleRules,
} from '../../league/schedule.ts';

export type CapRushLeagueField = LeagueFieldTeam;

const CAP_RUSH_LEAGUE_RULES: LeagueScheduleRules<CapRushConference, CapRushDivision> = {
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

export function capRushAssignFranchise(input: {
  readonly runSeed: Seed;
  readonly field: readonly CapRushLeagueField[];
}): CapRushFranchiseAssignment {
  return assignLeagueFranchise({ ...input, rules: CAP_RUSH_LEAGUE_RULES });
}

export function capRushValidateLeagueField(field: readonly CapRushLeagueField[]): void {
  validateLeagueField(field, CAP_RUSH_LEAGUE_RULES);
}

export function capRushLeagueFieldOf(bracket: OpponentBracketCore): CapRushLeagueField[] {
  return leagueFieldOf(bracket, CAP_RUSH_LEAGUE_RULES);
}

export interface CapRushLeagueSchedule {
  readonly teams: readonly CapRushLeagueField[];
  readonly games: readonly CapRushLeagueScheduleEntry[];
}

export function buildCapRushLeagueSchedule(input: {
  readonly runSeed: Seed;
  readonly field: readonly CapRushLeagueField[];
}): CapRushLeagueSchedule {
  return buildLeagueSchedule({ ...input, rules: CAP_RUSH_LEAGUE_RULES });
}

export function validateCapRushLeagueSchedule(
  games: readonly CapRushLeagueScheduleEntry[],
  field: readonly CapRushLeagueField[],
): string[] {
  return validateLeagueSchedule(games, field, CAP_RUSH_LEAGUE_RULES);
}

export function capRushUserScheduleOf(input: {
  readonly games: readonly CapRushLeagueScheduleEntry[];
  readonly userTeamId: string;
}): Array<{ gameNumber: number; opponentId: string; humanHome: boolean }> {
  return leagueUserScheduleOf({
    ...input,
    gamesPerTeam: CAP_RUSH_LEAGUE_RULES.gamesPerTeam,
    ...(CAP_RUSH_LEAGUE_RULES.label === undefined ? {} : { label: CAP_RUSH_LEAGUE_RULES.label }),
  });
}
