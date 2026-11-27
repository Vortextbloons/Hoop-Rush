import {
  CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS,
  capRushAlignmentOf,
  type CapRushConference,
  type CapRushDivision,
} from '@hoop-rush/data-contracts';
import { resolveConferenceTieGroup } from './conference-tiebreak.ts';

interface HeadToHeadRecord {
  wins: number;
  losses: number;
}

export interface TeamTotals {
  readonly teamId: string;
  readonly displayName: string;
  readonly conference: CapRushConference;
  readonly division: CapRushDivision;
  wins: number;
  losses: number;
  conferenceWins: number;
  conferenceLosses: number;
  pointsFor: number;
  pointsAgainst: number;
  readonly headToHead: Map<string, HeadToHeadRecord>;
}

export function createTeamTotals(team: { teamId: string; displayName: string }): TeamTotals {
  const alignment = capRushAlignmentOf(team.teamId);
  return {
    teamId: team.teamId,
    displayName: team.displayName,
    conference: alignment.conference,
    division: alignment.division,
    wins: 0,
    losses: 0,
    conferenceWins: 0,
    conferenceLosses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    headToHead: new Map(),
  };
}

export function recordHeadToHead(winner: TeamTotals, loser: TeamTotals): void {
  winner.wins += 1;
  loser.losses += 1;
  if (winner.conference === loser.conference) {
    winner.conferenceWins += 1;
    loser.conferenceLosses += 1;
  }
  const winnerRecord = winner.headToHead.get(loser.teamId) ?? { wins: 0, losses: 0 };
  winnerRecord.wins += 1;
  winner.headToHead.set(loser.teamId, winnerRecord);
  const loserRecord = loser.headToHead.get(winner.teamId) ?? { wins: 0, losses: 0 };
  loserRecord.losses += 1;
  loser.headToHead.set(winner.teamId, loserRecord);
}

export function recordPlayed(
  home: TeamTotals,
  away: TeamTotals,
  homePoints: number,
  awayPoints: number,
): void {
  const homeWon = homePoints > awayPoints;
  recordHeadToHead(homeWon ? home : away, homeWon ? away : home);
  home.pointsFor += homePoints;
  home.pointsAgainst += awayPoints;
  away.pointsFor += awayPoints;
  away.pointsAgainst += homePoints;
}

export function rankConferenceTeams<T extends TeamTotals>(
  teams: readonly T[],
  headToHead: Parameters<typeof resolveConferenceTieGroup>[1],
): T[] {
  const byWins = new Map<number, T[]>();
  for (const team of teams) {
    const group = byWins.get(team.wins) ?? [];
    group.push(team);
    byWins.set(team.wins, group);
  }
  const orderedWins = [...byWins.keys()].sort((left, right) => right - left);
  const ordered: T[] = [];
  for (const wins of orderedWins) {
    const group = byWins.get(wins) ?? [];
    ordered.push(...resolveConferenceTieGroup(group, headToHead));
  }
  return ordered;
}

export function conferenceStandingOf(team: TeamTotals, seed: number) {
  return {
    teamId: team.teamId,
    displayName: team.displayName,
    conference: team.conference,
    division: team.division,
    wins: team.wins,
    losses: team.losses,
    conferenceWins: team.conferenceWins,
    conferenceLosses: team.conferenceLosses,
    pointsFor: team.pointsFor,
    pointsAgainst: team.pointsAgainst,
    pointDifferential: team.pointsFor - team.pointsAgainst,
    seed,
    qualified: seed <= CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS,
  };
}
