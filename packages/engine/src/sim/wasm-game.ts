import type { GameResult, GameSimulationInput, ShotZone } from '@hoop-rush/data-contracts';
import { ENGINE_CONSTANTS as C } from './constants.ts';
import { meanTripSeconds } from './clock.ts';
import { buildFacts } from './facts.ts';
import { nonShootingFoulProbability, shootingFoulProbability } from './fouls.ts';
import { assistProbabilityPure } from './possession.ts';
import { prepareTeam } from './prepare.ts';
import { offensiveReboundProbability } from './rebounding.ts';
import type { EngineContext } from './kernel.ts';
import { GameRecorder, type SideIndex } from './recorder.ts';
import { fnv1a32, type WeightedPickTable } from './rng.ts';
import { eraPossEstimatePerTrip, turnoverProbability } from './security.ts';
import { blockProbability, contestPenalty, shotQualityBonus } from './shooting.ts';
import {
  ACTION_TYPES,
  zoneSkillRating,
  type ActionType,
  type PossessionStartType,
} from './usage.ts';
import { SHOT_ZONES } from '../domain/zones.ts';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('simulation: incomplete Wasm preparation or output');
  return value;
}

export interface GameWasm {
  memory: WebAssembly.Memory;
  input_ptr(): number;
  output_ptr(): number;
  simulate(seed: number, length: number, external?: number, observers?: number): number;
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

export interface PreparedWasmGame {
  data: Float64Array;
  pickTables: ReadonlyMap<number, { items: readonly unknown[]; table: WeightedPickTable }>;
}
export function prepareWasmGame(input: GameSimulationInput, injectedRng = false): PreparedWasmGame {
  if (input.home.players.length !== 5 || input.away.players.length !== 5)
    throw new Error('simulation requires five players per side');
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
  const pickTables = new Map<number, { items: readonly unknown[]; table: WeightedPickTable }>();
  const table = (value: WeightedPickTable, items: readonly unknown[]) => {
    if (injectedRng) pickTables.set(data.length, { items, table: value });
    data.push(value.total, ...value.weights);
  };
  teams.forEach((team, side) => {
    const prep = required(preps[side]);
    const defense = required(teams[1 - side]);
    const defensive = required(preps[1 - side]);
    table(prep.initiatorPickTable, team.players);
    table(prep.foulerPickTable, team.players);
    table(prep.stealerPickTable, team.players);
    table(prep.rebounderPickTables[0], team.players);
    table(prep.rebounderPickTables[1], team.players);
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
        table(required(prep.actionPickTables.get(prep.keyOf(player))).byStart[start], ACTION_TYPES);
    for (const player of team.players) data.push(...required(prep.passP.get(prep.keyOf(player))));
    for (const player of team.players)
      for (const shot of required(prep.teammateShots.get(prep.keyOf(player))).byAction)
        table(shot.pickTable, shot.teammates);
    for (const player of team.players)
      for (const action of ACTION_TYPES)
        table(required(prep.zonePrep.get(prep.keyOf(player))).actionPickTables[action], SHOT_ZONES);
    for (const tables of defensive.defenderBase.pickTables)
      for (const value of tables) table(value, defense.players);
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
  if (data.length !== 6926 || data.some((value) => !Number.isFinite(value)))
    throw new Error('Invalid Wasm preparation');
  return { data: Float64Array.from(data), pickTables };
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
  prepared: PreparedWasmGame,
  context: EngineContext,
  external = false,
  observers = 0,
): GameResult {
  new Float64Array(wasm.memory.buffer, wasm.input_ptr(), prepared.data.length).set(prepared.data);
  const status = wasm.simulate(
    fnv1a32(input.seed),
    prepared.data.length,
    external ? 1 : 0,
    observers,
  );
  if (status !== 0) throw new Error(`Wasm simulation failed: ${String(status)}`);
  const output = new Float64Array(wasm.memory.buffer, wasm.output_ptr(), 481);
  const periods = required(output[0]);
  const recorder = new GameRecorder();
  let cursor = 1;
  for (const side of [0, 1] as const) {
    for (let index = 0; index < 6; index++) {
      const target =
        index === 0 ? recorder.sides[side] : required(recorder.players[side][index - 1]);
      for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
        const field = required(fields[fieldIndex]);
        if (field in target)
          (target as unknown as Record<string, number>)[field] = required(
            output[cursor + fieldIndex],
          );
      }
      for (let i = 0; i < SHOT_ZONES.length; i++) {
        const zone = required(SHOT_ZONES[i]);
        target.zoneAttempts[zone] = required(output[cursor + 25 + i]);
        target.zoneMakes[zone] = required(output[cursor + 30 + i]);
      }
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
    engineVersion: context.engineVersion,
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
