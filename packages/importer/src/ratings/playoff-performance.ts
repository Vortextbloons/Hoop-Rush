import {
  playoffPerformanceSchema,
  type PlayoffPerformance,
  type PostseasonPlayerStats,
} from '@hoop-rush/data-contracts';
import type { StatsRow } from './stats.ts';

export function derivePlayoffPerformance(
  season: string,
  stats: StatsRow,
  playoffs: PostseasonPlayerStats | undefined,
): PlayoffPerformance | undefined {
  if (!playoffs || playoffs.gamesPlayed === 0 || playoffs.minutes === 0) return undefined;
  const number = (key: string): number | null => {
    const value = stats[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  };
  const minutes = number('minutes');
  const points = number('points');
  const fga = number('fga');
  const fta = number('fta');
  const denominator = fga !== null && fta !== null ? 2 * (fga + 0.44 * fta) : 0;
  const tsPct = points !== null && denominator > 0 ? points / denominator : null;
  const per36Difference = (key: 'points' | 'assists' | 'rebounds' | 'turnovers') => {
    const regular = number(key);
    return regular !== null && minutes !== null && minutes > 0 && playoffs[key] !== null
      ? (playoffs[key] * 36) / playoffs.minutes - (regular * 36) / minutes
      : null;
  };
  if (
    minutes === null ||
    points === null ||
    fga === null ||
    fta === null ||
    number('gamesPlayed') === null ||
    number('assists') === null ||
    number('rebounds') === null
  )
    return undefined;
  return playoffPerformanceSchema.parse({
    season,
    regularSeason: {
      gamesPlayed: number('gamesPlayed'),
      minutes,
      points,
      assists: number('assists'),
      rebounds: number('rebounds'),
      turnovers: number('turnovers'),
      fga,
      fta,
      tsPct,
    },
    playoffs,
    differences: {
      tsPct: tsPct !== null && playoffs.tsPct !== null ? playoffs.tsPct - tsPct : null,
      pointsPer36: per36Difference('points'),
      assistsPer36: per36Difference('assists'),
      reboundsPer36: per36Difference('rebounds'),
      turnoversPer36: per36Difference('turnovers'),
    },
  });
}
