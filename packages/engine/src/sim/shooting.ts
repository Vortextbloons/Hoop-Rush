import type {
  EraSimulationProfile,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import { ENGINE_CONSTANTS } from './constants.js';
import { isThreePointZone, zoneSkillRating, type ActionType } from './usage.js';

/**
 * Zone skill, defender selection, perimeter/interior pressure, and era
 * efficiency resolve shots and blocks (spec/03 pipeline stages 4-6). Era
 * baselines come from the profile; player skill and defensive contest move
 * the league base the same way for both teams. Lineup spacing and play-type
 * shot quality shift two-point conversion so lineup and action context
 * measurably matter.
 */

export interface ShotContext {
  zone: ShotZone;
  action: ActionType;
  secondsRemainingAtShot: number;
}

/**
 * Team spacing (0..1): three-point skill weighted by three-point volume
 * across the five-man lineup. High-spacing lineups open the paint; this is
 * the explicit lineup-interaction input into shot quality.
 */
export function teamSpacing(team: SimulationTeam): number {
  return (
    team.players.reduce((sum, p) => {
      const skill = p.ratings.threePoint / 100;
      const volume = p.tendencies.threePointRate / 100;
      return sum + skill * (0.4 + 0.6 * volume);
    }, 0) / team.players.length
  );
}

/** Play-type conversion bonus for a two-point attempt (0 when undefined). */
export function shotQualityBonus(action: ActionType, zone: ShotZone): number {
  const table = (
    ENGINE_CONSTANTS.shotQuality as Partial<Record<ActionType, Partial<Record<ShotZone, number>>>>
  )[action];
  return table?.[zone] ?? 0;
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
  offense: SimulationTeam,
  profile: EraSimulationProfile,
  context: ShotContext,
  periodSecondsRemaining: number,
): number {
  const threePointZone = isThreePointZone(context.zone);
  const observedThreePointPct = threePointZone ? shooter.anchors?.threePointPct : null;
  const base =
    observedThreePointPct === null || observedThreePointPct === undefined
      ? ENGINE_CONSTANTS.zoneBaseMake[context.zone]
      : observedThreePointPct * ENGINE_CONSTANTS.observedThreePointBlend +
        profile.targets.threePointPct.value * (1 - ENGINE_CONSTANTS.observedThreePointBlend);
  const skill =
    observedThreePointPct === null || observedThreePointPct === undefined
      ? ((zoneSkillRating(shooter, context.zone) - 70) / 30) * ENGINE_CONSTANTS.skillRange
      : ((zoneSkillRating(shooter, context.zone) - 70) / 100) * 0.05;
  const contest = -contestPenalty(defender, context.zone);
  const era =
    observedThreePointPct === null || observedThreePointPct === undefined
      ? (profile.parameters.leagueTsPct - 0.55) * ENGINE_CONSTANTS.eraEfficiencyWeight
      : 0;
  // Lineup spacing raises two-point conversion for spaced teams and
  // compresses it for clogged ones; three-pointers are unaffected.
  const spacing = threePointZone
    ? 0
    : (teamSpacing(offense) - 0.5) * ENGINE_CONSTANTS.spacingBonusScale;
  const quality = threePointZone ? 0 : shotQualityBonus(context.action, context.zone);
  const latePenalty =
    periodSecondsRemaining <= 4
      ? -(0.04 + Math.min(1, Math.max(0, (4 - periodSecondsRemaining) / 4)) * 0.06)
      : 0;
  return Math.min(
    0.97,
    Math.max(0.03, base + skill + contest + era + spacing + quality + latePenalty),
  );
}

/** Points for a made field goal at a zone. */
export function madePoints(zone: ShotZone): number {
  return isThreePointZone(zone) ? 3 : 2;
}
