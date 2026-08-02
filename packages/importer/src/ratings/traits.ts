/**
 * Trait derivation (port of compute_ratings.py derive_traits, archetype-based).
 */
import { clamp, clampRating, safeFloat } from '../json.js';
import type { Rng } from '../rng.js';
import type { StatsRow } from './stats.js';

export function deriveTraits(
  ratings: Record<string, number>,
  stats: StatsRow,
  position: string,
  rng: Rng,
): Record<string, number> {
  void position;
  const usage = safeFloat(stats.usageRate, 15) || 15;
  const gp = safeFloat(stats.gamesPlayed);
  const consistency = ratings['consistency'] ?? 55;
  const age = safeFloat(stats.age) || 25;
  const potential = ratings['potential'] ?? 60;

  const workEthic = clamp(50 + (gp / 82) * 10 + consistency * 0.2 + rng.gauss(0, 5), 20, 99);
  const loyalty = clamp(50 + rng.gauss(0, 10), 20, 99);
  const ego = clamp(50 + usage * 0.3 + rng.gauss(0, 8), 20, 99);
  const greed = clamp(50 + usage * 0.2 + rng.gauss(0, 6), 20, 99);
  const leadership = clamp(50 + (age - 22) * 0.8 + rng.gauss(0, 6), 20, 99);
  const coachability = clamp(50 + potential * 0.2 - ego * 0.1 + rng.gauss(0, 5), 20, 99);
  const injuryRisk = clamp(50 - (ratings['durability'] ?? 65) * 0.3 + rng.gauss(0, 8), 10, 99);
  const shotCreation = clampRating(60 + (usage - 18) * 0.8 + rng.gauss(0, 4));
  const defensiveVersatility = clampRating(
    60 + (ratings['defensiveIq'] ?? 55) * 0.3 + (ratings['steal'] ?? 50) * 0.2 + rng.gauss(0, 4),
  );

  return {
    workEthic: clampRating(workEthic),
    loyalty: clampRating(loyalty),
    ego: clampRating(ego),
    greed: clampRating(greed),
    leadership: clampRating(leadership),
    coachability: clampRating(coachability),
    injuryRisk: clampRating(injuryRisk),
    shotCreation,
    defensiveVersatility,
  };
}
