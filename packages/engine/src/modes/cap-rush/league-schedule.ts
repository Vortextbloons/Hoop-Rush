import type {
  CapRushFranchiseAssignment,
  CapRushLeagueScheduleEntry,
  OpponentBracketCore,
  Seed,
} from '@hoop-rush/data-contracts';
import { NBA_LEAGUE_RULES } from '../../league/nba.ts';
import {
  assignLeagueFranchise,
  buildLeagueSchedule,
  leagueFieldOf,
  leagueUserScheduleOf,
  validateLeagueField,
  validateLeagueSchedule,
  type LeagueFieldTeam,
} from '../../league/schedule.ts';

export type CapRushLeagueField = LeagueFieldTeam;

const CAP_RUSH_LEAGUE_RULES = { ...NBA_LEAGUE_RULES, label: 'cap rush' };

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
    label: CAP_RUSH_LEAGUE_RULES.label,
  });
}
