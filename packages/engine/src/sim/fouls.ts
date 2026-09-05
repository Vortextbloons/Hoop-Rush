import type {
  EraSimulationProfile,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import { ENGINE_CONSTANTS } from './constants.ts';
import { finisherRole, isThreePointZone } from './usage.ts';
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
  const discipline =
    (1 - (defender.ratings.defensiveIq - 50) / 200) *
    (0.85 + Math.min(15, defender.tendencies.foulRate) / 50);
  return Math.min(0.25, Math.max(0.01, base * drawsFouls * zoneFactor * discipline));
}
export function nonShootingFoulProbability(profile: EraSimulationProfile): number {
  const p = profile.parameters;
  return Math.min(0.3, Math.max(0.01, p.foulsPerPossession * (1 - p.shootingFoulShare)));
}
export function foulerWeights(defense: SimulationTeam): number[] {
  return defense.players.map((d) =>
    Math.max(
      0.5,
      ((d.ratings.strength + d.ratings.interiorDefense) / 2) *
        (0.55 + Math.min(20, d.tendencies.foulRate) / 10),
    ),
  );
}
export function freeThrowShooterWeights(team: SimulationTeam): number[] {
  return team.players.map(
    (p) =>
      Math.max(0.5, p.tendencies.freeThrowRate) *
      (0.6 + 0.8 * (p.ratings.freeThrow / 100)) *
      finisherRole(p, team),
  );
}
export function freeThrowsForZone(zone: ShotZone): number {
  return isThreePointZone(zone) ? 3 : 2;
}
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
  return Math.min(0.97, Math.max(0.1, probability + ENGINE_CONSTANTS.freeThrowCalibrationOffset));
}
