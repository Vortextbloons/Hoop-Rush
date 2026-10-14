import type {
  EraSimulationProfile,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import type { Rng, WeightedPickTable } from './rng.ts';
import { buildTrustedWeightedPickTable, buildWeightedPickTable } from './rng.ts';
import type { HavocEvidence } from './havoc-runtime.ts';
import { ENGINE_CONSTANTS, type PositionResponsibilityModifiers } from './constants.ts';
import { sameGroupMatchWeight } from './position-responsibilities.ts';
import { creationScore, interiorScoringScore, spacingScore } from '../domain/archetypes.ts';
import { SHOT_ZONES } from '../domain/zones.ts';
import { creationResponsibility } from './offense.ts';
export type ActionType =
  'isolation' | 'pickAndRoll' | 'pickAndRollRoll' | 'postUp' | 'spotUp' | 'cut' | 'transition';
export type PossessionStartType =
  'neutral' | 'madeBasket' | 'deadBall' | 'liveTurnover' | 'defensiveRebound' | 'offensiveRebound';
export const ACTION_TYPES: readonly ActionType[] = [
  'isolation',
  'pickAndRoll',
  'pickAndRollRoll',
  'postUp',
  'spotUp',
  'cut',
  'transition',
];
const ACTION_INDEX: Record<ActionType, number> = {
  isolation: 0,
  pickAndRoll: 1,
  pickAndRollRoll: 2,
  postUp: 3,
  spotUp: 4,
  cut: 5,
  transition: 6,
};
export interface ShotSelection {
  shooter: SimulationPlayer;
  initiator: SimulationPlayer;
  passed: boolean;
}
export function initiatorWeight(
  player: SimulationPlayer,
  modifiers: PositionResponsibilityModifiers,
): number {
  return creationResponsibility(player) * modifiers.initiation;
}
export function teamInitiatorWeights(
  team: SimulationTeam,
  positionModifiers: ReadonlyMap<string, PositionResponsibilityModifiers>,
  keyOf: (player: SimulationPlayer) => string = (player) => player.playerId,
): number[] {
  return team.players.map((p) =>
    initiatorWeight(
      p,
      positionModifiers.get(keyOf(p)) ?? positionModifiers.get(p.playerId) ?? identityModifiers,
    ),
  );
}
export const identityModifiers: PositionResponsibilityModifiers = {
  initiation: 1,
  pnrHandler: 1,
  rollMan: 1,
  postUp: 1,
  rebounding: 1,
  rimProtection: 1,
};
export function spacingWeight(player: SimulationPlayer): number {
  return 0.55 + 0.9 * spacingScore(player);
}
export function actionWeights(
  initiator: SimulationPlayer,
  modifiers: PositionResponsibilityModifiers,
): number[] {
  const t = initiator.tendencies;
  const transitionWeight = t.transitionRate * (0.5 + initiator.ratings.speed / 100);
  const weights = [
    t.isolationRate,
    t.pickAndRollBallHandlerRate * modifiers.pnrHandler,
    t.pickAndRollRollManRate * modifiers.rollMan,
    t.postUpRate * modifiers.postUp,
    t.spotUpRate,
    t.cutRate,
    transitionWeight,
  ];
  return weights.some((weight) => weight > 0) ? weights : ACTION_TYPES.map(() => 1);
}
export interface ActionStartTables {
  readonly byStart: Record<PossessionStartType, WeightedPickTable>;
}
const ACTION_START_TYPES: readonly PossessionStartType[] = [
  'neutral',
  'madeBasket',
  'deadBall',
  'liveTurnover',
  'defensiveRebound',
  'offensiveRebound',
];
export function scaledActionWeights(
  weights: readonly number[],
  start: PossessionStartType,
): number[] {
  const transitionIndex = ACTION_INDEX.transition;
  const scale = ENGINE_CONSTANTS.transitionStartMultiplier[start];
  return ACTION_TYPES.map((_, i) => {
    const raw = weights[i] ?? 0;
    return Math.max(0, i === transitionIndex ? raw * scale : raw);
  });
}
export function buildActionStartTables(weights: readonly number[]): ActionStartTables {
  const byStart = {} as Record<PossessionStartType, WeightedPickTable>;
  for (const start of ACTION_START_TYPES) {
    byStart[start] = buildWeightedPickTable(scaledActionWeights(weights, start));
  }
  return { byStart };
}
export function pickPreparedAction(
  tables: ActionStartTables,
  rng: Rng,
  start: PossessionStartType,
): ActionType {
  return rng.weightedPickTable(ACTION_TYPES, tables.byStart[start]);
}
export function pickAction(
  initiator: SimulationPlayer,
  weights: readonly number[],
  rng: Rng,
  start: PossessionStartType = 'neutral',
): ActionType {
  return pickPreparedAction(buildActionStartTables(weights), rng, start);
}
export function passProbability(initiator: SimulationPlayer, action: ActionType): number {
  const actionBase =
    action === 'spotUp' || action === 'cut' || action === 'transition'
      ? 0.9
      : action === 'pickAndRollRoll'
        ? 0.78
        : action === 'pickAndRoll'
          ? 0.53
          : action === 'postUp'
            ? 0.35
            : 0.17;
  const passingFactor =
    0.65 + initiator.tendencies.passRate / 100 + creationScore(initiator) * 0.15;
  return Math.min(0.97, Math.max(0.05, actionBase * 1.2 * passingFactor));
}
export interface TeammateShotWeights {
  teammates: SimulationPlayer[];
  weights: number[];
  pickTable: WeightedPickTable;
}
export interface TeammateShots {
  byAction: TeammateShotWeights[];
}
export function teammateShotWeightsFor(
  teammates: SimulationPlayer[],
  action: ActionType,
  positionModifiers: ReadonlyMap<string, PositionResponsibilityModifiers>,
  keyOf: (player: SimulationPlayer) => string,
  demandOf: (player: SimulationPlayer) => number,
): TeammateShotWeights {
  const weights = teammates.map(
    (p) =>
      demandOf(p) *
      (action === 'pickAndRollRoll'
        ? (0.5 + p.tendencies.pickAndRollRollManRate / 50) *
          (0.6 + 0.4 * interiorScoringScore(p)) *
          (positionModifiers.get(keyOf(p))?.rollMan ??
            positionModifiers.get(p.playerId)?.rollMan ??
            1)
        : action === 'postUp'
          ? 0.6 + 0.4 * interiorScoringScore(p)
          : spacingWeight(p)),
  );
  return { teammates, weights, pickTable: buildTrustedWeightedPickTable(weights) };
}
export function pickShot(
  shots: TeammateShots,
  initiator: SimulationPlayer,
  action: ActionType,
  rng: Rng,
  passP?: readonly number[],
): ShotSelection {
  const pass =
    passP === undefined
      ? passProbability(initiator, action)
      : (passP[ACTION_INDEX[action]] ?? passProbability(initiator, action));
  if (!rng.chance(pass)) {
    return { shooter: initiator, initiator, passed: false };
  }
  const selected = shots.byAction[ACTION_INDEX[action]];
  if (selected === undefined) throw new Error(`missing finishing distribution for ${action}`);
  if (selected.teammates.length === 0) return { shooter: initiator, initiator, passed: false };
  return {
    shooter: rng.weightedPickTable(selected.teammates, selected.pickTable),
    initiator,
    passed: true,
  };
}
function defenderWeight(defender: SimulationPlayer, zone: ShotZone): number {
  const zoneRating =
    zone === 'rim' || zone === 'shortMid'
      ? defender.ratings.interiorDefense
      : zone === 'longMid'
        ? (defender.ratings.interiorDefense + defender.ratings.perimeterDefense) / 2
        : defender.ratings.perimeterDefense;
  return Math.max(0.25, (zoneRating - 45) / 35);
}
export interface DefenderBase {
  weights: number[][];
  rimProtection: number[];
  matchMatrix: number[][];
  pickTables: WeightedPickTable[][];
}
export function defenderBase(
  team: SimulationTeam,
  positionModifiers: ReadonlyMap<string, PositionResponsibilityModifiers>,
  keyOf: (player: SimulationPlayer) => string = (player) => player.playerId,
  baseSlotOf: (index: number) => number = (index) => index,
): DefenderBase {
  const count = team.players.length;
  const baseSlots = Array.from({ length: count }, (_value, index) => baseSlotOf(index));
  const weights = SHOT_ZONES.map((zone) =>
    team.players.map((defender) => defenderWeight(defender, zone)),
  );
  const rimProtection = team.players.map(
    (defender) =>
      positionModifiers.get(keyOf(defender))?.rimProtection ??
      positionModifiers.get(defender.playerId)?.rimProtection ??
      1,
  );
  const matchMatrix = team.players.map((_, defenderSlot) =>
    team.players.map((_, shooterSlot) =>
      sameGroupMatchWeight(
        baseSlots[defenderSlot] ?? defenderSlot,
        baseSlots[shooterSlot] ?? shooterSlot,
      ),
    ),
  );
  const pickTables: WeightedPickTable[][] = [];
  for (let zoneIndex = 0; zoneIndex < SHOT_ZONES.length; zoneIndex += 1) {
    const interior = zoneIndex === 0 || zoneIndex === 1;
    const zoneWeights = weights[zoneIndex] ?? [];
    const zoneTables: WeightedPickTable[] = [];
    for (let shooterSlot = 0; shooterSlot < count; shooterSlot += 1) {
      const slotWeights = team.players.map((_, defenderSlot) => {
        const match = matchMatrix[defenderSlot]?.[shooterSlot] ?? 1;
        const rim = interior ? (rimProtection[defenderSlot] ?? 1) : 1;
        return (zoneWeights[defenderSlot] ?? 0) * match * rim;
      });
      zoneTables.push(buildTrustedWeightedPickTable(slotWeights));
    }
    pickTables.push(zoneTables);
  }
  return {
    weights,
    rimProtection,
    matchMatrix,
    pickTables,
  };
}
export function pickDefender(
  team: SimulationTeam,
  zone: ShotZone,
  rng: Rng,
  base: DefenderBase,
  shooterSlot: number,
): SimulationPlayer {
  const zoneIndex = ZONE_INDEX[zone];
  const table = base.pickTables[zoneIndex]?.[shooterSlot];
  if (table === undefined) return rng.pick(team.players);
  return rng.weightedPickTable(team.players, table);
}
const ZONE_INDEX = Object.fromEntries(SHOT_ZONES.map((zone, index) => [zone, index])) as Record<
  ShotZone,
  number
>;
export function threePointTarget(
  shooter: SimulationPlayer,
  profile: EraSimulationProfile,
  evidence?: HavocEvidence,
): number {
  const f = shooter.tendencies;
  const eraThreeRate = profile.parameters.league3PARate;
  const observedRate = evidence?.isAuthoritative('three-point-volume')
    ? undefined
    : shooter.anchors?.threePointAttemptRate;
  const observedPct = shooter.anchors?.threePointPct;
  const reconstructed = evidence?.isAuthoritative('three-point-volume')
    ? undefined
    : shooter.reconstructedThreePoint;
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
  if (observedRate === null && reconstructed !== undefined) {
    return Math.min(0.65, Math.max(0.01, reconstructed.attemptRateConservative));
  }
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
export interface ZonePrep {
  blend: number[];
  threePointTarget: number;
  driveRate: number;
  base: number[];
  actionPickTables: Record<ActionType, WeightedPickTable>;
}
export function zonePrep(
  shooter: SimulationPlayer,
  profile: EraSimulationProfile,
  evidence?: HavocEvidence,
): ZonePrep {
  const blend = blendedZoneWeights(shooter, profile);
  const targetThreeRate = threePointTarget(shooter, profile, evidence);
  const driveRate = shooter.tendencies.driveRate;
  const base = rescaleZoneWeights(blend, targetThreeRate);
  const actionPickTables = Object.fromEntries(
    ACTION_TYPES.map((action) => [
      action,
      buildTrustedWeightedPickTable(applyZonePulls(action, base, driveRate)),
    ]),
  ) as Record<ActionType, WeightedPickTable>;
  return {
    blend,
    threePointTarget: targetThreeRate,
    driveRate,
    base,
    actionPickTables,
  };
}
export function twoPointZoneSharesFromBlend(weights: readonly number[]): [number, number, number] {
  const total = (weights[0] ?? 0) + (weights[1] ?? 0) + (weights[2] ?? 0) || 1;
  return [
    (weights[0] ?? 0) / Math.max(1e-9, total),
    (weights[1] ?? 0) / Math.max(1e-9, total),
    (weights[2] ?? 0) / Math.max(1e-9, total),
  ];
}
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
export function pickZone(action: ActionType, prep: ZonePrep, rng: Rng): ShotZone {
  return rng.weightedPickTable(SHOT_ZONES, prep.actionPickTables[action]);
}
export function isThreePointZone(zone: ShotZone): boolean {
  return zone === 'cornerThree' || zone === 'aboveBreakThree';
}
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
