import type {
  GameResult,
  GameSimulationInput,
  ShotZone,
} from '../../packages/data-contracts/src/index.ts';
import { ENGINE_CONSTANTS as C, ENGINE_VERSION } from '../../packages/engine/src/sim/constants.ts';
import { meanTripSeconds } from '../../packages/engine/src/sim/clock.ts';
import { buildFacts } from '../../packages/engine/src/sim/facts.ts';
import {
  nonShootingFoulProbability,
  shootingFoulProbability,
} from '../../packages/engine/src/sim/fouls.ts';
import { assistProbabilityPure } from '../../packages/engine/src/sim/possession.ts';
import { prepareTeam } from '../../packages/engine/src/sim/prepare.ts';
import { offensiveReboundProbability } from '../../packages/engine/src/sim/rebounding.ts';
import { GameRecorder, type SideIndex } from '../../packages/engine/src/sim/recorder.ts';
import { fnv1a32, type WeightedPickTable } from '../../packages/engine/src/sim/rng.ts';
import {
  eraPossEstimatePerTrip,
  turnoverProbability,
} from '../../packages/engine/src/sim/security.ts';
import {
  blockProbability,
  contestPenalty,
  shotQualityBonus,
} from '../../packages/engine/src/sim/shooting.ts';
import {
  ACTION_TYPES,
  zoneSkillRating,
  type ActionType,
  type PossessionStartType,
} from '../../packages/engine/src/sim/usage.ts';
import { SHOT_ZONES } from '../../packages/engine/src/domain/zones.ts';

export interface GameWasm {
  memory: WebAssembly.Memory;
  input_ptr(): number;
  output_ptr(): number;
  simulate(seed: number, length: number): number;
}
const starts: PossessionStartType[] = [
  'neutral',
  'madeBasket',
  'deadBall',
  'liveTurnover',
  'defensiveRebound',
  'offensiveRebound',
];

function makeParts(
  input: GameSimulationInput,
  shooter: GameSimulationInput['home']['players'][number],
  zone: ShotZone,
  action: ActionType,
  spacing: number,
  twoPointAnchor: number | null,
): number[] {
  const profile = input.profile;
  const three = zone === 'cornerThree' || zone === 'aboveBreakThree';
  const reconstructed = three ? shooter.reconstructedThreePoint : undefined;
  const observed = three ? shooter.anchors?.threePointPct : null;
  const hasObserved = observed !== null && observed !== undefined;
  const anchor = three ? null : twoPointAnchor;
  const base = three
    ? hasObserved
      ? observed * C.observedThreePointBlend +
        profile.targets.threePointPct.value * (1 - C.observedThreePointBlend)
      : reconstructed !== undefined
        ? reconstructed.accuracyConservative
        : C.zoneBaseMake[zone]
    : C.zoneBaseMake[zone] * (anchor ?? 1);
  const skill = three
    ? hasObserved
      ? ((zoneSkillRating(shooter, zone) - 70) / 100) * C.anchoredThreePointSkillRange
      : reconstructed !== undefined
        ? 0
        : ((zoneSkillRating(shooter, zone) - 70) / 30) * C.skillRange
    : ((zoneSkillRating(shooter, zone) - 70) / 30) *
      C.skillRange *
      (anchor !== null ? C.twoPointAnchorSkillScale : 1);
  const era =
    anchor !== null || hasObserved || reconstructed !== undefined
      ? 0
      : (profile.parameters.leagueTsPct - 0.55) * C.eraEfficiencyWeight;
  const spacingBonus = three ? 0 : (spacing - 0.5) * C.spacingBonusScale;
  const quality = three ? 0 : shotQualityBonus(action, zone);
  const floor =
    three && reconstructed !== undefined
      ? zone === 'cornerThree'
        ? reconstructed.zoneFloors.cornerThree
        : reconstructed.zoneFloors.aboveBreakThree
      : C.zoneMakeFloor[zone];
  return [
    base,
    skill,
    era,
    spacingBonus,
    quality,
    floor,
    three ? C.threePointCalibrationOffset : 0,
    anchor !== null ? 1 : 0,
  ];
}

export function prepareWasmGame(input: GameSimulationInput): Float64Array {
  if (input.home.players.length !== 5 || input.away.players.length !== 5)
    throw new Error('Wasm experiment requires five players per side');
  const teams = [input.home, input.away] as const;
  const preps = teams.map((team) => prepareTeam(team, input.profile));
  const data: number[] = [
    meanTripSeconds(input.profile),
    C.minimumStartSeconds,
    C.minimumTripSeconds,
    C.shotClockSeconds,
    C.inboundConsumption,
    C.continuationConsumption,
    nonShootingFoulProbability(input.profile),
    C.offensiveFoulShare,
    C.foulTroubleStart,
    C.foulAvoidancePerFoulSquared,
    C.foulAvoidanceFloor,
    C.bonusFoulsRegulation,
    C.bonusFoulsOvertime,
    C.fouledShotMakeScale,
  ];
  const table = (value: WeightedPickTable) => data.push(value.total, ...value.weights);
  teams.forEach((team, side) => {
    const prep = preps[side]!;
    const defense = teams[1 - side]!;
    const defensive = preps[1 - side]!;
    table(prep.initiatorPickTable);
    table(prep.foulerPickTable);
    table(prep.stealerPickTable);
    table(prep.rebounderPickTables[0]);
    table(prep.rebounderPickTables[1]);
    data.push(...prep.freeThrowP);
    for (const player of team.players)
      data.push(
        turnoverProbability(
          player,
          defensive.pressure,
          eraPossEstimatePerTrip(input.profile) ?? 1,
          input.profile,
        ),
      );
    data.push(
      Math.min(
        0.9,
        Math.max(
          0.3,
          input.profile.parameters.stealShareOfTurnovers *
            (1 + (prep.stealAbility - C.stealNeutralAbility) / 100),
        ),
      ),
    );
    for (const zone of SHOT_ZONES)
      data.push(
        offensiveReboundProbability(
          prep.offensiveReboundMean,
          defensive.defensiveReboundMean,
          zone,
          input.profile,
        ),
      );
    for (const player of team.players)
      for (const start of starts)
        table(prep.actionPickTables.get(prep.keyOf(player))!.byStart[start]);
    for (const player of team.players) data.push(...prep.passP.get(prep.keyOf(player))!);
    for (const player of team.players)
      for (const shot of prep.teammateShots.get(prep.keyOf(player))!.byAction)
        table(shot.pickTable);
    for (const player of team.players)
      for (const action of ACTION_TYPES)
        table(prep.zonePrep.get(prep.keyOf(player))!.actionPickTables[action]);
    for (const tables of defensive.defenderBase.pickTables)
      for (const value of tables) table(value);
    for (const shooter of team.players)
      for (const action of ACTION_TYPES)
        for (const zone of SHOT_ZONES)
          data.push(
            ...makeParts(
              input,
              shooter,
              zone,
              action,
              prep.spacing,
              prep.twoPointAnchor.get(prep.keyOf(shooter)) ?? null,
            ),
          );
    for (const defender of defense.players)
      for (const zone of SHOT_ZONES) data.push(-contestPenalty(defender, zone) * 1 + 0 + 0);
    for (const defender of defense.players)
      for (const action of ACTION_TYPES)
        for (const zone of SHOT_ZONES) data.push(blockProbability(defender, zone, action));
    for (const shooter of team.players)
      for (const defender of defense.players)
        for (const zone of SHOT_ZONES)
          data.push(shootingFoulProbability(shooter, defender, zone, input.profile));
    for (const initiator of team.players)
      for (const shooter of team.players)
        for (const action of ACTION_TYPES)
          for (const zone of SHOT_ZONES) {
            data.push(
              assistProbabilityPure(
                input.profile,
                0.5 + (input.profile.parameters.assistAnchorRating - 50) / 100,
                initiator,
                action,
                zone,
                shooter,
              ),
            );
          }
  });
  if (data.length > 32768 || data.some((value) => !Number.isFinite(value)))
    throw new Error('Invalid Wasm preparation');
  return Float64Array.from(data);
}

const fields = [
  'points',
  'fieldGoalMakes',
  'fieldGoalAttempts',
  'threeMakes',
  'threeAttempts',
  'freeThrowMakes',
  'freeThrowAttempts',
  'offensiveRebounds',
  'defensiveRebounds',
  'assists',
  'steals',
  'blocks',
  'turnovers',
  'fouls',
  'teamRebounds',
  'possessions',
  'freeThrowTrips',
  'reboundOpportunities',
  'assistedFieldGoals',
  'unassistedFieldGoals',
  'assistOpportunities',
  'offensiveReboundChances',
  'defensiveReboundChances',
  'contestedShots',
] as const;

export function simulateWasmGame(
  wasm: GameWasm,
  input: GameSimulationInput,
  prepared: Float64Array,
): GameResult {
  new Float64Array(wasm.memory.buffer, wasm.input_ptr(), prepared.length).set(prepared);
  const status = wasm.simulate(fnv1a32(input.seed), prepared.length);
  if (status !== 0) throw new Error(`Wasm simulation failed: ${status}`);
  const output = new Float64Array(wasm.memory.buffer, wasm.output_ptr(), 481);
  const periods = output[0]!;
  const recorder = new GameRecorder();
  let cursor = 1;
  for (const side of [0, 1] as const) {
    for (let index = 0; index < 6; index++) {
      const target = index === 0 ? recorder.sides[side] : recorder.players[side][index - 1]!;
      for (const [fieldIndex, field] of fields.entries()) {
        if (field in target)
          (target as unknown as Record<string, number>)[field] = output[cursor + fieldIndex]!;
      }
      SHOT_ZONES.forEach((zone, i) => {
        target.zoneAttempts[zone] = output[cursor + 25 + i]!;
        target.zoneMakes[zone] = output[cursor + 30 + i]!;
      });
      cursor += 35;
    }
    recorder.sides[side].periodPoints = Array.from(output.subarray(cursor, cursor + periods));
    cursor += 30;
  }
  const overtimePeriods = periods - 4;
  recorder.assignMinutes(48 + overtimePeriods * 5);
  const sideResult = (side: SideIndex): GameResult['home'] => {
    const team = side === 0 ? input.home : input.away;
    return {
      teamId: team.teamId,
      displayName: team.displayName,
      box: recorder.teamBox(side, team.teamId),
      players: team.players.map((player, slot) => ({
        ...recorder.playerBox(side, slot),
        playerId: player.playerId,
      })),
      shotZones: recorder.zoneSummary(side),
    };
  };
  const result: GameResult = {
    schemaVersion: 1,
    gameNumber: input.gameNumber,
    seed: input.seed,
    engineVersion: ENGINE_VERSION,
    dataVersion: input.dataVersion,
    profileVersion: input.profile.profileVersion,
    home: sideResult(0),
    away: sideResult(1),
    periodScores: { home: recorder.sides[0].periodPoints, away: recorder.sides[1].periodPoints },
    winner: recorder.sides[0].points > recorder.sides[1].points ? 'home' : 'away',
    overtimePeriods,
    facts: [],
  };
  result.facts = buildFacts(result);
  return result;
}
