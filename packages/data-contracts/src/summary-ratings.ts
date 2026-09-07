import type { SimulationRatings, SimulationTendencies } from './simulation.ts';

export type OffenseDefenseTendencies = Pick<SimulationTendencies, 'turnoverRate' | 'foulRate'>;

function clampRatingValue(value: number): number {
  return Math.max(0, Math.min(100, Math.trunc(value)));
}

export function offenseDefenseOf(
  ratings: SimulationRatings,
  tendencies: OffenseDefenseTendencies,
): { offenseRating: number; defenseRating: number } {
  const turnoverSecurity =
    0.5 * ratings.ballHandling +
    0.5 * (100 - Math.max(0, Math.min(100, (tendencies.turnoverRate - 5) * 5)));
  const offense =
    0.16 * ratings.insideScoring +
    0.16 * ratings.threePoint +
    0.1 * ratings.midrange +
    0.08 * ratings.freeThrow +
    0.15 * ratings.ballHandling +
    0.13 * ratings.passing +
    0.1 * turnoverSecurity +
    0.08 * ratings.offensiveIq +
    0.04 * ratings.offensiveRebound;
  const foulDiscipline = Math.max(0, Math.min(100, 100 - tendencies.foulRate * 8));
  const defense =
    0.24 * ratings.perimeterDefense +
    0.22 * ratings.interiorDefense +
    0.18 * ratings.defensiveIq +
    0.1 * ratings.steal +
    0.1 * ratings.block +
    0.1 * ratings.defensiveRebound +
    0.06 * foulDiscipline;
  return { offenseRating: clampRatingValue(offense), defenseRating: clampRatingValue(defense) };
}

export function summaryRatingsOfRatings(
  ratings: SimulationRatings,
  tendencies: OffenseDefenseTendencies,
): { offenseRating: number; defenseRating: number; overallRating: number } {
  const { offenseRating, defenseRating } = offenseDefenseOf(ratings, tendencies);
  return {
    offenseRating,
    defenseRating,
    overallRating: clampRatingValue(0.55 * offenseRating + 0.45 * defenseRating),
  };
}
