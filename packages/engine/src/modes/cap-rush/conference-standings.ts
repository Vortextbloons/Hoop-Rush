import type {
  CapRushConference,
  CapRushConferenceStandings,
  CapRushConferenceTable,
  CapRushLeagueStandingsEntry,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_CONFERENCE_GAMES,
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS,
  CAP_RUSH_CONFERENCE_SIZE,
  CAP_RUSH_LEAGUE_VERSION,
  CAP_RUSH_TAKEOVER_TEAMS,
  capRushAlignmentOf,
  capRushConferenceStandingsSchema,
  capRushDivisionSchema,
} from '@hoop-rush/data-contracts';

export interface CapRushStandingsTeam {
  readonly teamId: string;
  readonly displayName: string;
  readonly isUserTeam: boolean;
}

export interface CapRushStandingsGame {
  readonly gameId: string;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly homePoints: number;
  readonly awayPoints: number;
}

interface TeamTotals {
  readonly teamId: string;
  readonly displayName: string;
  readonly isUserTeam: boolean;
  readonly conference: CapRushConference;
  readonly division: CapRushLeagueStandingsEntry['division'];
  wins: number;
  losses: number;
  conferenceWins: number;
  conferenceLosses: number;
  pointsFor: number;
  pointsAgainst: number;
  headToHead: Map<string, { wins: number; losses: number }>;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function ratioCompare(
  left: { wins: number; games: number },
  right: { wins: number; games: number },
): number {
  if (left.games === 0 || right.games === 0) {
    if (left.games === 0 && right.games === 0) return 0;
    return left.games === 0 ? 1 : -1;
  }
  const difference = right.wins * left.games - left.wins * right.games;
  return difference === 0 ? 0 : difference > 0 ? 1 : -1;
}

type Criterion = 'head-to-head' | 'conference' | 'point-differential' | 'points-for' | 'team-id';
const CRITERIA: readonly Criterion[] = [
  'head-to-head',
  'conference',
  'point-differential',
  'points-for',
  'team-id',
];

function partitionOnCriterion(
  teams: readonly TeamTotals[],
  criterion: Criterion,
): { sorted: TeamTotals[]; groups: TeamTotals[][] } {
  if (criterion === 'team-id') {
    const sorted = [...teams].sort((left, right) => compareCodeUnits(left.teamId, right.teamId));
    return { sorted, groups: sorted.map((team) => [team]) };
  }
  const valueOf = (
    team: TeamTotals,
    other: TeamTotals,
  ): number | { wins: number; games: number } => {
    switch (criterion) {
      case 'head-to-head': {
        const record = team.headToHead.get(other.teamId) ?? { wins: 0, losses: 0 };
        return { wins: record.wins, games: record.wins + record.losses };
      }
      case 'conference':
        return { wins: team.conferenceWins, games: team.conferenceWins + team.conferenceLosses };
      case 'point-differential':
        return team.pointsFor - team.pointsAgainst;
      case 'points-for':
        return team.pointsFor;
    }
  };
  const compare = (left: TeamTotals, right: TeamTotals): number => {
    const a = valueOf(left, right);
    const b = valueOf(right, left);
    if (typeof a === 'number' && typeof b === 'number') {
      return b - a;
    }
    if (typeof a === 'object' && typeof b === 'object') {
      return ratioCompare(a, b);
    }
    return 0;
  };
  const sorted = [...teams].sort(compare);
  const groups: TeamTotals[][] = [];
  for (const team of sorted) {
    const current = groups[groups.length - 1];
    const previous = current?.[0];
    if (current !== undefined && previous !== undefined && compare(previous, team) === 0) {
      current.push(team);
    } else {
      groups.push([team]);
    }
  }
  return { sorted, groups };
}

function resolveTieGroup(teams: readonly TeamTotals[], index: number): TeamTotals[] {
  if (teams.length <= 1) return [...teams];
  if (index >= CRITERIA.length) {
    return [...teams].sort((left, right) => compareCodeUnits(left.teamId, right.teamId));
  }
  const criterion = CRITERIA[index];
  if (criterion === undefined) return [...teams];
  const { sorted, groups } = partitionOnCriterion(teams, criterion);
  if (groups.length === 1) return resolveTieGroup(sorted, index + 1);
  return groups.flatMap((group) => resolveTieGroup(group, index + 1));
}

function cutoffTieBreakOf(
  inside: TeamTotals,
  outside: TeamTotals,
): 'wins' | 'head-to-head' | 'conference' | 'point-differential' | 'points-for' | 'team-id' {
  if (inside.wins !== outside.wins) return 'wins';
  const headToHead = inside.headToHead.get(outside.teamId) ?? { wins: 0, losses: 0 };
  const reverse = outside.headToHead.get(inside.teamId) ?? { wins: 0, losses: 0 };
  if (
    ratioCompare(
      { wins: headToHead.wins, games: headToHead.wins + headToHead.losses },
      { wins: reverse.wins, games: reverse.wins + reverse.losses },
    ) !== 0
  ) {
    return 'head-to-head';
  }
  if (
    ratioCompare(
      { wins: inside.conferenceWins, games: inside.conferenceWins + inside.conferenceLosses },
      { wins: outside.conferenceWins, games: outside.conferenceWins + outside.conferenceLosses },
    ) !== 0
  ) {
    return 'conference';
  }
  if (inside.pointsFor - inside.pointsAgainst !== outside.pointsFor - outside.pointsAgainst) {
    return 'point-differential';
  }
  if (inside.pointsFor !== outside.pointsFor) return 'points-for';
  return 'team-id';
}

export function buildCapRushConferenceStandings(input: {
  readonly teams: readonly CapRushStandingsTeam[];
  readonly games: readonly CapRushStandingsGame[];
}): CapRushConferenceStandings {
  if (input.teams.length !== CAP_RUSH_TAKEOVER_TEAMS) {
    throw new Error(
      `cap rush standings: expected ${String(CAP_RUSH_TAKEOVER_TEAMS)} teams (got ${String(input.teams.length)})`,
    );
  }
  const totals = new Map<string, TeamTotals>();
  for (const team of input.teams) {
    const alignment = capRushAlignmentOf(team.teamId);
    totals.set(team.teamId, {
      teamId: team.teamId,
      displayName: team.displayName,
      isUserTeam: team.isUserTeam,
      conference: alignment.conference,
      division: capRushDivisionSchema.parse(alignment.division),
      wins: 0,
      losses: 0,
      conferenceWins: 0,
      conferenceLosses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      headToHead: new Map(),
    });
  }
  if (input.games.length !== CAP_RUSH_CONFERENCE_GAMES) {
    throw new Error(
      `cap rush standings: expected ${String(CAP_RUSH_CONFERENCE_GAMES)} games (got ${String(input.games.length)})`,
    );
  }
  const seen = new Set<string>();
  for (const game of input.games) {
    if (game.homeTeamId === game.awayTeamId) {
      throw new Error('cap rush standings: a team cannot play itself');
    }
    if (game.homePoints === game.awayPoints) {
      throw new Error('cap rush standings: a completed game never ends tied');
    }
    const home = totals.get(game.homeTeamId);
    const away = totals.get(game.awayTeamId);
    if (home === undefined || away === undefined) {
      throw new Error('cap rush standings: a game references an unknown team');
    }
    const identity = game.gameId;
    if (seen.has(identity)) {
      throw new Error(`cap rush standings: duplicate game ${identity}`);
    }
    seen.add(identity);
    const homeWon = game.homePoints > game.awayPoints;
    home.wins += homeWon ? 1 : 0;
    home.losses += homeWon ? 0 : 1;
    away.wins += homeWon ? 0 : 1;
    away.losses += homeWon ? 1 : 0;
    home.pointsFor += game.homePoints;
    home.pointsAgainst += game.awayPoints;
    away.pointsFor += game.awayPoints;
    away.pointsAgainst += game.homePoints;
    if (home.conference === away.conference) {
      home.conferenceWins += homeWon ? 1 : 0;
      home.conferenceLosses += homeWon ? 0 : 1;
      away.conferenceWins += homeWon ? 0 : 1;
      away.conferenceLosses += homeWon ? 1 : 0;
    }
    const winnerTeam = homeWon ? home : away;
    const loserTeam = homeWon ? away : home;
    const winnerRecord = winnerTeam.headToHead.get(loserTeam.teamId) ?? { wins: 0, losses: 0 };
    winnerRecord.wins += 1;
    winnerTeam.headToHead.set(loserTeam.teamId, winnerRecord);
    const loserRecord = loserTeam.headToHead.get(winnerTeam.teamId) ?? { wins: 0, losses: 0 };
    loserRecord.losses += 1;
    loserTeam.headToHead.set(winnerTeam.teamId, loserRecord);
  }
  for (const team of totals.values()) {
    if (team.wins + team.losses !== CAP_RUSH_CONFERENCE_GAMES_PER_TEAM) {
      throw new Error(
        `cap rush standings: ${team.teamId} played ${String(team.wins + team.losses)} games`,
      );
    }
  }

  const tables: Record<CapRushConference, CapRushConferenceTable> = {
    west: buildTable('west', totals),
    east: buildTable('east', totals),
  };
  const qualifiedTeamIds = [...tables.west.entries, ...tables.east.entries]
    .filter((entry) => entry.qualified)
    .map((entry) => entry.teamId);
  return capRushConferenceStandingsSchema.parse({
    version: CAP_RUSH_LEAGUE_VERSION,
    format: 'conference',
    west: tables.west,
    east: tables.east,
    qualifiedTeamIds,
    games: input.games.map((game) => ({
      gameId: game.gameId,
      homeTeamId: game.homeTeamId,
      awayTeamId: game.awayTeamId,
      homePoints: game.homePoints,
      awayPoints: game.awayPoints,
    })),
  });
}

function buildTable(
  conference: CapRushConference,
  totals: ReadonlyMap<string, TeamTotals>,
): CapRushConferenceTable {
  const teams = [...totals.values()].filter((team) => team.conference === conference);
  if (teams.length !== CAP_RUSH_CONFERENCE_SIZE) {
    throw new Error(`cap rush standings: ${conference} holds ${String(teams.length)} teams`);
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
    ordered.push(...resolveTieGroup(group, 0));
  }
  const entries: CapRushLeagueStandingsEntry[] = ordered.map((team, index) => ({
    teamId: team.teamId,
    displayName: team.displayName,
    isUserTeam: team.isUserTeam,
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
  const cutoff = entries[CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS - 1];
  if (cutoff === undefined) throw new Error('cap rush standings: missing conference cutoff');
  const inside = ordered[CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS - 1];
  const outside = ordered[CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS];
  const tieBreak =
    inside === undefined || outside === undefined ? 'wins' : cutoffTieBreakOf(inside, outside);
  return {
    conference,
    entries,
    cutoff: {
      conference,
      seed: CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS,
      teamId: cutoff.teamId,
      wins: cutoff.wins,
      losses: cutoff.losses,
      pointDifferential: cutoff.pointDifferential,
      pointsFor: cutoff.pointsFor,
      tieBreak,
    },
  };
}

export function capRushFinalsHomeCourtOf(input: {
  readonly leftTeamId: string;
  readonly rightTeamId: string;
  readonly standings: CapRushConferenceStandings;
  readonly games: readonly CapRushStandingsGame[];
}): string {
  const entries = [...input.standings.west.entries, ...input.standings.east.entries];
  const left = entries.find((entry) => entry.teamId === input.leftTeamId);
  const right = entries.find((entry) => entry.teamId === input.rightTeamId);
  if (left === undefined || right === undefined) {
    throw new Error('cap rush standings: Finals team is missing from the standings');
  }
  if (left.wins !== right.wins) return left.wins > right.wins ? left.teamId : right.teamId;
  let leftWins = 0;
  let rightWins = 0;
  for (const game of input.games) {
    const involvesBoth =
      (game.homeTeamId === left.teamId && game.awayTeamId === right.teamId) ||
      (game.homeTeamId === right.teamId && game.awayTeamId === left.teamId);
    if (!involvesBoth) continue;
    const winner = game.homePoints > game.awayPoints ? game.homeTeamId : game.awayTeamId;
    if (winner === left.teamId) leftWins += 1;
    else rightWins += 1;
  }
  if (leftWins !== rightWins) return leftWins > rightWins ? left.teamId : right.teamId;
  if (left.pointDifferential !== right.pointDifferential) {
    return left.pointDifferential > right.pointDifferential ? left.teamId : right.teamId;
  }
  if (left.pointsFor !== right.pointsFor) {
    return left.pointsFor > right.pointsFor ? left.teamId : right.teamId;
  }
  return compareCodeUnits(left.teamId, right.teamId) <= 0 ? left.teamId : right.teamId;
}
