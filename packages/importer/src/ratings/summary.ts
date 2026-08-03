/**
 * Summary ratings and production-aware overall (port of compute_ratings.py
 * compute_summary_ratings / compute_production_impact / compute_real_overall).
 *
 * Summary ratings are UI-facing only and never replace detailed attributes in
 * possession resolution. Weights map the detailed ratings + tendencies onto the
 * spec/11 dimensions; changes require a new ratings version.
 */
import { clamp, clampRating, safeFloat } from '../json.js';
import { computeOverall, isBigProfile } from './weights.js';
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
  const overallRating = clampRating(0.55 * offenseRating + 0.45 * defenseRating);
  return { offenseRating, defenseRating, overallRating };
}

/**
 * Estimate top-line player impact from real production.
 *
 * The weighted skill overall is intentionally position-specific, but by itself it
 * compresses heliocentric stars and older elite players into the high 70s. This
 * impact layer lets real NBA production lift the final overall without inflating
 * every individual skill rating.
 */
export function computeProductionImpact(stats: StatsRow): number {
  const gp = safeIntGames(stats.gamesPlayed);
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
    62 +
    (ppg - 10) * 1.0 +
    (rpg - 4) * 0.7 +
    (apg - 3) * 0.95 +
    (per - 15) * 0.9 +
    bpm * 1.5 +
    (usage - 20) * 0.35 +
    (mpg - 24) * 0.35 +
    (tsPct - 0.57) * 50;
  if (ppg >= 24 && tsPct >= 0.59) {
    impact += 3.5;
  } else if (ppg >= 24 && tsPct >= 0.56) {
    impact += 2;
  }
  if (apg >= 6 && usage >= 26) impact += 2;
  if (ppg >= 20 && per >= 20) impact += 1.5;
  return clamp(impact, 55, 99);
}

function safeIntGames(value: unknown): number {
  return Math.max(0, Math.trunc(safeFloat(value)));
}

export function computeRealOverall(
  ratings: Record<string, number>,
  position: string,
  stats: StatsRow,
  heightInches?: number | null,
): number {
  const skillOverall = computeOverall(ratings, position, heightInches);
  const productionImpact = computeProductionImpact(stats);
  if (productionImpact === 0) return skillOverall;

  const gp = safeIntGames(stats.gamesPlayed);
  const minutes = safeFloat(stats.minutes);
  const ppg = safeFloat(stats.points) / Math.max(1, gp);
  const rpg = safeFloat(stats.rebounds) / Math.max(1, gp);
  const apg = safeFloat(stats.assists) / Math.max(1, gp);
  const mpg = minutes / Math.max(1, gp);
  const per = safeFloat(stats.per);
  const usage = safeFloat(stats.usageRate);
  const bpm = safeFloat(stats.boxPlusMinus);
  const tsPct = safeFloat(stats.tsPct);

  const blended = Math.max(skillOverall, skillOverall * 0.65 + productionImpact * 0.35);

  // --- Floor logic (matches TS computeRealOverall) ---
  let floor = 0;
  if (mpg >= 28 && gp >= 40) {
    if (ppg >= 26) floor = 88;
    else if (ppg >= 22) floor = 84;
    else if (ppg >= 16) floor = 80;
    else if (ppg >= 12) floor = 76;
  } else if (mpg >= 24 && gp >= 35) {
    if (ppg >= 18) floor = 79;
    else if (ppg >= 14) floor = 75;
    else if (ppg >= 10) floor = 71;
  } else if (mpg >= 18 && gp >= 40) {
    if (ppg >= 14) floor = 73;
    else if (ppg >= 10) floor = 69;
    else if (ppg >= 6) floor = 65;
  } else if (mpg >= 18 && gp >= 15) {
    if (ppg >= 7) floor = 70;
    else floor = 68;
  } else if (mpg >= 12 && gp >= 15) {
    floor = 69;
  } else if (mpg >= 8 && gp >= 15) {
    floor = 69;
  } else if (gp >= 50) {
    floor = 67;
  } else if (gp >= 30) {
    floor = 63;
  }

  // Star floor overrides (matches TS)
  if (gp >= 15 && mpg >= 28 && ppg >= 22 && usage >= 28) floor = Math.max(floor, 89);
  if (gp >= 15 && mpg >= 28 && ppg >= 24 && bpm >= 4) floor = Math.max(floor, 92);
  if (gp >= 40 && mpg >= 28 && ppg >= 23) floor = Math.max(floor, 90);
  if (gp >= 30 && mpg >= 28 && ppg >= 17 && apg >= 5) floor = Math.max(floor, 81);
  if (gp >= 40 && mpg >= 30 && ppg >= 22) floor = Math.max(floor, 85);
  if (gp >= 30 && mpg >= 20 && ppg >= 8) floor = Math.max(floor, 73);
  if (gp >= 20 && mpg >= 25 && ppg >= 20 && usage >= 25) floor = Math.max(floor, 84);
  if (gp >= 30 && mpg >= 24 && ppg >= 14 && rpg >= 7 && bpm >= 2.5) floor = Math.max(floor, 80);
  if (gp >= 35 && mpg >= 24 && apg >= 6) floor = Math.max(floor, 75);
  if (gp >= 10) floor = Math.max(floor, 67);

  let boosted = Math.max(blended, floor);

  // A high-minute, efficient two-way wing should not be capped merely because
  // his usage is below a heliocentric threshold. Kobe's 1999-00 season is the
  // motivating case: 38.2 MPG, 21.1 PPG, 19.1 PER, and +3.2 BPM at 26.1% usage.
  // This is a mechanism-based production floor, not a player-name override.
  //
  // Big vs wing uses the height heuristic: the raw NBA roster position label is
  // unreliable for eras past (Duncan is listed as an SF), and a big-profile
  // player must not fall into the wing scoring caps. The ladder below is what
  // keeps the band sane — a big-profile wing such as Marion is capped by the
  // same ladder instead of escaping every cap.
  const isBig = isBigProfile(position, heightInches);
  const twoWayStar =
    !isBig && gp >= 50 && mpg >= 34 && ppg >= 20 && usage >= 24 && per >= 18 && bpm >= 2.5;
  if (twoWayStar) boosted = Math.max(boosted, 88);

  // Primary creators can carry elite offensive value without a high shot
  // volume. Reward sustained, efficient playmaking so pass-first stars are not
  // treated as ordinary low-usage players (Magic's 1990-91 season is the
  // motivating case: 12.5 APG, 62.3% TS, and 21.8 PER at 20.5% usage).
  const primaryCreator =
    !isBig && gp >= 50 && mpg >= 30 && apg >= 8 && usage >= 18 && per >= 18 && tsPct >= 0.58;
  if (primaryCreator) boosted = Math.max(boosted, 91);

  // --- Big-man profile caps (matches TS) ---
  // The cap ladder is games-played aware so a brilliant half-season cannot
  // reach the all-time band. 25+ ppg bigs previously escaped every cap and
  // could tie the absolute peaks (Cousins 2017-18 reached 100 in 48 games).
  if (isBig) {
    // A high scoring season is not automatically an elite season. The old
    // ladder let ordinary high-volume historical bigs reach 95+ because the
    // ppg branch ignored efficiency and impact.
    const eliteBigImpact =
      per >= 23 || (bpm >= 5 && per >= 22) || (per >= 20 && tsPct >= 0.58 && bpm >= 2);
    if (ppg >= 25) {
      boosted = Math.min(boosted, eliteBigImpact ? (gp >= 55 ? 97 : 92) : gp >= 55 ? 92 : 89);
    } else if (usage >= 28) {
      boosted = Math.min(boosted, 91);
    } else if (ppg < 12) {
      boosted = Math.min(boosted, 82);
    } else if (ppg < 17) {
      // Strong defensive impact can raise a low-volume big, but should
      // not let inflated raw attributes reach the star band on their own.
      boosted = Math.min(boosted, bpm >= 3 ? 86 : 83);
    } else if (ppg < 20) {
      boosted = Math.min(boosted, bpm >= 3 ? 88 : 82);
    } else if (ppg < 23) {
      boosted = Math.min(boosted, eliteBigImpact ? 91 : 88);
    } else {
      boosted = Math.min(boosted, eliteBigImpact ? 94 : 90);
    }
  }

  // --- High-usage non-big caps (matches TS) ---
  if (!isBig && usage >= 28 && bpm < 3) {
    let cap: number;
    if (bpm < 0) cap = 82;
    else if (gp < 30 && ppg >= 22) cap = 89;
    else if (ppg >= 24 && tsPct >= 0.58) cap = 88;
    else cap = 87;
    boosted = Math.min(boosted, cap);
  }

  if (!isBig && ppg >= 18 && ppg < 23 && usage >= 24 && bpm < 1.5) {
    boosted = Math.min(boosted, ppg >= 22 ? 83 : 82);
  }

  if (!isBig && ppg >= 20 && usage < 28 && bpm < 2.5 && !twoWayStar) {
    boosted = Math.min(boosted, 87);
  }

  if (!isBig && ppg >= 20 && ppg < 25 && usage < 28) {
    boosted = Math.min(boosted, 89);
  }

  if (!isBig && ppg >= 20 && usage < 26 && bpm < 1.5) {
    boosted = Math.min(boosted, 82);
  }

  // High-usage guards/wings at 25+ ppg previously escaped every wing cap too
  // (Maxey 2025-26 reached 95 without the impact metrics of the all-time band).
  if (!isBig && ppg >= 25) {
    if (gp < 55) boosted = Math.min(boosted, 90);
    else if (bpm >= 4) boosted = Math.min(boosted, 96);
    else if (bpm >= 3) boosted = Math.min(boosted, 93);
    else boosted = Math.min(boosted, 90);
  }

  // A regular-minute season with weak overall impact should not remain in the
  // upper-80s solely because the derived skill profile is broad. Apply a
  // smooth, position-neutral penalty so low-impact role players separate
  // naturally instead of collapsing onto one hard cap.
  const lowImpactRotation = gp >= 40 && mpg >= 20 && ppg < 16 && per < 14 && bpm < 1;
  // A low-minute reserve with very little production and negative impact should
  // not inherit a starter-level overall from broad derived skills. Apply a
  // smooth penalty from the size of the statistical shortfall; there is no
  // hard ceiling, and useful bench specialists are left alone.
  const lowImpactBench = gp >= 40 && mpg < 20 && ppg < 8 && per < 10 && bpm < 0;
  const lowImpactBenchPenalty = lowImpactBench
    ? Math.round(
        Math.max(0, 8 - ppg) * 0.8 +
          Math.max(0, 10 - per) * 0.9 +
          Math.max(0, -bpm) * 1.1 +
          Math.max(0, 20 - mpg) * 0.25,
      )
    : 0;

  // --- Final boost (matches TS) ---
  // Reduced so the top of the distribution is no longer lifted 2-6 points on
  // top of the capped blend; the all-time band now sits at 97-99 instead of
  // saturating at 100, while the 96-cluster role players fall below the stars.
  let finalBoost: number;
  if (boosted < 65) {
    finalBoost = 5.0;
  } else if (boosted < 72) {
    finalBoost = 4.0;
  } else if (boosted < 78) {
    finalBoost = 3.0;
  } else if (boosted < 85) {
    finalBoost = 2.0;
  } else {
    finalBoost = 1.0;
  }

  let finalOverall = clampRating(boosted + finalBoost);
  if (lowImpactRotation) {
    const impactPenalty = Math.round(Math.max(0, (14 - per) * 0.5 + (1 - bpm)));
    finalOverall = Math.max(0, finalOverall - impactPenalty);
  }
  if (lowImpactBench) finalOverall = Math.max(0, finalOverall - lowImpactBenchPenalty);
  return finalOverall;
}
