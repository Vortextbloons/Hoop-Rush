/**
 * Tendency derivation (port of compute_ratings.py derive_tendencies).
 */
import { clamp, safeFloat } from '../json.js';
import type { Rng } from '../rng.js';
import type { StatsRow } from './stats.js';

const round2 = (v: number): number => Math.round(v * 100) / 100;

export function deriveTendencies(
  stats: StatsRow,
  ratings: Record<string, number>,
  position: string,
  rng: Rng,
): Record<string, number> {
  const gp = Math.max(1, safeFloat(stats.gamesPlayed) || 1);
  const ppg = safeFloat(stats.points) / gp;
  const fga = safeFloat(stats.fga);
  const tpa = safeFloat(stats.tpa);
  const fta = safeFloat(stats.fta);
  const tov = safeFloat(stats.turnovers);
  const apg = safeFloat(stats.assists) / gp;
  const usage = safeFloat(stats.usageRate, 15) || 15;

  const threeRate = (tpa / Math.max(1, fga)) * 100;
  const ftRate = (fta / Math.max(1, fga)) * 100;
  const possessionDenom = fga + 0.44 * fta + tov;
  const tovRate = possessionDenom > 0 ? (tov / Math.max(1, possessionDenom)) * 100 : 12;
  const passRate = (apg / Math.max(1, apg + ppg * 0.5 + 1)) * 40;

  const isBig = position === 'C' || position === 'PF';
  const isGuard = position === 'PG' || position === 'SG';

  const tendencies: Record<string, number> = {
    usageRate: clamp(usage + rng.gauss(0, 1), 10, 40),
    passRate: clamp(passRate + rng.gauss(0, 2), 2, 35),
    shotRate: clamp((fga / Math.max(1, gp) / 48) * 100 + rng.gauss(0, 2), 10, 50),
    driveRate: clamp(10 + (isGuard ? 8 : 0) + rng.gauss(0, 2), 5, 35),
    postUpRate: clamp(5 + (isBig ? 8 : 0) + rng.gauss(0, 2), 0, 30),
    rimFrequency: clamp(((ratings['insideScoring'] ?? 50) / 100) * 40 + rng.gauss(0, 3), 10, 50),
    shortMidFrequency: clamp(15 + rng.gauss(0, 2), 5, 30),
    longMidFrequency: clamp(10 + rng.gauss(0, 2), 0, 20),
    cornerThreeFrequency: clamp(
      ((ratings['threePoint'] ?? 50) / 100) * 15 + rng.gauss(0, 2),
      0,
      15,
    ),
    aboveBreakThreeFrequency: clamp(
      ((ratings['threePoint'] ?? 50) / 100) * 25 + rng.gauss(0, 2),
      5,
      30,
    ),
    // Do not invent three-point or free-throw volume for players whose
    // selected season had none. The era profile supplies a small prior in
    // the engine when the sample is genuinely missing, not when it is an
    // observed zero.
    threePointRate: tpa === 0 ? 0 : clamp(threeRate + rng.gauss(0, 3), 0, 60),
    freeThrowRate: fta === 0 ? 0 : clamp(ftRate + rng.gauss(0, 2), 0, 50),
    turnoverRate: clamp(tovRate + rng.gauss(0, 2), 5, 25),
    isolationRate: clamp(usage * 0.3 + rng.gauss(0, 2), 0, 35),
    pickAndRollBallHandlerRate: clamp(20 + (isGuard ? 15 : 0) + rng.gauss(0, 3), 5, 50),
    pickAndRollRollManRate: clamp(10 + (position === 'C' ? 15 : 0) + rng.gauss(0, 3), 0, 30),
    spotUpRate: clamp(20 + rng.gauss(0, 2), 5, 40),
    transitionRate: clamp(15 + rng.gauss(0, 2), 5, 30),
    cutRate: clamp(10 + rng.gauss(0, 2), 0, 25),
    foulRate: clamp(2 + rng.gauss(0, 0.5), 0, 6),
    stealAttemptRate: clamp(5 + (ratings['steal'] ?? 50) * 0.08 + rng.gauss(0, 1), 0, 12),
    blockAttemptRate: clamp(5 + (ratings['block'] ?? 50) * 0.08 + rng.gauss(0, 1), 0, 12),
    crashOffensiveGlassRate: clamp(
      10 + (ratings['offensiveRebound'] ?? 50) * 0.12 + rng.gauss(0, 2),
      0,
      25,
    ),
  };

  for (const [key, value] of Object.entries(tendencies)) {
    tendencies[key] = round2(value);
  }
  return tendencies;
}
