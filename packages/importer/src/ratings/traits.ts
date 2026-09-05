import { clamp, clampRating, safeFloat } from '../json.ts';
import type { StatsRow } from './stats.ts';
export function deriveTraits(
  ratings: Record<string, number>,
  stats: StatsRow,
  position: string,
  rng?: unknown,
): Record<string, number> {
  void position;
  void rng;
  const usage = safeFloat(stats.usageRate, 15) || 15;
  const gp = safeFloat(stats.gamesPlayed);
  const age = safeFloat(stats.age) || 25;
  const workEthic = clamp(50 + (gp / 82) * 10 + 55, 20, 99);
  const loyalty = 50;
  const ego = clamp(50 + usage * 0.3, 20, 99);
  const greed = clamp(50 + usage * 0.2, 20, 99);
  const leadership = clamp(50 + (age - 22) * 0.8, 20, 99);
  const coachability = clamp(50 + 60 * 0.2 - ego * 0.1, 20, 99);
  const injuryRisk = clamp(50 - 65 * 0.3, 10, 99);
  const shotCreation = clampRating(60 + (usage - 18) * 0.8);
  const defensiveVersatility = clampRating(
    60 + (ratings['defensiveIq'] ?? 55) * 0.3 + (ratings['steal'] ?? 50) * 0.2,
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
