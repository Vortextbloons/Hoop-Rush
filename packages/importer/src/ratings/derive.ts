/**
 * Detailed rating derivation (port of compute_ratings.py derive_ratings,
 * ported from the legacy playerRatingEngine.ts).
 */
import { clamp, clampRating, safeFloat, safeInt } from '../json.js';
import type { Rng } from '../rng.js';
import { getEra, MODERN_PPG } from './era.js';
import { computeOverall } from './weights.js';
import { computeRealOverall } from './summary.js';
import type { StatsRow } from './stats.js';

export const POS_MAP: Record<string, string> = {
  G: 'SG',
  F: 'SF',
  C: 'C',
  PG: 'PG',
  SG: 'SG',
  SF: 'SF',
  PF: 'PF',
};

export function mapPosition(raw: string): string {
  return POS_MAP[raw] ?? 'SF';
}

export function sampleWeight(minutes: number, games: number): number {
  const mw = Math.min(1, minutes / 1500);
  const gw = Math.min(1, games / 45);
  return 0.6 * mw + 0.4 * gw;
}

export function blendToMean(value: number, weight: number, mean: number): number {
  const w = clamp(weight, 0, 1);
  return value * w + mean * (1 - w);
}

export function deriveRatings(
  stats: StatsRow,
  position: string,
  season: string,
  rng: Rng,
  heightInches?: number | null,
): Record<string, number> {
  const era = getEra(season);
  const gp = safeInt(stats.gamesPlayed);
  const minutes = safeFloat(stats.minutes);

  if (gp === 0 || minutes === 0) {
    return defaultRatings(position, rng, heightInches);
  }

  const ppg = safeFloat(stats.points) / Math.max(1, gp);
  const rpg = safeFloat(stats.rebounds) / Math.max(1, gp);
  const apg = safeFloat(stats.assists) / Math.max(1, gp);
  const spg = safeFloat(stats.steals) / Math.max(1, gp);
  const bpg = safeFloat(stats.blocks) / Math.max(1, gp);
  const mpg = minutes / Math.max(1, gp);
  const tpa = safeFloat(stats.tpa);
  const tpm = safeFloat(stats.tpm);
  const fta = safeFloat(stats.fta);
  const ftm = safeFloat(stats.ftm);
  const tsPct = safeFloat(stats.tsPct);
  const efgPct = safeFloat(stats.efgPct);
  const per = safeFloat(stats.per);
  const bpm = safeFloat(stats.boxPlusMinus);
  const usage = safeFloat(stats.usageRate);

  const threePct = tpm / Math.max(1, tpa);
  const ftPct = ftm / Math.max(1, fta);

  // Era normalize PPG
  const ppgNorm = ppg * (MODERN_PPG / Math.max(1, era.leaguePpg));

  const weight = sampleWeight(minutes, gp);

  const blend = (raw: number, mean: number): number => blendToMean(raw, weight, mean);
  const jitter = (v: number, sigma = 1): number => v + rng.gauss(0, sigma);

  // Shooting
  const tsComponent = (tsPct - 0.5) * 60;
  const threeComponent = (threePct - 0.3) * 140;
  const ftComponent = (ftPct - 0.7) * 15;
  // Three-point skill is primarily shot-specific. The previous formula let
  // overall TS and free-throw shooting overwhelm the actual three-point
  // percentage, which turned ordinary wings into implausible 45% shooters.
  const threeRaw = 58 + tsComponent + threeComponent + ftComponent;

  // Keep the rating scale meaningful for poor-but-real free-throw shooters.
  // A 53% shooter should be a roughly 50-60 rating, never a rating of 4 that
  // later gets multiplied by the league percentage in the simulator.
  const freeThrowRaw = 50 + (ftPct - 0.5) * 120;

  // Playmaking
  const passRaw = 60 + (apg - 3) * 5 + per * 0.6;

  // Rebounding
  const rebRaw = 60 + (rpg - 4) * 5;
  const orebRaw = rebRaw * 0.7;
  const drebRaw = rebRaw * 1.1;

  // Defense
  const stock = (spg + bpg) * 7;
  const defRaw = 60 + stock + bpm * 1.8;

  // Inside scoring
  let insideRaw = 60 + (ppgNorm - 14) * 2.2 + tsPct * 35;
  if (position === 'C' || position === 'PF') insideRaw += 4;
  else if (position === 'PG' || position === 'SG') insideRaw -= 2;

  // Athleticism
  const ath = 60 + (usage - 18) * 0.5 + mpg * 0.5 + per * 0.7;

  const ratings: Record<string, number> = {
    insideScoring: clampRating(jitter(blend(insideRaw, 54))),
    closeShot: clampRating(jitter(blend(60 + (ppg - 10) * 1.5, 59))),
    midrange: clampRating(jitter(blend(60 + (efgPct - 0.48) * 100, 54))),
    threePoint: clampRating(jitter(blend(threeRaw, 54))),
    freeThrow: clampRating(jitter(blend(freeThrowRaw, 69))),
    ballHandling: clampRating(jitter(blend(60 + (usage - 16) * 0.8, 54))),
    passing: clampRating(jitter(blend(passRaw, 54))),
    offensiveIq: clampRating(jitter(blend(60 + per * 1.0 + bpm * 2.0, 59))),
    offensiveRebound: clampRating(jitter(blend(orebRaw, 45))),
    defensiveRebound: clampRating(jitter(blend(drebRaw, 59))),
    perimeterDefense: clampRating(jitter(blend(defRaw, 54))),
    interiorDefense: clampRating(
      jitter(
        blend(
          position === 'C' || position === 'PF' ? defRaw + 5 : defRaw - 3,
          position === 'C' || position === 'PF' ? 59 : 49,
        ),
      ),
    ),
    steal: clampRating(jitter(blend(60 + spg * 10, 54))),
    block: clampRating(jitter(blend(60 + bpg * 12, 49))),
    defensiveIq: clampRating(jitter(blend(60 + bpm * 2.0, 59))),
    speed: clampRating(jitter(blend(ath + (position === 'PG' ? 5 : 0), 59))),
    strength: clampRating(
      jitter(
        blend(
          position === 'C' || position === 'PF' ? ath + 5 : ath,
          position === 'C' || position === 'PF' ? 64 : 54,
        ),
      ),
    ),
    vertical: clampRating(jitter(blend(60 + (position === 'C' ? 5 : 0), 54))),
    stamina: clampRating(jitter(blend(60 + mpg * 1.0, 64))),
    durability: clampRating(jitter(blend(60 + gp * 0.5, 64))),
    clutch: clampRating(jitter(blend(60 + bpm * 0.8, 59))),
    consistency: clampRating(jitter(blend(60 + gp * 0.3, 59))),
  };

  // Potential: based on age + recent performance
  let age = safeInt(stats.age, 25) || 25;
  if (age <= 0) age = 25;
  let potentialRaw = Math.max(per, insideRaw) + 5;
  if (age < 24) potentialRaw += 5;
  else if (age > 30) potentialRaw -= 5;
  ratings['potential'] = clampRating(potentialRaw);

  ratings['overall'] = computeRealOverall(ratings, position, stats, heightInches);
  return ratings;
}

/** Replacement-level ratings for players with no stats. */
export function defaultRatings(
  position: string,
  rng: Rng,
  heightInches?: number | null,
): Record<string, number> {
  const base: Record<string, number> = {
    insideScoring: 50,
    closeShot: 50,
    midrange: 50,
    threePoint: 50,
    freeThrow: 60,
    ballHandling: 50,
    passing: 50,
    offensiveIq: 50,
    offensiveRebound: 50,
    defensiveRebound: 50,
    perimeterDefense: 50,
    interiorDefense: 50,
    steal: 50,
    block: 50,
    defensiveIq: 50,
    speed: 54,
    strength: 54,
    vertical: 54,
    stamina: 60,
    durability: 64,
    clutch: 50,
    consistency: 54,
    potential: 60,
  };
  if (position === 'C') {
    base['interiorDefense'] = 60;
    base['insideScoring'] = 54;
    base['vertical'] = 60;
  } else if (position === 'PG') {
    base['ballHandling'] = 60;
    base['passing'] = 60;
    base['speed'] = 64;
  }

  for (const [key, value] of Object.entries(base)) {
    base[key] = clampRating(value + rng.gauss(0, 1));
  }
  base['overall'] = computeOverall(base, position, heightInches);
  return base;
}
