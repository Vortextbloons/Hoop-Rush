import type { Seed } from '@hoop-rush/data-contracts';
import { compareCodeUnits } from './tiebreak.ts';

export const PLAYOFF_OPENING_PAIRS: readonly (readonly [number, number])[] = [
  [1, 8],
  [4, 5],
  [3, 6],
  [2, 7],
];

export function openingSeries<T, TSeries>(
  conferences: readonly [readonly T[], readonly T[]],
  seriesOf: (slot: number, high: T, low: T) => TSeries,
  missingSeedMessage: string,
): TSeries[] {
  return conferences.flatMap((rows, conference) =>
    PLAYOFF_OPENING_PAIRS.map(([highSeed, lowSeed], index) => {
      const high = rows[highSeed - 1];
      const low = rows[lowSeed - 1];
      if (high === undefined || low === undefined) throw new Error(missingSeedMessage);
      return seriesOf(conference * PLAYOFF_OPENING_PAIRS.length + index, high, low);
    }),
  );
}

interface PlayoffSeed {
  readonly seed: number;
  readonly teamId: string;
}

export function playoffSeriesFields(
  round: number,
  seriesSlot: number,
  high: PlayoffSeed,
  low: PlayoffSeed,
) {
  return {
    round,
    seriesSlot,
    highSeed: high.seed,
    lowSeed: low.seed,
    highTeamId: high.teamId,
    lowTeamId: low.teamId,
  };
}

interface FinalsStanding {
  readonly teamId: string;
  readonly wins: number;
  readonly pointDifferential: number;
  readonly pointsFor: number;
}

export function finalsHomeCourtOf(
  left: FinalsStanding,
  right: FinalsStanding,
  leftWins: number,
  rightWins: number,
): string {
  if (left.wins !== right.wins) return left.wins > right.wins ? left.teamId : right.teamId;
  if (leftWins !== rightWins) return leftWins > rightWins ? left.teamId : right.teamId;
  if (left.pointDifferential !== right.pointDifferential) {
    return left.pointDifferential > right.pointDifferential ? left.teamId : right.teamId;
  }
  if (left.pointsFor !== right.pointsFor) {
    return left.pointsFor > right.pointsFor ? left.teamId : right.teamId;
  }
  return compareCodeUnits(left.teamId, right.teamId) <= 0 ? left.teamId : right.teamId;
}

export interface PlayoffSeriesLike {
  readonly seriesId: string;
  readonly round: number;
  readonly seriesSlot: number;
  readonly games: readonly unknown[];
  readonly highTeamId: string;
  readonly lowTeamId: string;
  readonly highSeed: number;
  readonly lowSeed: number;
}

export interface PlayoffGamePlan {
  readonly seriesId: string;
  readonly round: number;
  readonly seriesSlot: number;
  readonly gameOrdinal: number;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly homeSeed: number;
  readonly awaySeed: number;
  readonly userSide: 'home' | 'away' | null;
  readonly isFinals: boolean;
  readonly seed: Seed;
}

export function nextPlayoffGamePlan(input: {
  readonly series: PlayoffSeriesLike;
  readonly seed: Seed;
  readonly userTeamId: string;
  readonly finalsRound: number;
}): PlayoffGamePlan {
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
    isFinals: series.round === input.finalsRound,
    seed: input.seed,
  };
}
