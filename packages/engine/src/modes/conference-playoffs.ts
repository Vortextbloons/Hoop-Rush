import { capRushPlayoffSeriesId } from '@hoop-rush/data-contracts';
import {
  PLAYOFF_OPENING_PAIRS,
  playoffSeriesFields as playoffSeriesFieldsLeague,
  type PlayoffSeriesLike,
} from '../league/playoffs.ts';

export const CONFERENCE_OPENING_PAIRS = PLAYOFF_OPENING_PAIRS;

export { openingSeries as conferenceOpeningSeries, finalsHomeCourtOf } from '../league/playoffs.ts';

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
    seriesId: capRushPlayoffSeriesId(round, seriesSlot),
    ...playoffSeriesFieldsLeague(round, seriesSlot, high, low),
  };
}

export type { PlayoffSeriesLike };
