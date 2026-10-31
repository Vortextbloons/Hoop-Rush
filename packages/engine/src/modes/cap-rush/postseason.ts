import type {
  CapRushFinalsMvp,
  CapRushLeagueResult,
  CapRushLockedInputs,
  CapRushPlayoffGamePlan,
  CapRushPlayoffGameSummary,
  CapRushPlayoffSeries,
  CapRushLegacyPostseason,
  CapRushPostseasonStandings,
  CapRushStandingsEntry,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_LEAGUE_GAMES,
  CAP_RUSH_LEAGUE_GAMES_PER_TEAM,
  CAP_RUSH_LEAGUE_TEAMS,
  CAP_RUSH_PLAYOFF_ROUNDS,
  CAP_RUSH_PLAYOFF_TEAMS,
  CAP_RUSH_SERIES_WINS,
  CAP_RUSH_USER_TEAM_ID,
  capRushPlayoffSeriesId,
  capRushRoundName,
} from '@hoop-rush/data-contracts';
import { capRushFinalsMvpOf, capRushNextPlayoffGamePlan } from './playoff-shared.ts';

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface CapRushStandingsInput {
  teamId: string;
  displayName: string;
  isUserTeam: boolean;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

export function capRushRankStandings(
  teams: readonly CapRushStandingsInput[],
): CapRushStandingsEntry[] {
  const ordered = [...teams].sort((left, right) => {
    if (right.wins !== left.wins) return right.wins - left.wins;
    const leftDiff = left.pointsFor - left.pointsAgainst;
    const rightDiff = right.pointsFor - right.pointsAgainst;
    if (rightDiff !== leftDiff) return rightDiff - leftDiff;
    if (right.pointsFor !== left.pointsFor) return right.pointsFor - left.pointsFor;
    return compareCodeUnits(left.teamId, right.teamId);
  });
  return ordered.map((team, index) => ({
    teamId: team.teamId,
    displayName: team.displayName,
    isUserTeam: team.isUserTeam,
    wins: team.wins,
    losses: team.losses,
    pointsFor: team.pointsFor,
    pointsAgainst: team.pointsAgainst,
    pointDifferential: team.pointsFor - team.pointsAgainst,
    seed: index + 1,
    qualified: index < CAP_RUSH_PLAYOFF_TEAMS,
  }));
}

function assertLeagueAccounting(input: {
  readonly entries: readonly CapRushStandingsEntry[];
  readonly league: CapRushLeagueResult;
}): void {
  if (input.entries.length !== CAP_RUSH_LEAGUE_TEAMS) {
    throw new Error(
      `cap rush standings: expected ${String(CAP_RUSH_LEAGUE_TEAMS)} teams (got ${String(input.entries.length)})`,
    );
  }
  let wins = 0;
  let losses = 0;
  for (const entry of input.entries) {
    if (entry.wins + entry.losses !== CAP_RUSH_LEAGUE_GAMES_PER_TEAM) {
      throw new Error(
        `cap rush standings: ${entry.teamId} played ${String(entry.wins + entry.losses)} games`,
      );
    }
    wins += entry.wins;
    losses += entry.losses;
  }
  if (wins !== CAP_RUSH_LEAGUE_GAMES || losses !== CAP_RUSH_LEAGUE_GAMES) {
    throw new Error(
      `cap rush standings: league wins/losses must total ${String(CAP_RUSH_LEAGUE_GAMES)} (got ${String(wins)}/${String(losses)})`,
    );
  }
  if (input.league.league.gamesSimulated !== CAP_RUSH_LEAGUE_GAMES - 82) {
    throw new Error(
      `cap rush standings: background league must simulate ${String(CAP_RUSH_LEAGUE_GAMES - 82)} games (got ${String(input.league.league.gamesSimulated)})`,
    );
  }
}

function cutoffTieBreakOf(
  entries: readonly CapRushStandingsEntry[],
): CapRushPostseasonStandings['cutoff']['tieBreak'] {
  const inside = entries[CAP_RUSH_PLAYOFF_TEAMS - 1];
  const outside = entries[CAP_RUSH_PLAYOFF_TEAMS];
  if (inside === undefined || outside === undefined) return 'wins';
  if (inside.wins !== outside.wins) return 'wins';
  if (inside.pointDifferential !== outside.pointDifferential) return 'point-differential';
  if (inside.pointsFor !== outside.pointsFor) return 'points-for';
  return 'team-id';
}

export function buildCapRushPostseasonStandings(input: {
  readonly locked: CapRushLockedInputs;
  readonly league: CapRushLeagueResult;
  readonly userGames: readonly {
    readonly opponentId: string;
    readonly humanPoints: number;
    readonly opponentPoints: number;
    readonly won: boolean;
  }[];
}): CapRushPostseasonStandings {
  const opponentIdByTeamId = new Map<string, string>();
  const teamById = new Map<string, CapRushStandingsInput>();
  for (const opponent of input.locked.opponents) {
    opponentIdByTeamId.set(opponent.team.teamId, opponent.opponentId);
    teamById.set(opponent.team.teamId, {
      teamId: opponent.team.teamId,
      displayName: opponent.team.displayName,
      isUserTeam: false,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    });
  }
  const teamIdByOpponentId = new Map(
    [...opponentIdByTeamId.entries()].map(([teamId, opponentId]) => [opponentId, teamId]),
  );
  teamById.set(input.locked.human.teamId, {
    teamId: input.locked.human.teamId,
    displayName: input.locked.human.displayName,
    isUserTeam: true,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  });
  const pointsByTeamId = new Map(input.league.points.map((entry) => [entry.teamId, entry]));
  for (const record of input.league.league.teams) {
    const team = teamById.get(record.teamId);
    const points = pointsByTeamId.get(record.teamId);
    if (team === undefined || points === undefined) {
      throw new Error(`cap rush standings: league carries unknown team ${record.teamId}`);
    }
    team.wins = record.wins;
    team.losses = record.losses;
    team.pointsFor = points.pointsFor;
    team.pointsAgainst = points.pointsAgainst;
  }
  const userTeam = teamById.get(input.locked.human.teamId);
  if (userTeam === undefined) throw new Error('cap rush standings: missing user team');
  for (const game of input.userGames) {
    const opponentTeamId = teamIdByOpponentId.get(game.opponentId);
    const opponent = opponentTeamId === undefined ? undefined : teamById.get(opponentTeamId);
    if (opponent === undefined) {
      throw new Error(
        `cap rush standings: user game references unknown opponent ${game.opponentId}`,
      );
    }
    userTeam.wins += game.won ? 1 : 0;
    userTeam.losses += game.won ? 0 : 1;
    userTeam.pointsFor += game.humanPoints;
    userTeam.pointsAgainst += game.opponentPoints;
    opponent.wins += game.won ? 0 : 1;
    opponent.losses += game.won ? 1 : 0;
    opponent.pointsFor += game.opponentPoints;
    opponent.pointsAgainst += game.humanPoints;
  }
  const entries = capRushRankStandings([...teamById.values()]);
  assertLeagueAccounting({ entries, league: input.league });
  const cutoff = entries[CAP_RUSH_PLAYOFF_TEAMS - 1];
  if (cutoff === undefined) throw new Error('cap rush standings: missing cutoff team');
  return {
    entries,
    qualifiedTeamIds: entries.filter((entry) => entry.qualified).map((entry) => entry.teamId),
    cutoff: {
      seed: CAP_RUSH_PLAYOFF_TEAMS,
      teamId: cutoff.teamId,
      wins: cutoff.wins,
      losses: cutoff.losses,
      pointDifferential: cutoff.pointDifferential,
      pointsFor: cutoff.pointsFor,
      tieBreak: cutoffTieBreakOf(entries),
    },
    league: input.league,
    tiesAtCutoff: entries
      .filter((entry) => entry.wins === cutoff.wins)
      .map((entry) => entry.teamId),
  };
}

const OPENING_PAIRS: readonly (readonly [number, number])[] = [
  [0, 15],
  [7, 8],
  [3, 12],
  [4, 11],
  [1, 14],
  [6, 9],
  [2, 13],
  [5, 10],
];

function seriesOf(
  round: number,
  seriesSlot: number,
  first: CapRushStandingsEntry,
  second: CapRushStandingsEntry,
): CapRushPlayoffSeries {
  const high = first.seed < second.seed ? first : second;
  const low = first.seed < second.seed ? second : first;
  return {
    seriesId: capRushPlayoffSeriesId(round, seriesSlot),
    round,
    seriesSlot,
    highSeed: high.seed,
    lowSeed: low.seed,
    highTeamId: high.teamId,
    lowTeamId: low.teamId,
    games: [],
  };
}

export function capRushOpeningSeries(
  standings: CapRushPostseasonStandings,
): CapRushPlayoffSeries[] {
  return OPENING_PAIRS.map(([first, second], seriesSlot) => {
    const firstEntry = standings.entries[first];
    const secondEntry = standings.entries[second];
    if (firstEntry === undefined || secondEntry === undefined) {
      throw new Error('cap rush bracket: opening seeds are missing');
    }
    return seriesOf(1, seriesSlot, firstEntry, secondEntry);
  });
}

export function capRushSeriesWinsFor(series: CapRushPlayoffSeries, teamId: string): number {
  return series.games.filter((game) => game.winnerTeamId === teamId).length;
}

export function capRushSeriesWinnerOf(series: CapRushPlayoffSeries): string | null {
  if (capRushSeriesWinsFor(series, series.highTeamId) >= CAP_RUSH_SERIES_WINS) {
    return series.highTeamId;
  }
  if (capRushSeriesWinsFor(series, series.lowTeamId) >= CAP_RUSH_SERIES_WINS) {
    return series.lowTeamId;
  }
  return null;
}

export function capRushSeriesIsComplete(series: CapRushPlayoffSeries): boolean {
  return capRushSeriesWinnerOf(series) !== null;
}

export function capRushSeriesForTeam(
  postseason: CapRushLegacyPostseason,
  teamId: string,
  round: number,
): CapRushPlayoffSeries | null {
  return (
    postseason.series.find(
      (series) =>
        series.round === round && (series.highTeamId === teamId || series.lowTeamId === teamId),
    ) ?? null
  );
}

function standingsEntryOf(
  standings: CapRushPostseasonStandings,
  teamId: string,
): CapRushStandingsEntry {
  const entry = standings.entries.find((candidate) => candidate.teamId === teamId);
  if (entry === undefined) throw new Error(`cap rush bracket: unknown team ${teamId}`);
  return entry;
}

function createNextRound(postseason: CapRushLegacyPostseason): CapRushPlayoffSeries[] {
  const standings = postseason.standings;
  if (standings === null || postseason.series.length === 0) return [];
  const currentRound = Math.max(...postseason.series.map((series) => series.round));
  if (currentRound >= CAP_RUSH_PLAYOFF_ROUNDS) return [];
  const current = postseason.series
    .filter((series) => series.round === currentRound)
    .sort((left, right) => left.seriesSlot - right.seriesSlot);
  if (current.some((series) => !capRushSeriesIsComplete(series))) return [];
  if (postseason.series.some((series) => series.round === currentRound + 1)) return [];
  const next: CapRushPlayoffSeries[] = [];
  for (let index = 0; index < current.length; index += 2) {
    const first = current[index];
    const second = current[index + 1];
    if (first === undefined || second === undefined) break;
    const firstWinner = capRushSeriesWinnerOf(first);
    const secondWinner = capRushSeriesWinnerOf(second);
    if (firstWinner === null || secondWinner === null) break;
    next.push(
      seriesOf(
        currentRound + 1,
        index / 2,
        standingsEntryOf(standings, firstWinner),
        standingsEntryOf(standings, secondWinner),
      ),
    );
  }
  return next;
}

export function capRushRefreshPostseason(input: {
  readonly postseason: CapRushLegacyPostseason;
  readonly userTeamId?: string;
}): CapRushLegacyPostseason {
  const userTeamId = input.userTeamId ?? CAP_RUSH_USER_TEAM_ID;
  let next: CapRushLegacyPostseason = {
    ...input.postseason,
    series: [...input.postseason.series],
  };
  if (next.series.length > 0) {
    const latestRound = Math.max(...next.series.map((series) => series.round));
    const userSeries = capRushSeriesForTeam(next, userTeamId, latestRound);
    if (userSeries !== null && capRushSeriesIsComplete(userSeries)) {
      const winner = capRushSeriesWinnerOf(userSeries);
      if (winner !== userTeamId) {
        next = {
          ...next,
          userOutcome: { status: 'eliminated', round: latestRound },
        };
      }
    }
  }
  const added = createNextRound(next);
  if (added.length > 0) next = { ...next, series: [...next.series, ...added] };
  const finals = next.series.find(
    (series) => series.round === CAP_RUSH_PLAYOFF_ROUNDS && series.seriesSlot === 0,
  );
  const finalsWinner = finals === undefined ? null : capRushSeriesWinnerOf(finals);
  if (finalsWinner !== null) {
    return {
      ...next,
      championTeamId: finalsWinner,
      userOutcome:
        finalsWinner === userTeamId
          ? { status: 'champion', round: CAP_RUSH_PLAYOFF_ROUNDS }
          : next.userOutcome.status === 'pending'
            ? { status: 'eliminated', round: CAP_RUSH_PLAYOFF_ROUNDS }
            : next.userOutcome,
    };
  }
  return next;
}

export type CapRushPostseasonStep =
  | { readonly kind: 'standings' }
  | { readonly kind: 'games'; readonly games: readonly CapRushPlayoffGamePlan[] }
  | { readonly kind: 'finalize' }
  | { readonly kind: 'complete' };

function nextGamePlanOf(input: {
  readonly series: CapRushPlayoffSeries;
  readonly runSeed: Seed;
  readonly userTeamId: string;
}): CapRushPlayoffGamePlan {
  return capRushNextPlayoffGamePlan(input);
}

export function capRushPostseasonStep(input: {
  readonly postseason: CapRushLegacyPostseason;
  readonly runSeed: Seed;
  readonly userTeamId?: string;
}): CapRushPostseasonStep {
  const userTeamId = input.userTeamId ?? CAP_RUSH_USER_TEAM_ID;
  const { postseason } = input;
  if (postseason.phase === 'awaiting-standings') return { kind: 'standings' };
  if (postseason.phase === 'complete') return { kind: 'complete' };
  if (postseason.championTeamId !== null) return { kind: 'finalize' };
  if (postseason.series.length === 0) return { kind: 'standings' };
  const currentRound = Math.max(...postseason.series.map((series) => series.round));
  const current = postseason.series
    .filter((series) => series.round === currentRound)
    .sort((left, right) => left.seriesSlot - right.seriesSlot);
  const userAlive =
    postseason.userOutcome.status === 'pending' || postseason.userOutcome.status === 'champion';
  const userSeries = userAlive ? capRushSeriesForTeam(postseason, userTeamId, currentRound) : null;
  const games: CapRushPlayoffGamePlan[] = [];
  for (const series of current) {
    if (series === userSeries) continue;
    if (capRushSeriesIsComplete(series)) continue;
    games.push(nextGamePlanOf({ series, runSeed: input.runSeed, userTeamId }));
  }
  if (userSeries !== null && !capRushSeriesIsComplete(userSeries)) {
    games.push(nextGamePlanOf({ series: userSeries, runSeed: input.runSeed, userTeamId }));
  }
  if (games.length === 0) {
    if (postseason.series.length === 15 && postseason.series.every(capRushSeriesIsComplete)) {
      return { kind: 'finalize' };
    }
    return { kind: 'games', games: [] };
  }
  return { kind: 'games', games };
}

export function capRushFinalsMvp(postseason: CapRushLegacyPostseason): CapRushFinalsMvp | null {
  const champion = postseason.championTeamId;
  if (champion === null) return null;
  const finals = postseason.series.find(
    (series) => series.round === CAP_RUSH_PLAYOFF_ROUNDS && series.seriesSlot === 0,
  );
  if (finals === undefined || capRushSeriesWinnerOf(finals) !== champion) return null;
  return capRushFinalsMvpOf({
    games: finals.games,
    championTeamId: champion,
    userTeamId: CAP_RUSH_USER_TEAM_ID,
  });
}

export function capRushPostseasonSeriesName(series: CapRushPlayoffSeries): string {
  return `${capRushRoundName(series.round)} · ${String(series.highSeed)} vs ${String(series.lowSeed)}`;
}

export function capRushPlayoffGameSummaryOf(input: {
  readonly plan: CapRushPlayoffGamePlan;
}): Pick<
  CapRushPlayoffGameSummary,
  'gameId' | 'seriesId' | 'round' | 'seriesSlot' | 'gameOrdinal'
> {
  const { plan } = input;
  return {
    gameId: `crp-${String(plan.round)}-${String(plan.seriesSlot)}-${String(plan.gameOrdinal)}`,
    seriesId: plan.seriesId,
    round: plan.round,
    seriesSlot: plan.seriesSlot,
    gameOrdinal: plan.gameOrdinal,
  };
}
