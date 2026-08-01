import type { EraSimulationProfile, ShotZone, SimulationPlayer } from '@hoop-rush/data-contracts';
import { ENGINE_CONSTANTS } from './constants.js';
import { isThreePointZone, zoneSkillRating, type ActionType } from './usage.js';

/**
 * Zone skill, defender selection, perimeter/interior pressure, and era
 * efficiency resolve shots and blocks (spec/03 pipeline stages 4-6). Era
 * baselines come from the profile; player skill and defensive contest move
 * the league base the same way for both teams.
 */

export interface ShotContext {
  zone: ShotZone;
  action: ActionType;
  secondsRemainingAtShot: number;
}

/** Defensive contest penalty for a shooter, zone-aware: interior pressure on
 * rim/close shots, perimeter pressure on threes, a blend in between. */
export function contestPenalty(defender: SimulationPlayer, zone: ShotZone): number {
  let contest: number;
  if (zone === 'rim' || zone === 'shortMid') {
    contest =
      defender.ratings.interiorDefense * 0.6 +
      defender.ratings.defensiveIq * 0.25 +
      defender.ratings.strength * 0.15;
  } else if (zone === 'longMid') {
    contest =
      defender.ratings.interiorDefense * 0.35 +
      defender.ratings.perimeterDefense * 0.35 +
      defender.ratings.defensiveIq * 0.3;
  } else {
    contest = defender.ratings.perimeterDefense * 0.6 + defender.ratings.defensiveIq * 0.4;
  }
  const ratio = Math.min(1, Math.max(0, (contest - 60) / 40));
  return ratio * ENGINE_CONSTANTS.contestMax;
}

/** Probability a shot is blocked, by zone and defender (V1 revalidated). */
export function blockProbability(
  defender: SimulationPlayer,
  zone: ShotZone,
  action: ActionType,
): number {
  const c = ENGINE_CONSTANTS;
  if (zone === 'rim') {
    const base = Math.min(
      c.blockRimMax,
      Math.max(0, ((defender.ratings.block - 40) / 60) * c.blockRimMax),
    );
    return base + (action === 'isolation' || action === 'pickAndRoll' ? c.blockDriveBonus : 0);
  }
  if (zone === 'shortMid') {
    return Math.min(
      c.blockMidMax,
      Math.max(0, ((defender.ratings.block - 50) / 50) * c.blockMidMax),
    );
  }
  return Math.min(
    c.blockThreeMax,
    Math.max(0, ((defender.ratings.perimeterDefense - 60) / 40) * c.blockThreeMax),
  );
}

/** Make probability for one shot attempt (clamped to basketball plausibility). */
export function makeProbability(
  shooter: SimulationPlayer,
  defender: SimulationPlayer,
  profile: EraSimulationProfile,
  context: ShotContext,
  periodSecondsRemaining: number,
): number {
  const base = ENGINE_CONSTANTS.zoneBaseMake[context.zone];
  const skill = ((zoneSkillRating(shooter, context.zone) - 70) / 30) * ENGINE_CONSTANTS.skillRange;
  const contest = -contestPenalty(defender, context.zone);
  const era = (profile.parameters.leagueTsPct - 0.55) * ENGINE_CONSTANTS.eraEfficiencyWeight;
  const latePenalty =
    periodSecondsRemaining <= 4
      ? -(0.04 + Math.min(1, Math.max(0, (4 - periodSecondsRemaining) / 4)) * 0.06)
      : 0;
  return Math.min(0.97, Math.max(0.03, base + skill + contest + era + latePenalty));
}

/** Points for a made field goal at a zone. */
export function madePoints(zone: ShotZone): number {
  return isThreePointZone(zone) ? 3 : 2;
}
