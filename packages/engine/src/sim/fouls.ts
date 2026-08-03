import type {
  EraSimulationProfile,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import type { Rng } from './rng.js';
import { ENGINE_CONSTANTS } from './constants.js';
import { isThreePointZone } from './usage.js';

/**
 * Shooting and non-shooting fouls, period team bonus, and free throws
 * (spec/03 pipeline stages 6-7). No foul-outs and no rating penalties in
 * sandbox v1; the era foul rate is anchored to the profile so the league
 * distribution follows the packaged targets.
 */

/**
 * Probability a shot attempt draws a shooting foul. The player's observed
 * free-throw-attempt rate (relative to the era's FTA/FGA) anchors the draw
 * factor alongside the free-throw-rate tendency, so elite draw-foul players
 * get credited near their real free-throw volume instead of the tendency
 * alone. At the population mean the anchor is 1, preserving the era foul
 * rate.
 */
export function shootingFoulProbability(
  shooter: SimulationPlayer,
  defender: SimulationPlayer,
  zone: ShotZone,
  profile: EraSimulationProfile,
): number {
  const p = profile.parameters;
  const base = p.foulsPerPossession * p.shootingFoulShare * ENGINE_CONSTANTS.shootingFoulScale;
  const tendencyFactor = 0.5 + shooter.tendencies.freeThrowRate / 100;
  const observedRate = shooter.anchors?.freeThrowAttemptRate;
  const anchorFactor =
    observedRate === undefined
      ? 1
      : Math.min(1.8, Math.max(0.4, observedRate / Math.max(1e-9, p.leagueFtaPerFga)));
  const drawsFouls =
    tendencyFactor * (1 - ENGINE_CONSTANTS.observedFoulDrawBlend) +
    anchorFactor * ENGINE_CONSTANTS.observedFoulDrawBlend;
  const zoneFactor = zone === 'rim' ? 1.4 : isThreePointZone(zone) ? 0.7 : 1;
  const discipline = 1 - (defender.ratings.defensiveIq - 50) / 200;
  return Math.min(0.25, Math.max(0.01, base * drawsFouls * zoneFactor * discipline));
}

/** Probability a defensive possession draws a non-shooting foul. */
export function nonShootingFoulProbability(profile: EraSimulationProfile): number {
  const p = profile.parameters;
  return Math.min(0.3, Math.max(0.01, p.foulsPerPossession * (1 - p.shootingFoulShare)));
}

/** Fouler weights for a team, in team index order (interior activity and matchup). */
export function foulerWeights(defense: SimulationTeam): number[] {
  return defense.players.map((d) =>
    Math.max(0.5, (d.ratings.strength + d.ratings.interiorDefense) / 2),
  );
}

/** The fouler against precomputed fouler weights. */
export function pickFouler(
  players: readonly SimulationPlayer[],
  weights: readonly number[],
  rng: Rng,
): SimulationPlayer {
  return rng.weightedPick(players, weights);
}

/** Free-throw shooter weights for a team, in team index order. */
export function freeThrowShooterWeights(team: SimulationTeam): number[] {
  return team.players.map(
    (p) => Math.max(0.5, p.tendencies.freeThrowRate) * (0.6 + 0.8 * (p.ratings.freeThrow / 100)),
  );
}

/**
 * Free-throw shooter on bonus free throws: players who draw trips and shoot
 * well from the line get the attempts (deterministic role behavior).
 */
export function pickFreeThrowShooter(
  players: readonly SimulationPlayer[],
  weights: readonly number[],
  rng: Rng,
): SimulationPlayer {
  return rng.weightedPick(players, weights);
}

/** Number of free throws awarded for a shooting foul at a zone (plus and-one handled by caller). */
export function freeThrowsForZone(zone: ShotZone): number {
  return isThreePointZone(zone) ? 3 : 2;
}

/**
 * Free-throw conversion anchored to the league rate: a player at the
 * population anchor rating converts at leagueFtPct; higher free-throw ratings
 * convert better.
 */
export function freeThrowProbability(
  shooter: SimulationPlayer,
  profile: EraSimulationProfile,
): number {
  const anchor = profile.parameters.freeThrowAnchorRating;
  const factor = shooter.ratings.freeThrow / Math.max(1, anchor);
  const ratingProbability = profile.parameters.leagueFtPct * factor;
  const observedProbability = shooter.anchors?.freeThrowPct;
  const probability =
    observedProbability === undefined
      ? ratingProbability
      : observedProbability * ENGINE_CONSTANTS.observedFreeThrowBlend +
        ratingProbability * (1 - ENGINE_CONSTANTS.observedFreeThrowBlend);
  return Math.min(0.97, Math.max(0.1, probability));
}
