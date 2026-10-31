import type {
  CapRushConferencePostseason,
  CapRushConferenceStandings,
  CapRushConferenceSeries,
  CapRushFinalsMvp,
  CapRushLeagueStandingsEntry,
  CapRushPlayoffGamePlan,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_PLAYOFF_ROUNDS,
  capRushConferenceRoundName,
  capRushConferenceStandingsEntries,
  capRushPlayoffGameId,
  capRushPlayoffSeriesId,
  capRushSeriesConferenceOf,
  capRushSeriesComplete,
  capRushSeriesWins,
  capRushSeriesWinner,
} from '@hoop-rush/data-contracts';
import { capRushFinalsMvpOf, capRushNextPlayoffGamePlan } from './playoff-shared.ts';
import { capRushFinalsHomeCourtOf } from './conference-standings.ts';

const OPENING_PAIRS: readonly (readonly [number, number])[] = [
  [1, 8],
  [4, 5],
  [3, 6],
  [2, 7],
];

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
  return capRushNextPlayoffGamePlan(input);
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
  return capRushFinalsMvpOf({ games: finals.games, championTeamId: champion, userTeamId });
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
