import type {
  EraSimulationProfile,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import { ENGINE_CONSTANTS } from './constants.js';
import { isThreePointZone } from './usage.js';

/**
 * Shooting and non-shooting fouls, period team bonus, and free throws
 * (spec/03 pipeline stages 6-7). No foul-outs and no rating penalties in
 * sandbox v1; the era foul rate is anchored to the profile so the league
 * distribution follows the packaged targets.
 */

/** Probability a shot attempt draws a shooting foul. */
export function shootingFoulProbability(
  shooter: SimulationPlayer,
  defender: SimulationPlayer,
  zone: ShotZone,
  profile: EraSimulationProfile,
): number {
  const p = profile.parameters;
  const base = p.foulsPerPossession * p.shootingFoulShare * ENGINE_CONSTANTS.shootingFoulScale;
  const drawsFouls = 0.5 + shooter.tendencies.freeThrowRate / 100;
  const zoneFactor = zone === 'rim' ? 1.4 : isThreePointZone(zone) ? 0.7 : 1;
  const discipline = 1 - (defender.ratings.defensiveIq - 50) / 200;
  return Math.min(0.25, Math.max(0.01, base * drawsFouls * zoneFactor * discipline));
}

/** Probability a defensive possession draws a non-shooting foul. */
export function nonShootingFoulProbability(profile: EraSimulationProfile): number {
  const p = profile.parameters;
  return Math.min(0.3, Math.max(0.01, p.foulsPerPossession * (1 - p.shootingFoulShare)));
}

/** The fouler, weighted slightly by interior activity and matchup. */
export function pickFouler(
  defense: SimulationTeam,
  rng: { weightedPick<T>(items: readonly T[], weights: readonly number[]): T },
): SimulationPlayer {
  return rng.weightedPick(
    defense.players,
    defense.players.map((d) => Math.max(0.5, (d.ratings.strength + d.ratings.interiorDefense) / 2)),
  );
}

/** Free-throw shooter, weighted by how often the player draws trips. */
export function pickFreeThrowShooter(
  team: SimulationTeam,
  rng: { weightedPick<T>(items: readonly T[], weights: readonly number[]): T },
): SimulationPlayer {
  return rng.weightedPick(
    team.players,
    team.players.map((p) => Math.max(0.5, p.tendencies.freeThrowRate)),
  );
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
  return Math.min(0.97, Math.max(0.1, profile.parameters.leagueFtPct * factor));
}
