import { clamp, clampRating, safeFloat } from '../json.ts';
import { computeOverall } from './weights.ts';
import { DEFAULT_RATINGS_MODEL_ARTIFACT } from './artifact.ts';
import { computeOffenseDefense, deriveRatingProfile, tendenciesForProfile } from './v3.ts';
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
  const { offenseRating, defenseRating } = computeOffenseDefense(completeRatings(ratings), {
    ...TENDENCY_DEFAULTS,
    ...tendencies,
  } as SimulationTendencies);
  return {
    offenseRating,
    defenseRating,
    overallRating: clampRating(0.55 * offenseRating + 0.45 * defenseRating),
  };
}
export function computeProductionImpact(stats: StatsRow): number {
  const gp = Math.max(0, Math.trunc(safeFloat(stats.gamesPlayed)));
  const minutes = safeFloat(stats.minutes);
  if (gp === 0 || minutes === 0) return 0;
  const ppg = safeFloat(stats.points) / Math.max(1, gp);
  const rpg = safeFloat(stats.rebounds) / Math.max(1, gp);
  const apg = safeFloat(stats.assists) / Math.max(1, gp);
  const mpg = minutes / Math.max(1, gp);
  const per = safeFloat(stats.per);
  const bpm = safeFloat(stats.boxPlusMinus);
  const usage = safeFloat(stats.usageRate);
  const tsPct = safeFloat(stats.tsPct);
  let impact =
    60 +
    (ppg - 15) * 0.65 +
    (rpg - 5) * 0.3 +
    (apg - 3) * 0.45 +
    (per - 15) * 0.6 +
    bpm * 0.8 +
    (usage - 20) * 0.15 +
    (mpg - 24) * 0.15 +
    (tsPct - 0.55) * 35;
  if (ppg >= 24 && tsPct >= 0.59) impact += 2.5;
  else if (ppg >= 24 && tsPct >= 0.56) impact += 1.25;
  if (apg >= 6 && usage >= 26) impact += 1.25;
  if (ppg >= 20 && per >= 20) impact += 1;
  return clamp(impact, 55, 99);
}
export function computeRealOverall(
  ratings: Record<string, number>,
  position: string,
  stats: StatsRow,
  heightInches?: number | null,
): number {
  if (Object.keys(ratings).length < 18) {
    const neutral = computeOverall(ratings, position, heightInches);
    const measuredPer = stats.per == null ? null : safeFloat(stats.per);
    const measuredBpm = stats.boxPlusMinus == null ? null : safeFloat(stats.boxPlusMinus);
    if (measuredPer === null && measuredBpm === null) return neutral;
    return clampRating(
      neutral +
        (measuredPer === null ? 0 : (measuredPer - 15) * 0.45) +
        (measuredBpm === null ? 0 : measuredBpm * 0.45),
    );
  }
  const completeRatings = ratings as SimulationRatings;
  return deriveRatingProfile({
    ratings: completeRatings,
    tendencies: tendenciesForProfile(stats, completeRatings),
    stats,
    position,
    heightInches: heightInches ?? null,
    artifact: DEFAULT_RATINGS_MODEL_ARTIFACT,
  }).profile.canonicalOverall;
}
