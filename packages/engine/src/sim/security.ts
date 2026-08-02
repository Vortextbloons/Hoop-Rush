import type {
  EraSimulationProfile,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import type { Rng } from './rng.js';
import { ENGINE_CONSTANTS } from './constants.js';

/**
 * Ball security versus defensive pressure resolves turnovers and optional
 * steals (spec/03 pipeline stage 3). Turnover probability is anchored to the
 * era's turnover-per-possession baseline: a handler at the population-mean
 * reference converts at the era rate, and player turnover tendency, ball
 * handling, passing, and defensive pressure move the probability in bounded
 * steps. Era differences therefore flow through the model instead of living
 * in a hardcoded intercept.
 */

/** Defensive pressure for one defender: perimeter, steal, and IQ blend. */
export function defenderPressure(defender: SimulationPlayer): number {
  return (
    (defender.ratings.perimeterDefense * 0.5 +
      defender.ratings.steal * 0.3 +
      defender.ratings.defensiveIq * 0.2) /
    100
  );
}

/** Turnover probability for a ball handler against a five-man defense. */
export function turnoverProbability(
  handler: SimulationPlayer,
  defense: SimulationTeam,
  profile: EraSimulationProfile,
): number {
  const eraBase = profile.parameters.turnoverPerPossession;
  const c = ENGINE_CONSTANTS;
  const tendency = handler.tendencies.turnoverRate / 100;
  const pressure =
    defense.players.reduce((sum, d) => sum + defenderPressure(d), 0) / defense.players.length;
  const handling = (handler.ratings.ballHandling - 50) / 50;
  const passing = (handler.ratings.passing - 50) / 100;
  const raw =
    eraBase +
    (tendency - c.turnoverNeutralTendency) * c.turnoverTendencyWeight +
    (pressure - c.turnoverNeutralPressure) * c.turnoverPressureWeight -
    (handling - c.turnoverNeutralHandling) * c.turnoverHandlingWeight -
    (passing - c.turnoverNeutralPassing) * c.turnoverPassingWeight;
  return Math.min(c.turnoverMax, Math.max(c.turnoverMin, raw));
}

/** Whether a turnover is credited as an opponent steal (player-ability aware). */
export function isSteal(rng: Rng, defense: SimulationTeam, profile: EraSimulationProfile): boolean {
  const stealAbility =
    defense.players.reduce((sum, d) => sum + d.ratings.steal, 0) / defense.players.length;
  const p = profile.parameters.stealShareOfTurnovers * (0.5 + (stealAbility - 50) / 100);
  return rng.chance(Math.min(0.9, Math.max(0.1, p)));
}

/** Credits the stealer, weighted by steal rating. */
export function pickStealer(defense: SimulationTeam, rng: Rng): SimulationPlayer {
  return rng.weightedPick(
    defense.players,
    defense.players.map((d) => Math.max(0.5, d.ratings.steal)),
  );
}
