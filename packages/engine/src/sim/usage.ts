import type {
  EraSimulationProfile,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import type { Rng, WeightedPickTable } from './rng.ts';
import { buildWeightedPickTable } from './rng.ts';
import { ENGINE_CONSTANTS } from './constants.ts';
import { creationScore, interiorScoringScore, spacingScore } from '../domain/archetypes.ts';
import {
  sameGroupMatchWeight,
  type PositionResponsibilityModifiers,
} from './position-responsibilities.ts';
import { SHOT_ZONES } from '../domain/zones.ts';
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
export function lineupMeanUsage(team: SimulationTeam): number {
  if (team.players.length === 0) return 10;
  const total = team.players.reduce((sum, p) => sum + Math.max(0.5, p.tendencies.usageRate), 0);
  return total / team.players.length;
}
export function relativeUsage(player: SimulationPlayer, team: SimulationTeam): number {
  return Math.max(0.5, player.tendencies.usageRate) / Math.max(1e-9, lineupMeanUsage(team));
}
export function initiatorRole(player: SimulationPlayer, team: SimulationTeam): number {
  const curved = Math.pow(
    Math.max(1e-9, relativeUsage(player, team)),
    ENGINE_CONSTANTS.initiatorRoleExponent,
  );
  return Math.min(
    ENGINE_CONSTANTS.initiatorRoleMax,
    Math.max(ENGINE_CONSTANTS.initiatorRoleMin, curved),
  );
}
export function finisherRole(player: SimulationPlayer, team: SimulationTeam): number {
  const curved = Math.pow(
    Math.max(1e-9, relativeUsage(player, team)),
    ENGINE_CONSTANTS.finisherRoleExponent,
  );
  return Math.min(
    ENGINE_CONSTANTS.finisherRoleMax,
    Math.max(ENGINE_CONSTANTS.finisherRoleMin, curved),
  );
}
export function initiatorWeight(
  player: SimulationPlayer,
  team: SimulationTeam,
  modifiers: PositionResponsibilityModifiers,
): number {
  const creationMod = 0.7 + 0.6 * creationScore(player);
  return initiatorRole(player, team) * creationMod * modifiers.initiation;
}
export function teamInitiatorWeights(
  team: SimulationTeam,
  positionModifiers: ReadonlyMap<string, PositionResponsibilityModifiers>,
): number[] {
  return team.players.map((p) =>
    initiatorWeight(p, team, positionModifiers.get(p.playerId) ?? identityModifiers),
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
export function pickAction(
  initiator: SimulationPlayer,
  weights: readonly number[],
  rng: Rng,
  start: PossessionStartType = 'neutral',
): ActionType {
  const transitionIndex = ACTION_INDEX.transition;
  const scale = ENGINE_CONSTANTS.transitionStartMultiplier[start];
  let total = 0;
  for (let i = 0; i < ACTION_TYPES.length; i += 1) {
    const raw = weights[i] ?? 0;
    const scaled = i === transitionIndex ? raw * scale : raw;
    total += Math.max(0, scaled);
  }
  if (total <= 0) return rng.pick(ACTION_TYPES);
  let roll = rng.next() * total;
  for (let i = 0; i < ACTION_TYPES.length; i += 1) {
    const raw = weights[i] ?? 0;
    const scaled = i === transitionIndex ? raw * scale : raw;
    const w = Math.max(0, scaled);
    if (roll < w) {
      const action = ACTION_TYPES[i];
      if (action === undefined) throw new Error('pickAction: index out of range');
      return action;
    }
    roll -= w;
  }
  const last = ACTION_TYPES[ACTION_TYPES.length - 1];
  if (last === undefined) throw new Error('pickAction: index out of range');
  return last;
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
  const creationFactor = 1.15 - initiator.tendencies.usageRate / 150;
  return Math.min(
    0.97,
    Math.max(0.05, actionBase * 1.2 * passingFactor * Math.max(0.7, creationFactor)),
  );
}
export interface TeammateShotWeights {
  teammates: SimulationPlayer[];
  weights: number[];
  pickTable: WeightedPickTable;
}
export interface TeammateShots {
  roll: TeammateShotWeights;
  pass: TeammateShotWeights;
}
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
        (positionModifiers.get(p.playerId)?.rollMan ?? 1) *
        finisherRole(p, team)
      : Math.max(0.3, p.tendencies.shotRate * spacingWeight(p) * finisherRole(p, team)),
  );
  return { teammates, weights, pickTable: buildWeightedPickTable(weights) };
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
  const selected = action === 'pickAndRollRoll' ? shots.roll : shots.pass;
  if (selected.teammates.length === 0) return { shooter: initiator, initiator, passed: false };
  return {
    shooter: rng.weightedPick(selected.teammates, selected.pickTable),
    initiator,
    passed: true,
  };
}
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
function assisterWeightOf(p: SimulationPlayer, initiator: SimulationPlayer): number {
  const observedCreation = p.anchors?.assistsPerGame;
  const roleWeight =
    observedCreation === undefined
      ? Math.max(0.5, p.tendencies.passRate / 5)
      : Math.max(0.5, observedCreation + 1);
  const passingWeight = 0.7 + p.ratings.passing / 100;
  const creationMod = 0.75 + 0.5 * creationScore(p);
  const initiatorBonus = p.playerId === initiator.playerId ? 1.35 : 1;
  return roleWeight * passingWeight * creationMod * initiatorBonus;
}
export interface AssisterPickPrep {
  candidates: SimulationPlayer[];
  pickTable: WeightedPickTable;
}
export function assisterPickPrep(
  team: SimulationTeam,
  shooter: SimulationPlayer,
  initiator: SimulationPlayer,
): AssisterPickPrep {
  const candidates = team.players.filter((p) => p.playerId !== shooter.playerId);
  const weights = candidates.map((p) => assisterWeightOf(p, initiator));
  return { candidates, pickTable: buildWeightedPickTable(weights) };
}
export function pickAssister(prep: AssisterPickPrep, rng: Rng): SimulationPlayer | null {
  if (prep.candidates.length === 0) return null;
  return rng.weightedPick(prep.candidates, prep.pickTable);
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
): DefenderBase {
  const count = team.players.length;
  const weights = SHOT_ZONES.map((zone) =>
    team.players.map((defender) => defenderWeight(defender, zone)),
  );
  const rimProtection = team.players.map(
    (defender) => positionModifiers.get(defender.playerId)?.rimProtection ?? 1,
  );
  const matchMatrix = team.players.map((_, defenderSlot) =>
    team.players.map((_, shooterSlot) => sameGroupMatchWeight(defenderSlot, shooterSlot)),
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
      zoneTables.push(buildWeightedPickTable(slotWeights));
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
  return rng.weightedPick(team.players, table);
}
const ZONE_INDEX = Object.fromEntries(SHOT_ZONES.map((zone, index) => [zone, index])) as Record<
  ShotZone,
  number
>;
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
  if (observedRate === null && shooter.reconstructedThreePoint !== undefined) {
    return Math.min(0.65, Math.max(0.01, shooter.reconstructedThreePoint.attemptRateConservative));
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
export function zonePrep(shooter: SimulationPlayer, profile: EraSimulationProfile): ZonePrep {
  const blend = blendedZoneWeights(shooter, profile);
  const targetThreeRate = threePointTarget(shooter, profile);
  const driveRate = shooter.tendencies.driveRate;
  const base = rescaleZoneWeights(blend, targetThreeRate);
  const actionPickTables = Object.fromEntries(
    ACTION_TYPES.map((action) => [
      action,
      buildWeightedPickTable(applyZonePulls(action, base, driveRate)),
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
  const table = prep.actionPickTables[action];
  const pickUniform = () => rng.pick(SHOT_ZONES);
  let roll = rng.next() * table.total;
  if (table.total <= 0) return pickUniform();
  for (let i = 0; i < SHOT_ZONES.length; i += 1) {
    const w = table.weights[i] ?? 0;
    if (roll < w) {
      const zone = SHOT_ZONES[i];
      if (zone === undefined) throw new Error('pickZone: index out of range');
      return zone;
    }
    roll -= w;
  }
  const last = SHOT_ZONES[SHOT_ZONES.length - 1];
  if (last === undefined) throw new Error('pickZone: index out of range');
  return last;
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
