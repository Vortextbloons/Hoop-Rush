import type {
  CapRushConferencePostseason,
  CapRushConferenceStandings,
  CapRushConferenceSeries,
  CapRushFinalsMvp,
  CapRushLeagueStandingsEntry,
  CapRushPlayoffGamePlan,
  CapRushPlayoffParticipant,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_FINALS_MVP_VERSION,
  CAP_RUSH_PLAYOFF_ROUNDS,
  capRushConferenceRoundName,
  capRushConferenceStandingsEntries,
  capRushPlayoffGameId,
  capRushPlayoffGameSeed,
  capRushPlayoffSeriesId,
  capRushSeriesConferenceOf,
  capRushSeriesComplete,
  capRushSeriesWins,
  capRushSeriesWinner,
  playerIdSchema,
} from '@hoop-rush/data-contracts';
import { gameScore } from '../../challenge/league-value.ts';
import { capRushFinalsHomeCourtOf } from './conference-standings.ts';

const OPENING_PAIRS: readonly (readonly [number, number])[] = [
  [1, 8],
  [4, 5],
  [3, 6],
  [2, 7],
];

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function entryOf(
  standings: CapRushConferenceStandings,
  teamId: string,
): CapRushLeagueStandingsEntry {
  const entry = capRushConferenceStandingsEntries(standings).find(
    (candidate) => candidate.teamId === teamId,
  );
  if (entry === undefined) throw new Error(`cap rush bracket: unknown team ${teamId}`);
  return entry;
}

function seriesOf(input: {
  readonly round: number;
  readonly seriesSlot: number;
  readonly homeCourt: CapRushLeagueStandingsEntry;
  readonly road: CapRushLeagueStandingsEntry;
}): CapRushConferenceSeries {
  return {
    seriesId: capRushPlayoffSeriesId(input.round, input.seriesSlot),
    round: input.round,
    seriesSlot: input.seriesSlot,
    conference: capRushSeriesConferenceOf(input.round, input.seriesSlot),
    highSeed: input.homeCourt.seed,
    lowSeed: input.road.seed,
    highTeamId: input.homeCourt.teamId,
    lowTeamId: input.road.teamId,
    games: [],
  };
}

export function capRushConferenceOpeningSeries(
  standings: CapRushConferenceStandings,
): CapRushConferenceSeries[] {
  const series: CapRushConferenceSeries[] = [];
  for (const conference of ['west', 'east'] as const) {
    const table = conference === 'west' ? standings.west : standings.east;
    const offset = conference === 'west' ? 0 : 4;
    OPENING_PAIRS.forEach(([highSeed, lowSeed], index) => {
      const home = table.entries[highSeed - 1];
      const road = table.entries[lowSeed - 1];
      if (home === undefined || road === undefined) {
        throw new Error('cap rush bracket: opening seeds are missing');
      }
      series.push(seriesOf({ round: 1, seriesSlot: offset + index, homeCourt: home, road }));
    });
  }
  return series;
}

export function capRushConferenceSeriesForTeam(
  postseason: CapRushConferencePostseason,
  teamId: string,
  round: number,
): CapRushConferenceSeries | null {
  return (
    postseason.series.find(
      (series) =>
        series.round === round && (series.highTeamId === teamId || series.lowTeamId === teamId),
    ) ?? null
  );
}

export function capRushConferenceSeriesName(series: CapRushConferenceSeries): string {
  const conference =
    series.conference === null ? '' : ` · ${series.conference === 'west' ? 'West' : 'East'}`;
  return `${capRushConferenceRoundName(series.round)}${conference} · ${String(series.highSeed)} vs ${String(series.lowSeed)}`;
}

function createNextRound(input: {
  readonly postseason: CapRushConferencePostseason;
}): CapRushConferenceSeries[] {
  const { postseason } = input;
  const standings = postseason.standings;
  if (standings === null || postseason.series.length === 0) return [];
  const currentRound = Math.max(...postseason.series.map((series) => series.round));
  if (currentRound >= CAP_RUSH_PLAYOFF_ROUNDS) return [];
  const current = postseason.series
    .filter((series) => series.round === currentRound)
    .sort((left, right) => left.seriesSlot - right.seriesSlot);
  if (current.some((series) => !capRushSeriesComplete(series))) return [];
  if (postseason.series.some((series) => series.round === currentRound + 1)) return [];
  const winners: CapRushLeagueStandingsEntry[] = [];
  for (const series of current) {
    const winner = capRushSeriesWinner(series);
    if (winner === null) return [];
    winners.push(entryOf(standings, winner));
  }
  const next: CapRushConferenceSeries[] = [];
  if (currentRound + 1 === CAP_RUSH_PLAYOFF_ROUNDS) {
    const west = winners.find((entry) => entry.conference === 'west');
    const east = winners.find((entry) => entry.conference === 'east');
    if (west === undefined || east === undefined) {
      throw new Error('cap rush bracket: the Finals requires one champion per conference');
    }
    const homeCourtId = capRushFinalsHomeCourtOf({
      leftTeamId: west.teamId,
      rightTeamId: east.teamId,
      standings,
      games: standings.games,
    });
    const homeCourt = homeCourtId === west.teamId ? west : east;
    const road = homeCourtId === west.teamId ? east : west;
    next.push(seriesOf({ round: currentRound + 1, seriesSlot: 0, homeCourt, road }));
  } else {
    for (let index = 0; index < winners.length; index += 2) {
      const first = winners[index];
      const second = winners[index + 1];
      if (first === undefined || second === undefined) break;
      const homeCourt = first.seed <= second.seed ? first : second;
      const road = first.seed <= second.seed ? second : first;
      next.push(
        seriesOf({
          round: currentRound + 1,
          seriesSlot: index / 2,
          homeCourt,
          road,
        }),
      );
    }
  }
  return next;
}

export function capRushRefreshConferencePostseason(input: {
  readonly postseason: CapRushConferencePostseason;
  readonly userTeamId: string;
}): CapRushConferencePostseason {
  let next: CapRushConferencePostseason = {
    ...input.postseason,
    series: [...input.postseason.series],
  };
  const standings = next.standings;
  if (standings !== null && next.phase === 'playoffs' && next.series.length > 0) {
    const latestRound = Math.max(...next.series.map((series) => series.round));
    const userSeries = capRushConferenceSeriesForTeam(next, input.userTeamId, latestRound);
    if (userSeries !== null && capRushSeriesComplete(userSeries)) {
      if (capRushSeriesWinner(userSeries) !== input.userTeamId) {
        next = {
          ...next,
          userOutcome: { status: 'eliminated', round: latestRound },
        };
      }
    }
  }
  const added = createNextRound({ postseason: next });
  if (added.length > 0) next = { ...next, series: [...next.series, ...added] };
  const finals = next.series.find(
    (series) => series.round === CAP_RUSH_PLAYOFF_ROUNDS && series.seriesSlot === 0,
  );
  const finalsWinner = finals === undefined ? null : capRushSeriesWinner(finals);
  if (finalsWinner !== null) {
    const decided = finalsWinner === input.userTeamId;
    return {
      ...next,
      championTeamId: finalsWinner,
      userOutcome: decided
        ? { status: 'champion', round: CAP_RUSH_PLAYOFF_ROUNDS }
        : next.userOutcome.status === 'pending'
          ? { status: 'eliminated', round: CAP_RUSH_PLAYOFF_ROUNDS }
          : next.userOutcome,
    };
  }
  return next;
}

export type CapRushConferencePostseasonStep =
  | { readonly kind: 'standings' }
  | { readonly kind: 'games'; readonly games: readonly CapRushPlayoffGamePlan[] }
  | { readonly kind: 'finalize' }
  | { readonly kind: 'complete' };

function nextGamePlanOf(input: {
  readonly series: CapRushConferenceSeries;
  readonly runSeed: Seed;
  readonly userTeamId: string;
}): CapRushPlayoffGamePlan {
  const { series, userTeamId } = input;
  const ordinal = series.games.length + 1;
  const highHome = [1, 2, 5, 7].includes(ordinal);
  const homeTeamId = highHome ? series.highTeamId : series.lowTeamId;
  const awayTeamId = highHome ? series.lowTeamId : series.highTeamId;
  const homeSeed = highHome ? series.highSeed : series.lowSeed;
  const awaySeed = highHome ? series.lowSeed : series.highSeed;
  const userSide = homeTeamId === userTeamId ? 'home' : awayTeamId === userTeamId ? 'away' : null;
  return {
    seriesId: series.seriesId,
    round: series.round,
    seriesSlot: series.seriesSlot,
    gameOrdinal: ordinal,
    homeTeamId,
    awayTeamId,
    homeSeed,
    awaySeed,
    userSide,
    isFinals: series.round === CAP_RUSH_PLAYOFF_ROUNDS,
    seed: capRushPlayoffGameSeed(input.runSeed, series.round, series.seriesSlot, ordinal),
  };
}

export function capRushConferencePostseasonStep(input: {
  readonly postseason: CapRushConferencePostseason;
  readonly runSeed: Seed;
  readonly userTeamId: string;
}): CapRushConferencePostseasonStep {
  const { postseason } = input;
  if (postseason.phase === 'awaiting-standings') return { kind: 'standings' };
  if (postseason.phase === 'complete') return { kind: 'complete' };
  if (postseason.championTeamId !== null) return { kind: 'finalize' };
  if (postseason.series.length === 0) return { kind: 'standings' };
  const currentRound = Math.max(...postseason.series.map((series) => series.round));
  const current = postseason.series
    .filter((series) => series.round === currentRound)
    .sort((left, right) => left.seriesSlot - right.seriesSlot);
  const userAlive = postseason.userOutcome.status === 'pending';
  const userSeries = userAlive
    ? capRushConferenceSeriesForTeam(postseason, input.userTeamId, currentRound)
    : null;
  const games: CapRushPlayoffGamePlan[] = [];
  for (const series of current) {
    if (series === userSeries) continue;
    if (capRushSeriesComplete(series)) continue;
    games.push(nextGamePlanOf({ series, runSeed: input.runSeed, userTeamId: input.userTeamId }));
  }
  if (userSeries !== null && !capRushSeriesComplete(userSeries)) {
    games.push(
      nextGamePlanOf({ series: userSeries, runSeed: input.runSeed, userTeamId: input.userTeamId }),
    );
  }
  if (games.length === 0) {
    if (
      postseason.series.length === 15 &&
      postseason.series.every((series) => capRushSeriesComplete(series))
    ) {
      return { kind: 'finalize' };
    }
    return { kind: 'games', games: [] };
  }
  return { kind: 'games', games };
}

export function capRushConferenceFinalsMvp(
  postseason: CapRushConferencePostseason,
  userTeamId: string,
): CapRushFinalsMvp | null {
  const champion = postseason.championTeamId;
  if (champion === null) return null;
  const finals = postseason.series.find(
    (series) => series.round === CAP_RUSH_PLAYOFF_ROUNDS && series.seriesSlot === 0,
  );
  if (finals === undefined || capRushSeriesWinner(finals) !== champion) return null;
  interface Totals {
    slot: CapRushPlayoffParticipant['slot'];
    playerId: string;
    displayName: string;
    games: number;
    gameScore: number;
    points: number;
    assists: number;
    rebounds: number;
  }
  const totals = new Map<string, Totals>();
  for (const game of finals.games) {
    const seenSlots = new Set<string>();
    for (const line of game.finalsLines ?? []) {
      if (line.teamId !== champion) continue;
      const key = `${line.slot}:${line.playerId}`;
      const existing = totals.get(key) ?? {
        slot: line.slot,
        playerId: line.playerId,
        displayName: line.displayName,
        games: 0,
        gameScore: 0,
        points: 0,
        assists: 0,
        rebounds: 0,
      };
      if (!seenSlots.has(key)) {
        existing.games += 1;
        seenSlots.add(key);
      }
      existing.gameScore += gameScore({
        playerId: line.playerId,
        minutes: line.minutes,
        points: line.points,
        fieldGoals: { made: line.fieldGoalsMade, attempted: line.fieldGoalsAttempted },
        threes: { made: line.threesMade, attempted: line.threesAttempted },
        freeThrows: { made: line.freeThrowsMade, attempted: line.freeThrowsAttempted },
        rebounds: {
          total: line.rebounds,
          offensive: line.offensiveRebounds,
          defensive: line.defensiveRebounds,
        },
        assists: line.assists,
        steals: line.steals,
        blocks: line.blocks,
        turnovers: line.turnovers,
        fouls: line.fouls,
      });
      existing.points += line.points;
      existing.assists += line.assists;
      existing.rebounds += line.rebounds;
      totals.set(key, existing);
    }
  }
  const ranked = [...totals.values()].sort((left, right) => {
    if (right.gameScore !== left.gameScore) return right.gameScore - left.gameScore;
    if (right.points !== left.points) return right.points - left.points;
    if (right.assists !== left.assists) return right.assists - left.assists;
    if (right.rebounds !== left.rebounds) return right.rebounds - left.rebounds;
    return compareCodeUnits(left.playerId, right.playerId);
  });
  const winner = ranked[0];
  if (winner === undefined) return null;
  return {
    version: CAP_RUSH_FINALS_MVP_VERSION,
    selectionRule: 'finals-game-score-then-points-assists-rebounds-player-id',
    teamId: champion,
    isUserTeam: champion === userTeamId,
    slot: winner.slot,
    playerId: playerIdSchema.parse(winner.playerId),
    displayName: winner.displayName,
    games: winner.games,
    totalGameScore: winner.gameScore,
    totalPoints: winner.points,
    totalAssists: winner.assists,
    totalRebounds: winner.rebounds,
    averageGameScore: winner.gameScore / winner.games,
    averagePoints: winner.points / winner.games,
    averageAssists: winner.assists / winner.games,
    averageRebounds: winner.rebounds / winner.games,
  };
}

export function capRushConferenceQualificationOf(input: {
  readonly standings: CapRushConferenceStandings;
  readonly userTeamId: string;
}): { readonly qualified: boolean; readonly entry: CapRushLeagueStandingsEntry } {
  const entry = entryOf(input.standings, input.userTeamId);
  return { qualified: entry.qualified, entry };
}

export function capRushConferencePlayoffGameId(plan: CapRushPlayoffGamePlan): string {
  return capRushPlayoffGameId(plan.round, plan.seriesSlot, plan.gameOrdinal);
}

export { capRushSeriesWins, capRushSeriesComplete, capRushSeriesWinner };
