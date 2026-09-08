import type { SimulationRatings, SimulationTendencies } from './simulation.ts';

export type OffenseDefenseTendencies = Pick<SimulationTendencies, 'turnoverRate' | 'foulRate'>;

function clampRatingValue(value: number): number {
  return Math.max(0, Math.min(100, Math.trunc(value)));
}

export function spacingWeightForEra(leagueThreePARate?: number | null): number {
  if (leagueThreePARate == null || !Number.isFinite(leagueThreePARate)) return 1;
  return Math.min(1, Math.max(0.35, leagueThreePARate / 0.15));
}

export function offenseDefenseOf(
  ratings: SimulationRatings,
  tendencies: OffenseDefenseTendencies,
  leagueThreePARate?: number | null,
  positionGroup?: 'G' | 'F' | 'C' | null,
): { offenseRating: number; defenseRating: number } {
  const spacingWeight = spacingWeightForEra(leagueThreePARate);
  const threeShare = 0.16 * spacingWeight;
  const redistributed = 0.16 - threeShare;
  const turnoverSecurity =
    0.5 * ratings.ballHandling +
    0.5 * (100 - Math.max(0, Math.min(100, (tendencies.turnoverRate - 5) * 5)));
  const offense =
    (0.16 + redistributed / 2) * ratings.insideScoring +
    threeShare * ratings.threePoint +
    (0.1 + redistributed / 2) * ratings.midrange +
    0.08 * ratings.freeThrow +
    0.15 * ratings.ballHandling +
    0.13 * ratings.passing +
    0.1 * turnoverSecurity +
    0.08 * ratings.offensiveIq +
    0.04 * ratings.offensiveRebound;
  const foulDiscipline = Math.max(0, Math.min(100, 100 - tendencies.foulRate * 8));
  // Positional responsibility: a drop-coverage center is graded on rim
  // protection, not switch containment. Without this, every paint anchor
  // (Shaq pd 48, Duncan pd 56) donates ~2 defense points to wings for a job
  // that was never theirs.
  const perimeterShare = positionGroup === 'C' ? 0.14 : positionGroup === 'F' ? 0.19 : 0.24;
  const interiorShare = positionGroup === 'C' ? 0.32 : positionGroup === 'F' ? 0.27 : 0.22;
  const defense =
    perimeterShare * ratings.perimeterDefense +
    interiorShare * ratings.interiorDefense +
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
  leagueThreePARate?: number | null,
  positionGroup?: 'G' | 'F' | 'C' | null,
): { offenseRating: number; defenseRating: number; overallRating: number } {
  const { offenseRating, defenseRating } = offenseDefenseOf(
    ratings,
    tendencies,
    leagueThreePARate,
    positionGroup,
  );
  return {
    offenseRating,
    defenseRating,
    overallRating: clampRatingValue(0.55 * offenseRating + 0.45 * defenseRating),
  };
}
