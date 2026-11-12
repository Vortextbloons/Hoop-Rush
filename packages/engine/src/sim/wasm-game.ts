import type {
  EraSimulationProfile,
  GameResult,
  GameSimulationInput,
  ShotZone,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import { ENGINE_CONSTANTS as C } from './constants.ts';
import { meanTripSeconds } from './clock.ts';
import { buildFacts } from './facts.ts';
import { nonShootingFoulProbability, shootingFoulProbability } from './fouls.ts';
import { assistProbabilityPure } from './possession.ts';
import { prepareTeam, type TeamPrep } from './prepare.ts';
import { offensiveReboundProbability } from './rebounding.ts';
import type { EngineContext } from './kernel.ts';
import { usageOf, type SideIndex } from './recorder.ts';
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
  tape_ptr(): number;
  tape_len(): number;
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
export type TeamPrepCache = WeakMap<
  SimulationTeam['players'],
  WeakMap<EraSimulationProfile, TeamPrep>
>;
const PREPARED_GAME_DOUBLES = 6926;
function prepareTeams(
  input: GameSimulationInput,
  cache: TeamPrepCache | undefined,
): readonly TeamPrep[] {
  const teams = [input.home, input.away] as const;
  if (cache === undefined) return teams.map((team) => prepareTeam(team, input.profile));
  return teams.map((team) => {
    let byProfile = cache.get(team.players);
    if (byProfile === undefined) {
      byProfile = new WeakMap();
      cache.set(team.players, byProfile);
    }
    let prep = byProfile.get(input.profile);
    if (prep === undefined) {
      prep = prepareTeam(team, input.profile);
      byProfile.set(input.profile, prep);
    }
    return prep;
  });
}
export function prepareWasmGame(
  input: GameSimulationInput,
  injectedRng = false,
  teamPreps?: TeamPrepCache,
): PreparedWasmGame {
  if (input.home.players.length !== 5 || input.away.players.length !== 5)
    throw new Error('simulation requires five players per side');
  const teams = [input.home, input.away] as const;
  const preps = prepareTeams(input, teamPreps);
  // A fixed typed buffer with direct index writes avoids growing a JS array
  // element by element; the write order (and every offset) is unchanged.
  const data = new Float64Array(PREPARED_GAME_DOUBLES);
  let cursor = 0;
  const initial = [
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
  for (const value of initial) data[cursor++] = value;
  const pickTables = new Map<number, { items: readonly unknown[]; table: WeightedPickTable }>();
  const table = (value: WeightedPickTable, items: readonly unknown[]) => {
    if (injectedRng) pickTables.set(cursor, { items, table: value });
    data[cursor++] = value.total;
    for (const weight of value.weights) data[cursor++] = weight;
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
    for (const value of prep.freeThrowP) data[cursor++] = value;
    for (const player of team.players)
      data[cursor++] = turnoverProbability(
        player,
        defensive.pressure,
        eraPossEstimatePerTrip(input.profile) ?? 1,
        input.profile,
      );
    data[cursor++] = Math.min(
      0.9,
      Math.max(
        0.3,
        input.profile.parameters.stealShareOfTurnovers *
          (1 + (prep.stealAbility - C.stealNeutralAbility) / 100),
      ),
    );
    for (const zone of SHOT_ZONES)
      data[cursor++] = offensiveReboundProbability(
        prep.offensiveReboundMean,
        defensive.defensiveReboundMean,
        zone,
        input.profile,
      );
    for (const player of team.players)
      for (const start of starts)
        table(required(prep.actionPickTables.get(prep.keyOf(player))).byStart[start], ACTION_TYPES);
    for (const player of team.players)
      for (const value of required(prep.passP.get(prep.keyOf(player)))) data[cursor++] = value;
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
          for (const value of makeParts(
            input,
            shooter,
            zone,
            action,
            prep.spacing,
            prep.twoPointAnchor.get(prep.keyOf(shooter)) ?? null,
          ))
            data[cursor++] = value;
    for (const defender of defense.players)
      for (const zone of SHOT_ZONES) data[cursor++] = -contestPenalty(defender, zone) * 1 + 0 + 0;
    for (const defender of defense.players)
      for (const action of ACTION_TYPES)
        for (const zone of SHOT_ZONES) data[cursor++] = blockProbability(defender, zone, action);
    for (const shooter of team.players)
      for (const defender of defense.players)
        for (const zone of SHOT_ZONES)
          data[cursor++] = shootingFoulProbability(shooter, defender, zone, input.profile);
    for (const initiator of team.players)
      for (const shooter of team.players)
        for (const action of ACTION_TYPES)
          for (const zone of SHOT_ZONES) {
            data[cursor++] = assistProbabilityPure(
              input.profile,
              0.5 + (input.profile.parameters.assistAnchorRating - 50) / 100,
              initiator,
              action,
              zone,
              shooter,
            );
          }
  });
  if (cursor !== PREPARED_GAME_DOUBLES || data.some((value) => !Number.isFinite(value)))
    throw new Error('Invalid Wasm preparation');
  return { data, pickTables };
}

const installedInputs = new WeakMap<GameWasm, PreparedWasmGame>();

export function simulateWasmGame(
  wasm: GameWasm,
  input: GameSimulationInput,
  prepared: PreparedWasmGame,
  context: EngineContext,
  external = false,
  observers = 0,
): GameResult {
  if (installedInputs.get(wasm) !== prepared) {
    new Float64Array(wasm.memory.buffer, wasm.input_ptr(), prepared.data.length).set(prepared.data);
    installedInputs.set(wasm, prepared);
  }
  const status = wasm.simulate(
    fnv1a32(input.seed),
    prepared.data.length,
    external ? 1 : 0,
    observers,
  );
  if (status !== 0) throw new Error(`Wasm simulation failed: ${String(status)}`);
  const output = new Float64Array(wasm.memory.buffer, wasm.output_ptr(), 481);
  const periods = required(output[0]);
  const overtimePeriods = periods - 4;
  const sideResult = (side: SideIndex): GameResult['home'] => {
    const team = side === 0 ? input.home : input.away;
    const base = 1 + side * 240;
    const value = (offset: number, field: number): number => required(output[offset + field]);
    const zones = (offset: number) =>
      SHOT_ZONES.map((zone, index) => ({
        zone,
        attempts: value(offset, 25 + index),
        makes: value(offset, 30 + index),
      }));
    const counts = (offset: number) => ({
      points: value(offset, 0),
      fieldGoals: { made: value(offset, 1), attempted: value(offset, 2) },
      threes: { made: value(offset, 3), attempted: value(offset, 4) },
      freeThrows: { made: value(offset, 5), attempted: value(offset, 6) },
      assists: value(offset, 9),
      steals: value(offset, 10),
      blocks: value(offset, 11),
      turnovers: value(offset, 12),
      fouls: value(offset, 13),
    });
    let contestedShots = 0;
    const players = team.players.map((player, slot) => {
      const offset = base + (slot + 1) * 35;
      contestedShots += value(offset, 23);
      return {
        playerId: player.playerId,
        minutes: 48 + overtimePeriods * 5,
        ...counts(offset),
        rebounds: {
          total: value(offset, 7) + value(offset, 8),
          offensive: value(offset, 7),
          defensive: value(offset, 8),
        },
        diagnostics: {
          usage: usageOf(value(offset, 2), value(offset, 6), value(offset, 12)),
          shotZones: zones(offset),
          assistOpportunities: value(offset, 20),
          offensiveReboundChances: value(offset, 21),
          defensiveReboundChances: value(offset, 22),
          contestedShots: value(offset, 23),
        },
      };
    });
    const box = {
      teamId: team.teamId,
      ...counts(base),
      rebounds: {
        total: value(base, 7) + value(base, 8) + value(base, 14),
        offensive: value(base, 7),
        defensive: value(base, 8),
        team: value(base, 14),
      },
      possessions: value(base, 15),
      shotClockViolations: 0,
      diagnostics: {
        assistedFieldGoals: value(base, 18),
        unassistedFieldGoals: value(base, 19),
        reboundOpportunities: value(base, 17),
        contestedShots,
      },
    };
    return {
      teamId: team.teamId,
      displayName: team.displayName,
      box,
      players,
      shotZones: zones(base),
    };
  };
  const home = sideResult(0);
  const away = sideResult(1);
  const result: GameResult = {
    schemaVersion: 1,
    gameNumber: input.gameNumber,
    seed: input.seed,
    engineVersion: context.engineVersion,
    dataVersion: input.dataVersion,
    profileVersion: input.profile.profileVersion,
    home,
    away,
    periodScores: {
      home: Array.from(output.subarray(211, 211 + periods)),
      away: Array.from(output.subarray(451, 451 + periods)),
    },
    winner: home.box.points > away.box.points ? 'home' : 'away',
    overtimePeriods,
    facts: [],
  };
  result.facts = buildFacts(result);
  return result;
}
