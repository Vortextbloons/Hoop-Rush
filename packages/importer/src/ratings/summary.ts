import { clampRating } from '../json.ts';
import { summaryRatingsOfRatings } from '@hoop-rush/data-contracts';
import { loadRatingsModelArtifact } from './artifact.ts';
import { deriveRatingProfile, tendenciesForProfile, productionEvidence } from './v3.ts';
import type { SimulationRatings, SimulationTendencies } from '@hoop-rush/data-contracts';
import type { StatsRow } from './stats.ts';
const RATING_KEYS: readonly (keyof SimulationRatings)[] = [
  'insideScoring',
  'closeShot',
  'threePoint',
  'midrange',
  'freeThrow',
  'ballHandling',
  'passing',
  'offensiveIq',
  'offensiveRebound',
  'defensiveRebound',
  'perimeterDefense',
  'interiorDefense',
  'steal',
  'block',
  'defensiveIq',
  'speed',
  'strength',
  'vertical',
];
const TENDENCY_DEFAULTS: Pick<SimulationTendencies, 'turnoverRate' | 'foulRate'> = {
  turnoverRate: 12,
  foulRate: 2,
};
function completeRatings(ratings: Record<string, number>): SimulationRatings {
  const filled = Object.fromEntries(RATING_KEYS.map((key) => [key, 50])) as Record<
    keyof SimulationRatings,
    number
  >;
  return { ...filled, ...ratings };
}
export function computeSummaryRatings(
  ratings: Record<string, number>,
  tendencies: Record<string, number>,
): {
  offenseRating: number;
  defenseRating: number;
  overallRating: number;
} {
  const { offenseRating, defenseRating } = summaryRatingsOfRatings(completeRatings(ratings), {
    ...TENDENCY_DEFAULTS,
    ...tendencies,
  });
  return {
    offenseRating,
    defenseRating,
    overallRating: clampRating(0.65 * offenseRating + 0.35 * defenseRating),
  };
}
export function computeProductionImpact(stats: StatsRow): number {
  return productionEvidence(stats).score;
}
export function computeRealOverall(
  ratings: Record<string, number>,
  position: string,
  stats: StatsRow,
  heightInches?: number | null,
): number {
  const fullRatings = completeRatings(ratings);
  return deriveRatingProfile({
    ratings: fullRatings,
    tendencies: tendenciesForProfile(stats, fullRatings),
    stats,
    position,
    heightInches: heightInches ?? null,
    artifact: loadRatingsModelArtifact(),
  }).profile.canonicalOverall;
}
