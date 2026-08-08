import type {
  EraSimulationProfile,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import type { Rng } from './rng.ts';
import { ENGINE_CONSTANTS } from './constants.ts';

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

/**
 * Possession-estimates per trip for the era (FGA + 0.44*FTA + TOV per game
 * divided by trips per team game). Turnover tendencies are measured per
 * possession-estimate while the engine checks ball security once per trip,
 * so the blend in turnoverProbability converts the player tendency to the
 * per-trip convention with this ratio. Derived from the frozen era targets;
 * null when the targets cannot support it.
 */
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

/**
 * Turnover probability for a ball handler against a five-man defense. The
 * player's observed per-possession turnover tendency is the primary anchor
 * (turnoverObservedBlend) so a star handler converts near his own real rate
 * instead of the league mean; the era base pulls the residual. The tendency
 * is converted to the engine's per-trip convention so at the population mean
 * the blend reproduces the era turnover target exactly. Defensive pressure,
 * ball handling, and passing then move the probability in bounded steps
 * around the packaged pool population means.
 */
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

/**
 * Whether a turnover is credited as an opponent steal. The era's recorded
 * steal share of turnovers is the anchor: an average defensive team
 * (steal-rating neutral) converts turnovers into steals at exactly the era
 * share, and above-average ball pressure earns a bounded bonus.
 */
export function isSteal(rng: Rng, stealAbility: number, profile: EraSimulationProfile): boolean {
  const p =
    profile.parameters.stealShareOfTurnovers *
    (1 + (stealAbility - ENGINE_CONSTANTS.stealNeutralAbility) / 100);
  return rng.chance(Math.min(0.9, Math.max(0.3, p)));
}

/** Steal attribution weights for a team, in team index order. */
export function stealerWeights(defense: SimulationTeam): number[] {
  return defense.players.map((d) =>
    Math.max(0.5, d.ratings.steal * (0.6 + d.tendencies.stealAttemptRate / 20)),
  );
}

/** Credits the stealer against precomputed steal-rating weights. */
export function pickStealer(
  players: readonly SimulationPlayer[],
  weights: readonly number[],
  rng: Rng,
): SimulationPlayer {
  return rng.weightedPick(players, weights);
}
