import {
  CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS,
  CAP_RUSH_CONFERENCE_SIZE,
  capRushAlignmentOf,
  fullCourtSeasonScoreSchema,
  type CapRushConference,
  type CapRushDivision,
  type FullCourtSeasonScore,
} from '@hoop-rush/data-contracts';
import {
  capRushValidateLeagueField,
  type CapRushLeagueField,
} from '../cap-rush/league-schedule.ts';
import { resolveConferenceTieGroup } from '../conference-tiebreak.ts';

export interface FullCourtStandingsRow {
  readonly teamId: string;
  readonly displayName: string;
  readonly conference: CapRushConference;
  readonly division: CapRushDivision;
  readonly wins: number;
  readonly losses: number;
  readonly conferenceWins: number;
  readonly conferenceLosses: number;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
  readonly pointDifferential: number;
  readonly seed: number;
  readonly qualified: boolean;
}

export interface FullCourtStandings {
  readonly west: readonly FullCourtStandingsRow[];
  readonly east: readonly FullCourtStandingsRow[];
  readonly qualifiedTeamIds: readonly string[];
}

export interface FullCourtPlayoffSeeds {
  readonly west: readonly string[];
  readonly east: readonly string[];
}

interface HeadToHeadRecord {
  wins: number;
  losses: number;
}

interface TeamTotals {
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

function recordHeadToHead(winner: TeamTotals, loser: TeamTotals): void {
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

function recordPlayed(
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

function recordForfeit(
  home: TeamTotals,
  away: TeamTotals,
  losingSides: readonly ('home' | 'away')[],
): void {
  const homeLost = losingSides.includes('home');
  const awayLost = losingSides.includes('away');
  if (homeLost && awayLost) {
    home.losses += 1;
    away.losses += 1;
    if (home.conference === away.conference) {
      home.conferenceLosses += 1;
      away.conferenceLosses += 1;
    }
    return;
  }
  if (homeLost) {
    recordHeadToHead(away, home);
    return;
  }
  recordHeadToHead(home, away);
}

export function fullCourtStandings(
  field: readonly CapRushLeagueField[],
  scores: readonly FullCourtSeasonScore[],
): FullCourtStandings {
  capRushValidateLeagueField(field);
  const totals = new Map<string, TeamTotals>();
  for (const team of field) {
    const alignment = capRushAlignmentOf(team.teamId);
    totals.set(team.teamId, {
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
    });
  }
  const seen = new Set<string>();
  for (const raw of scores) {
    const score = fullCourtSeasonScoreSchema.parse(raw);
    if (seen.has(score.gameId)) {
      throw new Error(`Full Court standings: duplicate game ${score.gameId}`);
    }
    seen.add(score.gameId);
    const home = totals.get(score.homeTeamId);
    const away = totals.get(score.awayTeamId);
    if (home === undefined || away === undefined) {
      throw new Error(`Full Court standings: ${score.gameId} references an unknown team`);
    }
    if (score.outcome.kind === 'played') {
      recordPlayed(home, away, score.outcome.homePoints, score.outcome.awayPoints);
    } else {
      recordForfeit(home, away, score.outcome.losingSides);
    }
  }
  const west = buildConferenceRows('west', totals);
  const east = buildConferenceRows('east', totals);
  return {
    west,
    east,
    qualifiedTeamIds: [...west, ...east].filter((row) => row.qualified).map((row) => row.teamId),
  };
}

function buildConferenceRows(
  conference: CapRushConference,
  totals: ReadonlyMap<string, TeamTotals>,
): FullCourtStandingsRow[] {
  const teams = [...totals.values()].filter((team) => team.conference === conference);
  if (teams.length !== CAP_RUSH_CONFERENCE_SIZE) {
    throw new Error(`Full Court standings: ${conference} holds ${String(teams.length)} teams`);
  }
  const byWins = new Map<number, TeamTotals[]>();
  for (const team of teams) {
    const group = byWins.get(team.wins) ?? [];
    group.push(team);
    byWins.set(team.wins, group);
  }
  const orderedWins = [...byWins.keys()].sort((left, right) => right - left);
  const ordered: TeamTotals[] = [];
  for (const wins of orderedWins) {
    const group = byWins.get(wins) ?? [];
    ordered.push(...resolveConferenceTieGroup(group, 'tied-group'));
  }
  return ordered.map((team, index) => ({
    teamId: team.teamId,
    displayName: team.displayName,
    conference,
    division: team.division,
    wins: team.wins,
    losses: team.losses,
    conferenceWins: team.conferenceWins,
    conferenceLosses: team.conferenceLosses,
    pointsFor: team.pointsFor,
    pointsAgainst: team.pointsAgainst,
    pointDifferential: team.pointsFor - team.pointsAgainst,
    seed: index + 1,
    qualified: index + 1 <= CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS,
  }));
}

export function fullCourtPlayoffSeeds(standings: FullCourtStandings): FullCourtPlayoffSeeds {
  return {
    west: standings.west.filter((row) => row.qualified).map((row) => row.teamId),
    east: standings.east.filter((row) => row.qualified).map((row) => row.teamId),
  };
}
