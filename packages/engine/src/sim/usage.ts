import type {
  EraSimulationProfile,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import type { Rng } from './rng.js';
import { ENGINE_CONSTANTS } from './constants.js';
import { creationScore, interiorScoringScore, spacingScore } from '../domain/archetypes.js';

/**
 * Usage, creation, passing, and action tendencies select the initiator,
 * action, shooter, zone, and potential assister (spec/03 pipeline stages 2-3).
 * All weights are player tendencies and transferable-ability ratings; no
 * summary Overall rating is consulted. Creation and spacing scores modulate
 * the raw tendency weights so role hierarchies (primary creator, floor
 * spacer, rim finisher) measurably shape who ends possessions.
 */

export type ActionType =
  'isolation' | 'pickAndRoll' | 'pickAndRollRoll' | 'postUp' | 'spotUp' | 'cut' | 'transition';

export const ACTION_TYPES: readonly ActionType[] = [
  'isolation',
  'pickAndRoll',
  'pickAndRollRoll',
  'postUp',
  'spotUp',
  'cut',
  'transition',
];

export interface ShotSelection {
  shooter: SimulationPlayer;
  initiator: SimulationPlayer;
  /** Whether the possession produced a pass before the shot. */
  passed: boolean;
}

/**
 * Initiation weight: usage tendency scaled by creation ability, with a
 * bounded creation-burden bonus for high-usage initiators on weak-creating
 * lineups (their teammates cannot initiate instead, so the offense leans on
 * them). The usage exponent is deliberately soft (1.1): a high-usage creator
 * concentrates possession starts without monopolizing every possession
 * class, so usage is not double-counted through initiation and catch-and-
 * shoot pull. All deterministic and bounded to keep matchups meaningful.
 */
export function initiatorWeight(player: SimulationPlayer, team: SimulationTeam): number {
  const usage = Math.max(0.5, player.tendencies.usageRate);
  const usagePower = Math.pow(usage / 10, ENGINE_CONSTANTS.usageExponent);
  const creationMod = 0.75 + 0.5 * creationScore(player);
  return usagePower * creationMod * creationBurden(player, team);
}

/** Bounded (1.08..1.2) burden shift for the highest-usage creators. */
export function creationBurden(player: SimulationPlayer, team: SimulationTeam): number {
  if (player.tendencies.usageRate < 25) return 1;
  const teammates = team.players.filter((p) => p.playerId !== player.playerId);
  if (teammates.length === 0) return 1;
  const theirCreation = teammates.reduce((sum, p) => sum + creationScore(p), 0) / teammates.length;
  const shortfall = Math.min(1, Math.max(0, (0.6 - theirCreation) / 0.3));
  return 1 + Math.min(0.2, 0.08 + 0.12 * shortfall);
}

/** Selects the possession initiator, weighted by creation-scaled usage. */
export function pickInitiator(team: SimulationTeam, rng: Rng): SimulationPlayer {
  return rng.weightedPick(
    team.players,
    team.players.map((p) => initiatorWeight(p, team)),
  );
}

/** Spacing weight for catch-and-shoot targets (0.55..1.45 around the shotRate). */
export function spacingWeight(player: SimulationPlayer): number {
  return 0.55 + 0.9 * spacingScore(player);
}

/**
 * Shot responsibility on passed possessions. The band is intentionally
 * narrow: catch-and-shoot selection is driven by shot volume, spacing, and
 * the pass location (the action type), not by usage concentration. Usage
 * already shapes initiation; applying it again here made stars absorb every
 * possession class and inflated extreme scoring lines.
 */
export function usagePull(player: SimulationPlayer): number {
  return 0.8 + 0.2 * Math.min(1, player.tendencies.usageRate / 36);
}

/**
 * Selects the play type from the initiator's action tendencies. Speed raises
 * the transition rate: faster lineups run more (physical trait mechanism).
 * High-usage initiators run ball-dominant actions (isolation, pick-and-roll,
 * post-up) at a higher rate: their shot responsibilities come from creation,
 * not spot-up volume.
 */
export function pickAction(initiator: SimulationPlayer, rng: Rng): ActionType {
  const t = initiator.tendencies;
  const ballDominance = Math.min(1, t.usageRate / 36);
  const transitionWeight = t.transitionRate * (0.5 + initiator.ratings.speed / 100);
  const iso = t.isolationRate * (1 + 0.6 * ballDominance);
  const pnr = t.pickAndRollBallHandlerRate * (1 + 0.5 * ballDominance);
  const post = t.postUpRate * (1 + 0.4 * ballDominance);
  const passiveScale = 1 - 0.3 * ballDominance;
  return rng.weightedPick(ACTION_TYPES, [
    iso,
    pnr,
    t.pickAndRollRollManRate,
    post,
    t.spotUpRate * passiveScale,
    t.cutRate * passiveScale,
    transitionWeight * passiveScale,
  ]);
}

/** Probability that an action produces a pass before the shot. */
export function passProbability(initiator: SimulationPlayer, action: ActionType): number {
  const actionBase =
    action === 'spotUp' || action === 'cut' || action === 'transition'
      ? 0.9
      : action === 'pickAndRollRoll'
        ? 0.78
        : action === 'pickAndRoll'
          ? 0.62
          : action === 'postUp'
            ? 0.28
            : 0.2;
  const passingFactor =
    0.65 + initiator.tendencies.passRate / 100 + creationScore(initiator) * 0.15;
  const creationFactor = 1.1 - initiator.tendencies.usageRate / 200;
  return Math.min(
    0.97,
    Math.max(0.05, actionBase * 1.2 * passingFactor * Math.max(0.7, creationFactor)),
  );
}

/**
 * Selects the shooter. Spot-up, cut, and transition possessions pass toward a
 * teammate; isolation, pick-and-roll, and post-up end with the initiator.
 * Catch-and-shoot targets are weighted by shot volume times spacing, so
 * floor spacers draw the perimeter looks.
 */
export function pickShooter(
  team: SimulationTeam,
  initiator: SimulationPlayer,
  action: ActionType,
  rng: Rng,
): SimulationPlayer {
  if (action === 'spotUp' || action === 'cut' || action === 'transition') {
    return rng.weightedPick(
      team.players,
      team.players.map((p) =>
        p.playerId === initiator.playerId
          ? 0.35
          : Math.max(0.3, p.tendencies.shotRate * spacingWeight(p) * usagePull(p)),
      ),
    );
  }
  if (action === 'pickAndRollRoll') {
    return rng.weightedPick(
      team.players,
      team.players.map((p) =>
        p.playerId === initiator.playerId
          ? 0.5
          : Math.max(0.5, p.tendencies.pickAndRollRollManRate) *
            (0.6 + 0.8 * interiorScoringScore(p)),
      ),
    );
  }
  return initiator;
}

/** Selects whether the initiator passes and, if so, a teammate shooter. */
export function pickShot(
  team: SimulationTeam,
  initiator: SimulationPlayer,
  action: ActionType,
  rng: Rng,
): ShotSelection {
  if (!rng.chance(passProbability(initiator, action))) {
    return { shooter: initiator, initiator, passed: false };
  }
  const teammates = team.players.filter((p) => p.playerId !== initiator.playerId);
  if (teammates.length === 0) return { shooter: initiator, initiator, passed: false };
  const weights = teammates.map((p) =>
    action === 'pickAndRollRoll'
      ? Math.max(0.5, p.tendencies.pickAndRollRollManRate) * (0.6 + 0.8 * interiorScoringScore(p))
      : Math.max(0.3, p.tendencies.shotRate * spacingWeight(p) * usagePull(p)),
  );
  return { shooter: rng.weightedPick(teammates, weights), initiator, passed: true };
}

/** Selects a plausible passer while preventing self-assists. */
export function pickAssister(
  team: SimulationTeam,
  shooter: SimulationPlayer,
  initiator: SimulationPlayer,
  rng: Rng,
): SimulationPlayer | null {
  const candidates = team.players.filter((p) => p.playerId !== shooter.playerId);
  if (candidates.length === 0) return null;
  const weights = candidates.map((p) => {
    const observedCreation = p.anchors?.assistsPerGame;
    const roleWeight =
      observedCreation === undefined
        ? Math.max(0.5, p.tendencies.passRate / 5)
        : Math.max(0.5, observedCreation + 1);
    const passingWeight = 0.7 + p.ratings.passing / 100;
    const creationMod = 0.75 + 0.5 * creationScore(p);
    const initiatorBonus = p.playerId === initiator.playerId ? 1.35 : 1;
    return roleWeight * passingWeight * creationMod * initiatorBonus;
  });
  return rng.weightedPick(candidates, weights);
}

/** Weight profile for a defender based on zone and position matchup. */
function defenderWeight(
  defender: SimulationPlayer,
  shooter: SimulationPlayer,
  zone: ShotZone,
): number {
  const positionMatch = defender.positions.some((p) => shooter.positions.includes(p)) ? 1.35 : 1;
  const zoneRating =
    zone === 'rim' || zone === 'shortMid'
      ? defender.ratings.interiorDefense
      : zone === 'longMid'
        ? (defender.ratings.interiorDefense + defender.ratings.perimeterDefense) / 2
        : defender.ratings.perimeterDefense;
  const ability = Math.max(0.25, (zoneRating - 45) / 35);
  return positionMatch * ability;
}

/** Selects the primary defender, favoring matchups and zone-relevant defense. */
export function pickDefender(
  team: SimulationTeam,
  shooter: SimulationPlayer,
  zone: ShotZone,
  rng: Rng,
): SimulationPlayer {
  return rng.weightedPick(
    team.players,
    team.players.map((d) => defenderWeight(d, shooter, zone)),
  );
}

const ZONES: readonly ShotZone[] = ['rim', 'shortMid', 'longMid', 'cornerThree', 'aboveBreakThree'];

/**
 * Target three-point share for one player, from the recorded season volume
 * when available. Three rules keep era growth honest:
 *
 * - No observed three-point attempts: the player never shoots threes. Era
 *   three-point growth must not manufacture a jump shot for a center.
 * - Very low observed volume: the observed rate stays, era growth adds only
 *   a tightly capped share.
 * - Established volume: the observed share anchors, and era growth moves the
 *   residual in bounded steps.
 *
 * Players without anchors (authored opponents, fixtures) fall back to the
 * threePointRate tendency blended toward the era rate.
 */
export function threePointTarget(shooter: SimulationPlayer, profile: EraSimulationProfile): number {
  const f = shooter.tendencies;
  const eraThreeRate = profile.parameters.league3PARate;
  const observedRate = shooter.anchors?.threePointAttemptRate;
  const observedPct = shooter.anchors?.threePointPct;
  if (observedRate === undefined) {
    return Math.min(
      0.65,
      Math.max(
        0.01,
        (f.threePointRate / 100) * ENGINE_CONSTANTS.threePointRateWeight +
          eraThreeRate * (1 - ENGINE_CONSTANTS.threePointRateWeight),
      ),
    );
  }
  if (observedPct === null || observedRate < ENGINE_CONSTANTS.threePointEvidenceMinimum) {
    return 0;
  }
  if (observedRate < ENGINE_CONSTANTS.threePointLowVolumeThreshold) {
    return Math.min(
      ENGINE_CONSTANTS.threePointLowVolumeCap,
      Math.max(0, observedRate + eraThreeRate * ENGINE_CONSTANTS.threePointLowVolumeEraPull),
    );
  }
  return Math.min(
    0.65,
    Math.max(
      0.01,
      observedRate * (1 - ENGINE_CONSTANTS.threePointEraPull) +
        eraThreeRate * ENGINE_CONSTANTS.threePointEraPull,
    ),
  );
}

/**
 * Blended five-zone shot weights for a player before three-point volume
 * rescaling and play-type pulls: the player's frequency tendencies blended
 * with the era zone mix. Shared by pickZone (which then applies the
 * three-point evidence gates and action pulls) and by the two-point
 * efficiency anchor in shooting.ts, so the anchor's expected conversion is
 * computed against the exact mix the sim actually shoots instead of the raw
 * tendency mix.
 */
export function blendedZoneWeights(
  shooter: SimulationPlayer,
  profile: EraSimulationProfile,
): number[] {
  const f = shooter.tendencies;
  const eraMix = profile.parameters.zoneMix;
  const tendencyWeights = [
    f.rimFrequency,
    f.shortMidFrequency,
    f.longMidFrequency,
    f.cornerThreeFrequency,
    f.aboveBreakThreeFrequency,
  ];
  const tendencyTotal = tendencyWeights.reduce((sum, value) => sum + value, 0);
  const tendencyMix = tendencyWeights.map((value) => value / Math.max(1e-9, tendencyTotal));
  const eraWeights = [
    eraMix.rim,
    eraMix.shortMid,
    eraMix.longMid,
    eraMix.cornerThree,
    eraMix.aboveBreakThree,
  ];
  const blend = ENGINE_CONSTANTS.eraZoneMixBlend;
  return eraWeights.map((value, index) => value * (1 - blend) + (tendencyMix[index] ?? 0) * blend);
}

/**
 * Normalized two-point (rim / short-mid / long-mid) share of the blended
 * zone mix. These are the exact relative two-point weights pickZone uses:
 * the three-point rescaling and play-type pulls scale all two-point zones
 * by the same factor, so the proportions are identical.
 */
export function twoPointZoneShares(
  shooter: SimulationPlayer,
  profile: EraSimulationProfile,
): [number, number, number] {
  const weights = blendedZoneWeights(shooter, profile);
  const total = (weights[0] ?? 0) + (weights[1] ?? 0) + (weights[2] ?? 0) || 1;
  return [
    (weights[0] ?? 0) / Math.max(1e-9, total),
    (weights[1] ?? 0) / Math.max(1e-9, total),
    (weights[2] ?? 0) / Math.max(1e-9, total),
  ];
}

/**
 * Selects the shot zone from the shooter's frequency tendencies, blended
 * toward the era's three-point rate and modulated by three-point tendency.
 */
export function pickZone(
  shooter: SimulationPlayer,
  action: ActionType,
  profile: EraSimulationProfile,
  rng: Rng,
): ShotZone {
  const weights = blendedZoneWeights(shooter, profile);

  // Historical three-point volume is a strong role anchor (see
  // threePointTarget): the era rate never manufactures a jump shot.
  const targetThreeRate = threePointTarget(shooter, profile);
  const currentThree = (weights[3] ?? 0) + (weights[4] ?? 0);
  const currentTwo = Math.max(
    1e-9,
    weights.reduce((sum, value, index) => (index < 3 ? sum + value : sum), 0),
  );
  const targetTwoRate = 1 - targetThreeRate;
  const threeScale = targetThreeRate / Math.max(1e-9, currentThree);
  const twoScale = targetTwoRate / currentTwo;
  for (let index = 0; index < weights.length; index += 1) {
    weights[index] = (weights[index] ?? 0) * (index < 3 ? twoScale : threeScale);
  }

  // Play-type zone pulls stay modest so they refine the shot profile instead
  // of dragging the whole league toward the paint.
  weights[0] = (weights[0] ?? 0) * (action === 'transition' ? 1.1 : action === 'postUp' ? 1.02 : 1);
  weights[1] = (weights[1] ?? 0) * (action === 'postUp' ? 1.05 : 1);
  return rng.weightedPick(ZONES, weights);
}

/** Whether a zone is worth three points. */
export function isThreePointZone(zone: ShotZone): boolean {
  return zone === 'cornerThree' || zone === 'aboveBreakThree';
}

/** Zone-based skill rating the shooter brings to a shot. */
export function zoneSkillRating(player: SimulationPlayer, zone: ShotZone): number {
  switch (zone) {
    case 'rim':
      return player.ratings.insideScoring;
    case 'shortMid':
      return player.ratings.closeShot;
    case 'longMid':
      return player.ratings.midrange;
    case 'cornerThree':
    case 'aboveBreakThree':
      return player.ratings.threePoint;
  }
}
