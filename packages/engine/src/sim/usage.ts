import type {
  EraSimulationProfile,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import type { Rng } from './rng.ts';
import { ENGINE_CONSTANTS } from './constants.ts';
import { creationScore, interiorScoringScore, spacingScore } from '../domain/archetypes.ts';
import {
  sameGroupMatchWeight,
  type PositionResponsibilityModifiers,
} from './position-responsibilities.ts';

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
 * shoot pull. The assigned-slot initiation modifier (position-responsibilities)
 * nudges guards toward starting possessions and centers away from them; all
 * deterministic and bounded to keep matchups meaningful.
 */
export function initiatorWeight(
  player: SimulationPlayer,
  team: SimulationTeam,
  modifiers: PositionResponsibilityModifiers,
): number {
  const usage = Math.max(0.5, player.tendencies.usageRate);
  const usagePower = Math.pow(usage / 10, ENGINE_CONSTANTS.usageExponent);
  const creationMod = 0.75 + 0.5 * creationScore(player);
  return usagePower * creationMod * creationBurden(player, team) * modifiers.initiation;
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

/** Precomputed initiator weights for a team, in the team's immutable index order. */
export function teamInitiatorWeights(
  team: SimulationTeam,
  positionModifiers: ReadonlyMap<string, PositionResponsibilityModifiers>,
): number[] {
  return team.players.map((p) =>
    initiatorWeight(p, team, positionModifiers.get(p.playerId) ?? identityModifiers),
  );
}

/** Neutral modifiers (all 1) used when a team lacks a precomputed table. */
export const identityModifiers: PositionResponsibilityModifiers = {
  initiation: 1,
  pnrHandler: 1,
  rollMan: 1,
  postUp: 1,
  rebounding: 1,
  rimProtection: 1,
};

/** Selects the possession initiator against precomputed creation-scaled usage weights. */
export function pickInitiator(
  team: SimulationTeam,
  weights: readonly number[],
  rng: Rng,
): SimulationPlayer {
  return rng.weightedPick(team.players, weights);
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
 * Action tendency weights for one initiator (pure function of the player and
 * the assigned-slot responsibility modifiers). Speed raises the transition
 * rate: faster lineups run more (physical trait mechanism). High-usage
 * initiators run ball-dominant actions (isolation, pick-and-roll, post-up)
 * at a higher rate: their shot responsibilities come from creation, not
 * spot-up volume. The slot modifiers scale only the handler (pick-and-roll),
 * roll-man, and post-up weights, so a zero tendency stays zero: position
 * never manufactures an action.
 */
export function actionWeights(
  initiator: SimulationPlayer,
  modifiers: PositionResponsibilityModifiers,
): number[] {
  const t = initiator.tendencies;
  const ballDominance = Math.min(1, t.usageRate / 36);
  const transitionWeight = t.transitionRate * (0.5 + initiator.ratings.speed / 100);
  const iso = t.isolationRate * (1 + 0.6 * ballDominance);
  const pnr = t.pickAndRollBallHandlerRate * (1 + 0.5 * ballDominance) * modifiers.pnrHandler;
  const post = t.postUpRate * (1 + 0.4 * ballDominance) * modifiers.postUp;
  const passiveScale = 1 - 0.3 * ballDominance;
  return [
    iso,
    pnr,
    t.pickAndRollRollManRate * modifiers.rollMan,
    post,
    t.spotUpRate * passiveScale,
    t.cutRate * passiveScale,
    transitionWeight * passiveScale,
  ];
}

/** Selects the play type from the initiator's precomputed action weights. */
export function pickAction(
  initiator: SimulationPlayer,
  weights: readonly number[],
  rng: Rng,
): ActionType {
  return rng.weightedPick(ACTION_TYPES, weights);
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

/** Precomputed teammate shot weights for one initiator and action class. */
export interface TeammateShotWeights {
  teammates: SimulationPlayer[];
  weights: number[];
}

/** Roll and pass variants of the teammate shot weights for one initiator. */
export interface TeammateShots {
  roll: TeammateShotWeights;
  pass: TeammateShotWeights;
}

/**
 * Teammate shot weights for one initiator and action class, in team index
 * order minus the initiator. The pass variant is shared by every non-roll
 * action because the weight formula branches only on pickAndRollRoll. The
 * roll variant scales each teammate by their own roll-man responsibility
 * modifier (assigned slot), so bigs attract more roll finishes.
 */
export function teammateShotWeights(
  team: SimulationTeam,
  initiator: SimulationPlayer,
  action: ActionType,
  positionModifiers: ReadonlyMap<string, PositionResponsibilityModifiers>,
): TeammateShotWeights {
  const teammates = team.players.filter((p) => p.playerId !== initiator.playerId);
  const weights = teammates.map((p) =>
    action === 'pickAndRollRoll'
      ? Math.max(0.5, p.tendencies.pickAndRollRollManRate) *
        (0.6 + 0.8 * interiorScoringScore(p)) *
        (positionModifiers.get(p.playerId)?.rollMan ?? 1)
      : Math.max(0.3, p.tendencies.shotRate * spacingWeight(p) * usagePull(p)),
  );
  return { teammates, weights };
}

/** Selects whether the initiator passes and, if so, a teammate shooter. */
export function pickShot(
  shots: TeammateShots,
  initiator: SimulationPlayer,
  action: ActionType,
  rng: Rng,
): ShotSelection {
  if (!rng.chance(passProbability(initiator, action))) {
    return { shooter: initiator, initiator, passed: false };
  }
  const selected = action === 'pickAndRollRoll' ? shots.roll : shots.pass;
  if (selected.teammates.length === 0) return { shooter: initiator, initiator, passed: false };
  return {
    shooter: rng.weightedPick(selected.teammates, selected.weights),
    initiator,
    passed: true,
  };
}

/**
 * Assister selection weights for one made basket (pure; shared by
 * `pickAssister` and the projection layer). Candidates are the four non-
 * shooters; the initiator earns a strong bonus when he did not take the shot.
 */
export function assisterWeights(
  team: SimulationTeam,
  shooter: SimulationPlayer,
  initiator: SimulationPlayer,
): number[] {
  const candidates = team.players.filter((p) => p.playerId !== shooter.playerId);
  return candidates.map((p) => {
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
  return rng.weightedPick(candidates, assisterWeights(team, shooter, initiator));
}

/** Weight profile for a defender based on zone-relevant defense only. */
function defenderWeight(defender: SimulationPlayer, zone: ShotZone): number {
  const zoneRating =
    zone === 'rim' || zone === 'shortMid'
      ? defender.ratings.interiorDefense
      : zone === 'longMid'
        ? (defender.ratings.interiorDefense + defender.ratings.perimeterDefense) / 2
        : defender.ratings.perimeterDefense;
  return Math.max(0.25, (zoneRating - 45) / 35);
}

/**
 * Per-game defender selection base for one team: defenderWeight for every
 * (slot, zone) plus the assigned-slot rim-protection factor (interior zones
 * only). Both are deterministic per (defender, zone), so they are computed
 * once per game; only the slot-group matchup factor varies per shot.
 */
export interface DefenderBase {
  /** defenderWeight per (slot, zone), zone-major: weights[zoneIndex][slot]. */
  weights: number[][];
  /** Rim-protection factor per slot (applied on interior zones only). */
  rimProtection: number[];
}

/** Builds the per-game defender selection base for one team. */
export function defenderBase(
  team: SimulationTeam,
  positionModifiers: ReadonlyMap<string, PositionResponsibilityModifiers>,
): DefenderBase {
  return {
    weights: ZONES.map((zone) => team.players.map((defender) => defenderWeight(defender, zone))),
    rimProtection: team.players.map(
      (defender) => positionModifiers.get(defender.playerId)?.rimProtection ?? 1,
    ),
  };
}

/**
 * Selects the primary defender, favoring same-slot-group matchups (assigned
 * slots, never native position unions) and zone-relevant defense. On interior
 * zones the defender's assigned-slot rim-protection modifier shapes how often
 * bigs are assigned the block-check responsibility. The per-(slot, zone)
 * base comes from `defenderBase`; the tight loop applies only the slot-group
 * matchup factor, keeping the historical multiply order `(weight * match) * rim`.
 */
export function pickDefender(
  team: SimulationTeam,
  zone: ShotZone,
  rng: Rng,
  base: DefenderBase,
  shooterSlot: number,
): SimulationPlayer {
  const interior = zone === 'rim' || zone === 'shortMid';
  const zoneIndex = ZONES.indexOf(zone);
  const zoneWeights = base.weights[zoneIndex] ?? [];
  const weights = new Array<number>(team.players.length);
  for (let slot = 0; slot < team.players.length; slot += 1) {
    const match = sameGroupMatchWeight(slot, shooterSlot);
    const rim = interior ? (base.rimProtection[slot] ?? 1) : 1;
    weights[slot] = (zoneWeights[slot] ?? 0) * match * rim;
  }
  return rng.weightedPick(team.players, weights);
}

const ZONES: readonly ShotZone[] = ['rim', 'shortMid', 'longMid', 'cornerThree', 'aboveBreakThree'];

/**
 * Target three-point share for one player, from the recorded season volume
 * when available. Resolution order (spec/12):
 *
 * 1. No anchors at all (authored opponents, fixtures): the threePointRate
 *    tendency blended toward the era rate. This branch stays first and is
 *    unchanged.
 * 2. Null observed attempt rate (unavailable: pre-1979 not-applicable or
 *    genuinely missing records) with a reconstructed profile: the profile's
 *    conservative attempt rate, clamped to the same 0.01..0.65 band. Era
 *    growth must never manufacture a jump shot from a modern era rate for a
 *    player whose records predate the three-point line.
 * 3. No observed three-point attempts (null observed percentage or rate
 *    below the evidence minimum): the player never shoots threes.
 * 4. Very low observed volume: the observed rate stays, era growth adds only
 *    a tightly capped share.
 * 5. Established volume: the observed share anchors, and era growth moves the
 *    residual in bounded steps.
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
  // Unavailable records (null rate, including pre-1979) with a reconstructed
  // profile use the pinned conservative volume; a numeric rate, even a
  // validated observed zero, always takes the observed paths below.
  if (observedRate === null && shooter.reconstructedThreePoint !== undefined) {
    return Math.min(0.65, Math.max(0.01, shooter.reconstructedThreePoint.attemptRateConservative));
  }
  // A null rate with no reconstructed profile means no three-point evidence:
  // the player never shoots threes (a validated observed zero rate also
  // lands here through the numeric path below).
  if (
    observedPct === null ||
    observedRate === null ||
    observedRate < ENGINE_CONSTANTS.threePointEvidenceMinimum
  ) {
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
 * Rescales an era-blended zone mix to the player's three-point volume target:
 * the pre-play-type weight vector pickZone samples. Pure and fixed per player
 * per game, so it is computed once in `zonePrep`; `pickZone` copies it before
 * applying the action pulls.
 */
export function rescaleZoneWeights(blend: readonly number[], targetThreeRate: number): number[] {
  const weights = blend.slice();
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
  return weights;
}

/**
 * Per-player zone preparation: the unmutated era-blended zone mix, the
 * three-point volume target, and the mix rescaled to that target. All are
 * pure functions of the player and profile, so they are computed once per
 * game. `pickZone` copies the rescaled base before mutating it; callers must
 * never mutate the cached arrays.
 */
export interface ZonePrep {
  blend: number[];
  threePointTarget: number;
  driveRate: number;
  /** The era blend rescaled to the three-point target (pre play-type pulls). */
  base: number[];
}

/** Computes the pristine zone prep for one player. */
export function zonePrep(shooter: SimulationPlayer, profile: EraSimulationProfile): ZonePrep {
  const blend = blendedZoneWeights(shooter, profile);
  const targetThreeRate = threePointTarget(shooter, profile);
  return {
    blend,
    threePointTarget: targetThreeRate,
    driveRate: shooter.tendencies.driveRate,
    base: rescaleZoneWeights(blend, targetThreeRate),
  };
}

/**
 * Normalized two-point (rim / short-mid / long-mid) share of a blended zone
 * mix. These are the exact relative two-point weights pickZone uses: the
 * three-point rescaling and play-type pulls scale all two-point zones by the
 * same factor, so the proportions are identical.
 */
export function twoPointZoneSharesFromBlend(weights: readonly number[]): [number, number, number] {
  const total = (weights[0] ?? 0) + (weights[1] ?? 0) + (weights[2] ?? 0) || 1;
  return [
    (weights[0] ?? 0) / Math.max(1e-9, total),
    (weights[1] ?? 0) / Math.max(1e-9, total),
    (weights[2] ?? 0) / Math.max(1e-9, total),
  ];
}

/**
 * Applies the play-type zone pulls to a rescaled zone base (pure; shared by
 * `pickZone` and the projection layer so expected zone shares use the exact
 * sampled weight vector).
 */
export function applyZonePulls(
  action: ActionType,
  base: readonly number[],
  driveRate: number,
): number[] {
  const weights = base.slice();
  weights[0] = (weights[0] ?? 0) * (action === 'transition' ? 1.1 : action === 'postUp' ? 1.02 : 1);
  if (action === 'isolation' || action === 'pickAndRoll') {
    weights[0] = weights[0] * (0.9 + Math.min(40, driveRate) / 100);
  }
  weights[1] = (weights[1] ?? 0) * (action === 'postUp' ? 1.05 : 1);
  return weights;
}

/**
 * Selects the shot zone from the precomputed rescaled base, modulated by the
 * play type. The cached base is copied so the per-game cache stays pristine
 * across trips.
 */
export function pickZone(action: ActionType, prep: ZonePrep, rng: Rng): ShotZone {
  return rng.weightedPick(ZONES, applyZonePulls(action, prep.base, prep.driveRate));
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
