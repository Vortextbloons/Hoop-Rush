import {
  capRushPlayoffSeriesId,
  type CapRushLeagueStandingsEntry,
} from '@hoop-rush/data-contracts';
import { compareCodeUnits } from './conference-tiebreak.ts';

export const CONFERENCE_OPENING_PAIRS: readonly (readonly [number, number])[] = [
  [1, 8],
  [4, 5],
  [3, 6],
  [2, 7],
];

export function conferenceOpeningSeries<T, TSeries>(
  conferences: readonly [readonly T[], readonly T[]],
  seriesOf: (slot: number, high: T, low: T) => TSeries,
  missingSeedMessage: string,
): TSeries[] {
  return conferences.flatMap((rows, conference) =>
    CONFERENCE_OPENING_PAIRS.map(([highSeed, lowSeed], index) => {
      const high = rows[highSeed - 1];
      const low = rows[lowSeed - 1];
      if (high === undefined || low === undefined) throw new Error(missingSeedMessage);
      return seriesOf(conference * CONFERENCE_OPENING_PAIRS.length + index, high, low);
    }),
  );
}

type PlayoffSeed = { readonly seed: number; readonly teamId: string };

export function playoffSeriesFields(
  round: number,
  seriesSlot: number,
  high: PlayoffSeed,
  low: PlayoffSeed,
) {
  return {
    seriesId: capRushPlayoffSeriesId(round, seriesSlot),
    round,
    seriesSlot,
    highSeed: high.seed,
    lowSeed: low.seed,
    highTeamId: high.teamId,
    lowTeamId: low.teamId,
  };
}

type FinalsStanding = Pick<
  CapRushLeagueStandingsEntry,
  'teamId' | 'wins' | 'pointDifferential' | 'pointsFor'
>;

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
