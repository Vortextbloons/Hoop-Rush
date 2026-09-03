import type {
  EraSimulationProfile,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import type { Rng } from './rng.ts';
import { ENGINE_CONSTANTS } from './constants.ts';
export function defenderPressure(defender: SimulationPlayer): number {
  return (
    (defender.ratings.perimeterDefense * 0.5 +
      defender.ratings.steal * 0.3 +
      defender.ratings.defensiveIq * 0.2) /
    100
  );
}
export function eraPossEstimatePerTrip(profile: EraSimulationProfile): number | null {
  const t = profile.targets;
  const fta = t.freeThrowsAttemptedPerGame.value;
  const tov = t.turnoversPerGame.value;
  const poss = t.possessionsPerGame.value;
  const ftPct = t.freeThrowPct.value;
  const fgPct = t.fieldGoalPct.value;
  const threeRate = t.threePointRate.value;
  const threePct = t.threePointPct.value;
  const points = t.pointsPerGame.value;
  const denom = 2 * fgPct + threeRate * threePct;
  if (poss <= 0 || denom <= 0) return null;
  const freeThrowMade = fta * ftPct;
  const fga = (points - freeThrowMade) / denom;
  const possEstimate = fga + 0.44 * fta + tov;
  return possEstimate / poss;
}
export function turnoverProbability(
  handler: SimulationPlayer,
  pressure: number,
  possEstimatePerTrip: number,
  profile: EraSimulationProfile,
  extraPressure = 0,
  effectsAdjustment = 0,
): number {
  const c = ENGINE_CONSTANTS;
  const eraBase = profile.parameters.turnoverPerPossession;
  const tendency = handler.tendencies.turnoverRate / 100;
  const tendencyPerTrip = tendency * possEstimatePerTrip;
  const handling = (handler.ratings.ballHandling - 50) / 50;
  const passing = (handler.ratings.passing - 50) / 100;
  const raw =
    eraBase * (1 - c.turnoverObservedBlend) +
    tendencyPerTrip * c.turnoverObservedBlend +
    (pressure - c.turnoverNeutralPressure) * c.turnoverPressureWeight -
    (handling - c.turnoverNeutralHandling) * c.turnoverHandlingWeight -
    (passing - c.turnoverNeutralPassing) * c.turnoverPassingWeight +
    extraPressure +
    effectsAdjustment -
    c.offensiveFoulTurnoverOffset;
  return Math.min(c.turnoverMax, Math.max(c.turnoverMin, raw));
}
export function isSteal(rng: Rng, stealAbility: number, profile: EraSimulationProfile): boolean {
  const p =
    profile.parameters.stealShareOfTurnovers *
    (1 + (stealAbility - ENGINE_CONSTANTS.stealNeutralAbility) / 100);
  return rng.chance(Math.min(0.9, Math.max(0.3, p)));
}
export function stealerWeights(defense: SimulationTeam): number[] {
  return defense.players.map((d) =>
    Math.max(0.5, d.ratings.steal * (0.6 + d.tendencies.stealAttemptRate / 20)),
  );
}
export function pickStealer(
  players: readonly SimulationPlayer[],
  weights: readonly number[],
  rng: Rng,
): SimulationPlayer {
  return rng.weightedPick(players, weights);
}
