import type {
  EraSimulationProfile,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import type { Rng } from './rng.js';
import { ENGINE_CONSTANTS } from './constants.js';

/**
 * Usage, creation, passing, and action tendencies select the initiator,
 * action, shooter, zone, and potential assister (spec/03 pipeline stages 2-3).
 * All weights are player tendencies; no summary Overall rating is consulted.
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

/** Selects the possession initiator, weighted by usage rate. */
export function pickInitiator(team: SimulationTeam, rng: Rng): SimulationPlayer {
  return rng.weightedPick(
    team.players,
    team.players.map((p) => Math.max(0.5, p.tendencies.usageRate)),
  );
}

/** Selects the play type from the initiator's action tendencies. Speed raises
 * the transition rate: faster lineups run more (physical trait mechanism). */
export function pickAction(initiator: SimulationPlayer, rng: Rng): ActionType {
  const t = initiator.tendencies;
  const transitionWeight = t.transitionRate * (0.5 + initiator.ratings.speed / 100);
  return rng.weightedPick(ACTION_TYPES, [
    t.isolationRate,
    t.pickAndRollBallHandlerRate,
    t.pickAndRollRollManRate,
    t.postUpRate,
    t.spotUpRate,
    t.cutRate,
    transitionWeight,
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
  const passingFactor = 0.65 + initiator.tendencies.passRate / 100;
  const creationFactor = 1.1 - initiator.tendencies.usageRate / 200;
  return Math.min(
    0.97,
    Math.max(0.05, actionBase * 1.2 * passingFactor * Math.max(0.7, creationFactor)),
  );
}

/**
 * Selects the shooter. Spot-up, cut, and transition possessions pass toward a
 * teammate; isolation, pick-and-roll, and post-up end with the initiator.
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
        p.playerId === initiator.playerId ? 0.5 : Math.max(0.5, p.tendencies.shotRate),
      ),
    );
  }
  if (action === 'pickAndRollRoll') {
    return rng.weightedPick(
      team.players,
      team.players.map((p) =>
        p.playerId === initiator.playerId
          ? 0.5
          : Math.max(0.5, p.tendencies.pickAndRollRollManRate),
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
      ? Math.max(0.5, p.tendencies.pickAndRollRollManRate)
      : Math.max(0.5, p.tendencies.shotRate),
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
    const initiatorBonus = p.playerId === initiator.playerId ? 1.35 : 1;
    return roleWeight * passingWeight * initiatorBonus;
  });
  return rng.weightedPick(candidates, weights);
}

/** Weight profile for a defender based on zone and position matchup. */
function defenderWeight(
  defender: SimulationPlayer,
  shooter: SimulationPlayer,
  zone: ShotZone,
): number {
  const positionMatch = defender.positions.some((p) => shooter.positions.includes(p)) ? 1.6 : 1;
  const zoneRating =
    zone === 'rim' || zone === 'shortMid'
      ? defender.ratings.interiorDefense
      : zone === 'longMid'
        ? (defender.ratings.interiorDefense + defender.ratings.perimeterDefense) / 2
        : defender.ratings.perimeterDefense;
  const ability = Math.max(0.25, (zoneRating - 40) / 40);
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
 * Selects the shot zone from the shooter's frequency tendencies, blended
 * toward the era's three-point rate and modulated by three-point tendency.
 */
export function pickZone(
  shooter: SimulationPlayer,
  action: ActionType,
  profile: EraSimulationProfile,
  rng: Rng,
): ShotZone {
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
  const weights = eraWeights.map(
    (value, index) => value * (1 - blend) + (tendencyMix[index] ?? 0) * blend,
  );

  // Historical three-point volume is a strong role anchor. A player with no
  // recorded three-point attempts should not become a modern floor-spacer just
  // because the era has a nonzero league average.
  const observedRate = shooter.anchors?.threePointAttemptRate;
  const observedPct = shooter.anchors?.threePointPct;
  const eraThreeRate = profile.parameters.league3PARate;
  const targetThreeRate =
    observedRate !== undefined
      ? observedPct === null
        ? Math.min(0.03, eraThreeRate * 0.25)
        : Math.min(0.65, Math.max(0.01, observedRate * 0.7 + eraThreeRate * 0.3))
      : Math.min(
          0.65,
          Math.max(
            0.01,
            (f.threePointRate / 100) * ENGINE_CONSTANTS.threePointRateWeight +
              eraThreeRate * (1 - ENGINE_CONSTANTS.threePointRateWeight),
          ),
        );
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

  weights[0] = (weights[0] ?? 0) * (action === 'transition' ? 1.2 : action === 'postUp' ? 1.1 : 1);
  weights[1] = (weights[1] ?? 0) * (action === 'postUp' ? 1.15 : 1);
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
