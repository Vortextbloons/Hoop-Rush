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
  const threePointRate = profile.parameters.league3PARate;
  const playerThree = f.threePointRate / 100;
  const tendencyThreeShare =
    (f.cornerThreeFrequency + f.aboveBreakThreeFrequency) /
    Math.max(
      1e-9,
      f.rimFrequency +
        f.shortMidFrequency +
        f.longMidFrequency +
        f.cornerThreeFrequency +
        f.aboveBreakThreeFrequency,
    );
  const volume = 0.5 + playerThree;
  const targetThreeShare = Math.min(
    0.65,
    Math.max(
      0.01,
      (1 - ENGINE_CONSTANTS.eraThreePointBlend) * tendencyThreeShare +
        ENGINE_CONSTANTS.eraThreePointBlend * threePointRate * volume,
    ),
  );
  const twoPointWeight = f.rimFrequency + f.shortMidFrequency + f.longMidFrequency;
  const threePointTendencyWeight = f.cornerThreeFrequency + f.aboveBreakThreeFrequency;
  const threeScale =
    (targetThreeShare / Math.max(1e-9, 1 - targetThreeShare)) *
    (twoPointWeight / Math.max(1e-9, threePointTendencyWeight));

  const weights: number[] = [
    f.rimFrequency * (action === 'transition' ? 1.2 : action === 'postUp' ? 1.1 : 1),
    f.shortMidFrequency * (action === 'postUp' ? 1.15 : 1),
    f.longMidFrequency,
    f.cornerThreeFrequency * threeScale,
    f.aboveBreakThreeFrequency * threeScale,
  ];
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
