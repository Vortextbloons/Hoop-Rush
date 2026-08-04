/**
 * Ratings v3 summary adapters.
 *
 * Summary ratings remain UI-facing and never enter possession resolution.
 * Canonical Overall is produced by the versioned profile in v3.ts; the
 * production helper is retained as a diagnostic compatibility export.
 */
import { clamp, clampRating, safeFloat } from '../json.js';
import { computeOverall } from './weights.js';
import { DEFAULT_RATINGS_MODEL_ARTIFACT } from './artifact.js';
import { deriveRatingProfile, tendenciesForProfile } from './v3.js';
import type { SimulationRatings } from '@hoop-rush/data-contracts';
import type { StatsRow } from './stats.js';

function turnoverSecurity(tendencies: Record<string, number>, ballHandling: number): number {
  const rate = tendencies['turnoverRate'] || 12;
  const penalty = clamp((rate - 5) * 5, 0, 100);
  return 0.5 * ballHandling + 0.5 * (100 - penalty);
}

function offBallSpacing(ratings: Record<string, number>): number {
  return 0.6 * (ratings['threePoint'] ?? 50) + 0.4 * (ratings['passing'] ?? 50);
}

function foulDiscipline(tendencies: Record<string, number>): number {
  const rate = tendencies['foulRate'] || 2;
  return clamp(100 - rate * 8, 0, 100);
}

/** Offense and Defense summaries are consistent projections of the v3 profile. */
export function computeSummaryRatings(
  ratings: Record<string, number>,
  tendencies: Record<string, number>,
): { offenseRating: number; defenseRating: number; overallRating: number } {
  const offense =
    0.14 * (ratings['insideScoring'] ?? 50) +
    0.14 * (ratings['threePoint'] ?? 50) +
    0.08 * (ratings['midrange'] ?? 50) +
    0.08 * (ratings['freeThrow'] ?? 50) +
    0.16 * (ratings['ballHandling'] ?? 50) +
    0.12 * (ratings['passing'] ?? 50) +
    0.1 * turnoverSecurity(tendencies, ratings['ballHandling'] ?? 50) +
    0.1 * (ratings['offensiveIq'] ?? 50) +
    0.04 * (ratings['offensiveRebound'] ?? 50) +
    0.04 * offBallSpacing(ratings);
  const defense =
    0.22 * (ratings['perimeterDefense'] ?? 50) +
    0.22 * (ratings['interiorDefense'] ?? 50) +
    0.18 * (ratings['defensiveIq'] ?? 50) +
    0.1 * (ratings['steal'] ?? 50) +
    0.1 * (ratings['block'] ?? 50) +
    0.12 * (ratings['defensiveRebound'] ?? 50) +
    0.06 * foulDiscipline(tendencies);
  const offenseRating = clampRating(offense);
  const defenseRating = clampRating(defense);
  return {
    offenseRating,
    defenseRating,
    overallRating: clampRating(0.55 * offenseRating + 0.45 * defenseRating),
  };
}

/** Diagnostic production score used by calibration reports, not canonical OVR. */
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

/** Compatibility entry point; complete inputs always use the Ratings v3 curve. */
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
