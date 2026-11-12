import type {
  EraSimulationProfile,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import { havocAuthoritativeChannelSchema } from '@hoop-rush/data-contracts';
import { creationScore } from '../domain/archetypes.ts';
import { SHOT_ZONES } from '../domain/zones.ts';
import { meanTripSeconds } from './clock.ts';
import { ENGINE_CONSTANTS as C } from './constants.ts';
import {
  freeThrowProbability,
  nonShootingFoulProbability,
  shootingFoulProbability,
} from './fouls.ts';
import type { HavocEvidence } from './havoc-runtime.ts';
import { prepareTeam, type TeamPrep } from './prepare.ts';
import type { GameRecorder, RecorderPlayer, RecorderSide, SideIndex } from './recorder.ts';
import type { WeightedPickTable } from './rng.ts';
import { eraPossEstimatePerTrip, turnoverProbability } from './security.ts';
import { contestPenalty, shotQualityBonus } from './shooting.ts';
import {
  ACTION_TYPES,
  isThreePointZone,
  zoneSkillRating,
  type ActionType,
  type PossessionStartType,
} from './usage.ts';
import { apronPlayerKeyOf } from './apron-runtime.ts';
import type { TripContext } from './possession.ts';
import { POSSESSION_WASM_BYTES } from './wasm/possession-wasm.gen.ts';

interface PossessionWasm {
  memory: WebAssembly.Memory;
  input_ptr(): number;
  output_ptr(): number;
  hook_output_ptr(): number;
  run_trip(): number;
}

export const POSSESSION_STARTS: readonly PossessionStartType[] = [
  'neutral',
  'madeBasket',
  'deadBall',
  'liveTurnover',
  'defensiveRebound',
  'offensiveRebound',
];
const AUTHORITATIVE_CHANNELS = havocAuthoritativeChannelSchema.options;
const ALL_AUTHORITATIVE: HavocEvidence = { isAuthoritative: () => true };
const STAT_FIELDS = 40;
const OUTPUT_DOUBLES = 2048;

interface PickTableEntry {
  readonly items: readonly unknown[];
  readonly table: WeightedPickTable;
}

interface StaticLayout {
  readonly prep: readonly [TeamPrep, TeamPrep];
  readonly struck: readonly [string | null, string | null];
  readonly hasHavoc: boolean;
  readonly data: Float64Array;
  readonly dynamicOffset: number;
  readonly count: readonly [number, number];
  readonly internalRng: boolean;
  readonly pickTables: Map<number, PickTableEntry>;
}

interface Runtime {
  readonly ctx: TripContext;
  recorder: GameRecorder;
  current: StaticLayout | null;
  entries: StaticLayout[];
  currentOffense: SideIndex;
}

let compiled: WebAssembly.Module | undefined;

export function zeroTable(count: number): WeightedPickTable {
  return { total: 0, weights: Array.from({ length: count }, () => 0) };
}

function playerVersion(player: SimulationPlayer): string {
  const version = player.playerVersionId;
  if (version === undefined) {
    throw new Error('possession: effects facts require a playerVersionId');
  }
  return version;
}

export function shotComponents(
  shooter: SimulationPlayer,
  profile: EraSimulationProfile,
  zone: ShotZone,
  action: ActionType,
  spacing: number,
  twoPointAnchor: number | null,
  evidence: HavocEvidence | undefined,
): readonly number[] {
  const three = isThreePointZone(zone);
  const threeAuthoritative = evidence?.isAuthoritative('three-point-accuracy') === true;
  const reconstructed = three && !threeAuthoritative ? shooter.reconstructedThreePoint : undefined;
  const hasReconstructed = reconstructed !== undefined;
  const observed = three && !threeAuthoritative ? shooter.anchors?.threePointPct : null;
  const hasObserved = observed !== null && observed !== undefined;
  const anchor = three ? null : twoPointAnchor;
  const base = three
    ? hasObserved
      ? observed * C.observedThreePointBlend +
        profile.targets.threePointPct.value * (1 - C.observedThreePointBlend)
      : hasReconstructed
        ? reconstructed.accuracyConservative
        : C.zoneBaseMake[zone]
    : C.zoneBaseMake[zone] * (anchor ?? 1);
  const skill = three
    ? hasObserved
      ? ((zoneSkillRating(shooter, zone) - 70) / 100) * C.anchoredThreePointSkillRange
      : hasReconstructed
        ? 0
        : ((zoneSkillRating(shooter, zone) - 70) / 30) * C.skillRange
    : ((zoneSkillRating(shooter, zone) - 70) / 30) *
      C.skillRange *
      (anchor !== null ? C.twoPointAnchorSkillScale : 1);
  const era =
    anchor !== null || hasObserved || hasReconstructed
      ? 0
      : (profile.parameters.leagueTsPct - 0.55) * C.eraEfficiencyWeight;
  const spacingBonus = three ? 0 : (spacing - 0.5) * C.spacingBonusScale;
  const quality = three ? 0 : shotQualityBonus(action, zone);
  const calibration = three ? C.threePointCalibrationOffset : 0;
  const floor =
    three && reconstructed !== undefined
      ? zone === 'cornerThree'
        ? reconstructed.zoneFloors.cornerThree
        : reconstructed.zoneFloors.aboveBreakThree
      : C.zoneMakeFloor[zone];
  return [base, skill, era, spacingBonus, quality, calibration, floor];
}

export function blockComponents(
  defender: SimulationPlayer,
  zone: ShotZone,
  action: ActionType,
  evidence: HavocEvidence | undefined,
): readonly [number, number] {
  const anchors = evidence?.isAuthoritative('block-anchor') ? undefined : defender.anchors;
  const per48 =
    anchors && anchors.minutesPerGame > 0
      ? (anchors.blocksPerGame / anchors.minutesPerGame) * 48
      : 0;
  const anchorBonus =
    per48 > C.blockAnchorFloorPer48
      ? Math.min(C.blockAnchorMax, (per48 - C.blockAnchorFloorPer48) * C.blockAnchorScale)
      : 0;
  const attemptFactor = 0.75 + Math.min(20, defender.tendencies.blockAttemptRate) / 40;
  if (zone === 'rim') {
    const base = Math.min(
      C.blockRimMax,
      Math.max(0, ((defender.ratings.block - 40) / 60) * C.blockRimMax),
    );
    return [
      (base +
        (action === 'isolation' || action === 'pickAndRoll' ? C.blockDriveBonus : 0) +
        anchorBonus) *
        attemptFactor,
      C.blockRimMax + C.blockDriveBonus + C.blockAnchorMax,
    ];
  }
  if (zone === 'shortMid') {
    return [
      (Math.max(0, ((defender.ratings.block - 50) / 50) * C.blockMidMax) + anchorBonus * 0.5) *
        attemptFactor,
      C.blockMidMax,
    ];
  }
  return [
    Math.max(0, ((defender.ratings.perimeterDefense - 60) / 40) * C.blockThreeMax) * attemptFactor,
    C.blockThreeMax,
  ];
}

export function assistBase(
  profile: EraSimulationProfile,
  passingAnchorFactor: number,
  passer: SimulationPlayer,
  action: ActionType,
  zone: ShotZone,
  shooter: SimulationPlayer,
  evidence: HavocEvidence | undefined,
): number {
  const factor = 0.5 + (passer.ratings.passing - 50) / 100;
  const anchorAuthoritative = evidence?.isAuthoritative('assist-anchor') ?? false;
  const roleFactor =
    anchorAuthoritative || !passer.anchors
      ? 1
      : 0.75 + Math.min(1, passer.anchors.assistsPerGame / 8) * 0.25;
  const creation = 0.6 + 0.7 * creationScore(passer);
  const actionFactor =
    action === 'transition'
      ? 1.25
      : action === 'cut'
        ? 1.2
        : action === 'pickAndRollRoll'
          ? 1.25
          : action === 'spotUp'
            ? 1.15
            : action === 'pickAndRoll'
              ? 1.1
              : action === 'postUp'
                ? 0.85
                : 0.5;
  const zoneFactor =
    zone === 'rim'
      ? 1.15
      : zone === 'shortMid'
        ? 1.05
        : zone === 'longMid'
          ? 0.95
          : zone === 'cornerThree'
            ? 1.1
            : 1;
  const finishing = 0.9 + 0.2 * (zoneSkillRating(shooter, zone) / 100);
  return (
    profile.parameters.assistRate *
    C.assistCreditScale *
    roleFactor *
    creation *
    actionFactor *
    zoneFactor *
    finishing *
    (factor / Math.max(1e-9, passingAnchorFactor))
  );
}

function struckKeyOf(ctx: TripContext, side: SideIndex): string | null {
  const apron = ctx.apron;
  if (apron === undefined) return null;
  const team = ctx.teams[side];
  const struck = apron.struckDefender(team);
  if (struck === null) return null;
  const key = apronPlayerKeyOf(struck);
  const remaining = team.players.filter((player) => apronPlayerKeyOf(player) !== key);
  return remaining.length === team.players.length - 1 ? key : null;
}

function canUseInternalRng(ctx: TripContext): boolean {
  return (
    ctx.externalRng !== true &&
    typeof ctx.rng.getState === 'function' &&
    typeof ctx.rng.setState === 'function'
  );
}

function buildStatic(ctx: TripContext): StaticLayout {
  const profile = ctx.profile;
  const teams: readonly [SimulationTeam, SimulationTeam] = ctx.teams;
  const preps: [TeamPrep, TeamPrep] = [ctx.preps[0], ctx.preps[1]];
  const counts: [number, number] = [teams[0].players.length, teams[1].players.length];
  const struckKeys: [string | null, string | null] = [struckKeyOf(ctx, 0), struckKeyOf(ctx, 1)];
  const internalRng = canUseInternalRng(ctx);
  const adjustedPreps: [TeamPrep | null, TeamPrep | null] = [null, null];
  for (const side of [0, 1] as const) {
    const key = struckKeys[side];
    if (key === null) continue;
    const pool: SimulationTeam = {
      teamId: teams[side].teamId,
      displayName: teams[side].displayName,
      players: teams[side].players.filter((player) => apronPlayerKeyOf(player) !== key),
    };
    if (pool.players.length !== teams[side].players.length - 1) continue;
    adjustedPreps[side] = prepareTeam(pool, profile, { aggregateDivisor: 5 });
  }
  const eraPoss = eraPossEstimatePerTrip(profile) ?? 1;
  const data: number[] = [
    1,
    0,
    meanTripSeconds(profile),
    eraPoss,
    ctx.passingAnchorFactor,
    C.minimumStartSeconds,
    C.minimumTripSeconds,
    C.shotClockSeconds,
    C.inboundConsumption,
    C.continuationConsumption,
    nonShootingFoulProbability(profile),
    C.offensiveFoulShare,
    C.foulTroubleStart,
    C.foulAvoidancePerFoulSquared,
    C.foulAvoidanceFloor,
    C.bonusFoulsRegulation,
    C.bonusFoulsOvertime,
    C.fouledShotMakeScale,
    ctx.homeCourt?.homeDefenseShotAdjustment ?? 0,
    ctx.homeCourt?.awayTurnoverPressureAdjustment ?? 0,
    ctx.havoc !== undefined ? 1 : 0,
    ctx.gameRule === 'twenty-second-clock' ? 1 : 0,
    ctx.gameRule === 'deep-four' ? 1 : 0,
    ctx.race !== undefined ? 1 : 0,
    ctx.effects !== undefined ? 1 : 0,
    ctx.apron !== undefined ? 1 : 0,
    profile.parameters.offensiveReboundRate,
    C.offensiveReboundScale,
    C.offensiveReboundRange,
    C.offensiveReboundRimBonus,
    C.offensiveReboundPerimeterPenalty,
    0.2,
    0.75,
    4,
    counts[0],
    counts[1],
    struckKeys[0] === null ? 0 : 1,
    struckKeys[1] === null ? 0 : 1,
    internalRng ? 1 : 0,
  ];
  const pickTables = new Map<number, PickTableEntry>();
  const table = (value: WeightedPickTable, items: readonly unknown[]): void => {
    pickTables.set(data.length, { items, table: value });
    data.push(value.total, ...value.weights);
  };
  const evidenceOf = (player: SimulationPlayer): HavocEvidence | undefined =>
    ctx.havoc?.evidenceOf(player);
  const variants: ReadonlyArray<(player: SimulationPlayer) => HavocEvidence | undefined> = [
    (player) => evidenceOf(player),
    () => ALL_AUTHORITATIVE,
  ];
  const variantCount = ctx.havoc?.changesEvidence?.() === true ? 2 : 1;
  for (const side of [0, 1] as const) {
    const other = side === 0 ? 1 : 0;
    const team = teams[side];
    const prep = preps[side];
    const defensePrep = preps[other];
    const count = counts[side];
    const shooters = counts[other];
    const keyOf = (player: SimulationPlayer): string => prep.keyOf(player);
    table(prep.initiatorPickTable, team.players);
    table(prep.foulerPickTable, team.players);
    table(prep.stealerPickTable, team.players);
    table(prep.rebounderPickTables[0], team.players);
    table(prep.rebounderPickTables[1], team.players);
    team.players.forEach((player, index) => {
      data.push(prep.freeThrowP[index] ?? freeThrowProbability(player, profile));
    });
    table(prep.freeThrowShooterPickTable, team.players);
    data.push(prep.offensiveReboundMean, prep.defensiveReboundMean, prep.spacing, prep.pressure);
    data.push(
      Math.min(
        0.9,
        Math.max(
          0.3,
          profile.parameters.stealShareOfTurnovers *
            (1 + (prep.stealAbility - C.stealNeutralAbility) / 100),
        ),
      ),
    );
    const awayPressure = side === 1 ? (ctx.homeCourt?.awayTurnoverPressureAdjustment ?? 0) : 0;
    const turnoverVariants: number[][] = [];
    for (let variant = 0; variant < variantCount; variant += 1) {
      const values: number[] = [];
      for (const player of team.players) {
        const effectsAdjustment =
          ctx.effects !== undefined
            ? ctx.effects.turnoverAdjustment({
                handlerVersion: playerVersion(player),
                offenseSide: side,
              }) / 1000000
            : 0;
        values.push(
          turnoverProbability(
            player,
            defensePrep.pressure,
            eraPoss,
            profile,
            awayPressure,
            effectsAdjustment,
            variants[variant]?.(player),
          ),
        );
      }
      turnoverVariants.push(values);
    }
    data.push(...(turnoverVariants[0] ?? []));
    data.push(...(turnoverVariants[1] ?? turnoverVariants[0] ?? []));
    for (const player of team.players) {
      const tables = prep.actionPickTables.get(keyOf(player));
      if (tables === undefined) throw new Error('possession: missing action tables');
      for (const start of POSSESSION_STARTS) table(tables.byStart[start], ACTION_TYPES);
    }
    for (const player of team.players) {
      const values = prep.passP.get(keyOf(player));
      if (values === undefined) throw new Error('possession: missing pass probabilities');
      data.push(...values);
    }
    for (const initiator of team.players) {
      const shots = prep.teammateShots.get(keyOf(initiator));
      if (shots === undefined) throw new Error('possession: missing teammate shots');
      for (const action of ACTION_TYPES) {
        const weights = shots.byAction[ACTION_TYPES.indexOf(action)];
        if (weights === undefined) throw new Error('possession: missing teammate weights');
        table(weights.pickTable, weights.teammates);
      }
    }
    for (const shooter of team.players) {
      const zones = prep.zonePrep.get(keyOf(shooter));
      if (zones === undefined) throw new Error('possession: missing zone preparation');
      for (const action of ACTION_TYPES) table(zones.actionPickTables[action], SHOT_ZONES);
    }
    for (let zoneIndex = 0; zoneIndex < SHOT_ZONES.length; zoneIndex += 1) {
      for (let shooterSlot = 0; shooterSlot < count; shooterSlot += 1) {
        const defenderTable = prep.defenderBase.pickTables[zoneIndex]?.[shooterSlot];
        if (defenderTable === undefined) throw new Error('possession: missing defender table');
        table(defenderTable, team.players);
      }
    }
    for (const defender of team.players) {
      for (const zone of SHOT_ZONES) data.push(contestPenalty(defender, zone));
    }
    const shotVariants: number[][][] = [];
    for (let variant = 0; variant < variantCount; variant += 1) {
      const arrays = Array.from({ length: 7 }, () => new Array<number>(count * 7 * 5));
      team.players.forEach((player, playerIndex) => {
        const anchor = prep.twoPointAnchor.get(keyOf(player)) ?? null;
        for (const action of ACTION_TYPES) {
          for (const zone of SHOT_ZONES) {
            const index =
              (playerIndex * 7 + ACTION_TYPES.indexOf(action)) * 5 + SHOT_ZONES.indexOf(zone);
            const values = shotComponents(
              player,
              profile,
              zone,
              action,
              prep.spacing,
              anchor,
              variants[variant]?.(player),
            );
            for (let component = 0; component < 7; component += 1) {
              const array = arrays[component];
              if (array !== undefined) array[index] = values[component] ?? 0;
            }
          }
        }
      });
      shotVariants.push(arrays);
    }
    for (let component = 0; component < 7; component += 1) {
      data.push(...(shotVariants[0]?.[component] ?? []));
    }
    for (let component = 0; component < 7; component += 1) {
      data.push(...(shotVariants[1]?.[component] ?? shotVariants[0]?.[component] ?? []));
    }
    for (const player of team.players) {
      data.push(prep.twoPointAnchor.get(keyOf(player)) ?? -1);
    }
    const blockVariants: Array<[number[], number[]]> = [];
    for (let variant = 0; variant < variantCount; variant += 1) {
      const counts = count * 7 * 5;
      const value = new Array<number>(counts);
      const maximum = new Array<number>(counts);
      team.players.forEach((player, playerIndex) => {
        for (const action of ACTION_TYPES) {
          for (const zone of SHOT_ZONES) {
            const index =
              (playerIndex * 7 + ACTION_TYPES.indexOf(action)) * 5 + SHOT_ZONES.indexOf(zone);
            const components = blockComponents(player, zone, action, variants[variant]?.(player));
            value[index] = components[0];
            maximum[index] = components[1];
          }
        }
      });
      blockVariants.push([value, maximum]);
    }
    data.push(...(blockVariants[0]?.[0] ?? []));
    data.push(...(blockVariants[1]?.[0] ?? blockVariants[0]?.[0] ?? []));
    data.push(...(blockVariants[0]?.[1] ?? []));
    data.push(...(blockVariants[1]?.[1] ?? blockVariants[0]?.[1] ?? []));
    for (const shooter of team.players) {
      for (const defender of teams[other].players) {
        for (const zone of SHOT_ZONES) {
          data.push(shootingFoulProbability(shooter, defender, zone, profile));
        }
      }
    }
    const assistVariants: number[][] = [];
    for (let variant = 0; variant < variantCount; variant += 1) {
      const values: number[] = [];
      for (const initiator of team.players) {
        for (const shooter of team.players) {
          for (const action of ACTION_TYPES) {
            for (const zone of SHOT_ZONES) {
              values.push(
                assistBase(
                  profile,
                  ctx.passingAnchorFactor,
                  initiator,
                  action,
                  zone,
                  shooter,
                  variants[variant]?.(initiator),
                ),
              );
            }
          }
        }
      }
      assistVariants.push(values);
    }
    data.push(...(assistVariants[0] ?? []));
    data.push(...(assistVariants[1] ?? assistVariants[0] ?? []));
    for (const shooter of team.players) {
      for (const defenseSide of [0, 1] as const) {
        data.push(
          ctx.effects !== undefined
            ? ctx.effects.makeAdjustment({
                shooterVersion: playerVersion(shooter),
                offenseSide: side,
                defenseSide,
              }) / 1000000
            : 0,
        );
      }
    }
    data.push(
      ctx.effects !== undefined ? ctx.effects.assistAdjustment({ offenseSide: side }) / 1000000 : 0,
    );
    data.push(struckKeys[side] === null ? 0 : 1);
    const adjusted = adjustedPreps[side];
    if (adjusted === null) {
      data.push(0);
    } else {
      const key = struckKeys[side];
      const pool = team.players.filter((player) => apronPlayerKeyOf(player) !== key);
      data.push(pool.length);
      for (const player of pool) data.push(team.players.indexOf(player));
      data.push(adjusted.defensiveReboundMean);
      table(adjusted.stealerPickTable, pool);
      table(adjusted.rebounderPickTables[1], pool);
      for (let zoneIndex = 0; zoneIndex < SHOT_ZONES.length; zoneIndex += 1) {
        for (let shooterSlot = 0; shooterSlot < shooters; shooterSlot += 1) {
          const defenderTable = adjusted.defenderBase.pickTables[zoneIndex]?.[shooterSlot];
          if (defenderTable === undefined) {
            table(zeroTable(pool.length), pool);
            continue;
          }
          table(defenderTable, pool);
        }
      }
      table(zeroTable(pool.length), pool);
    }
  }
  data[1] = data.length;
  const dynamicOffset = data.length;
  if (dynamicOffset + 35 > data.length + 35) throw new Error('possession: preparation overflow');
  return {
    prep: preps,
    struck: struckKeys,
    hasHavoc: ctx.havoc !== undefined,
    data: Float64Array.from(data),
    dynamicOffset,
    count: counts,
    internalRng,
    pickTables,
  };
}

const runtimes = new WeakMap<TripContext, Runtime>();

function evidenceState(ctx: TripContext, player: SimulationPlayer): number {
  const evidence = ctx.havoc?.evidenceOf(player);
  if (evidence === undefined) return 0;
  for (const channel of AUTHORITATIVE_CHANNELS) {
    if (!evidence.isAuthoritative(channel)) return 0;
  }
  return 2;
}

function playerAt(ctx: TripContext, side: SideIndex, index: number): SimulationPlayer {
  const player = ctx.teams[side].players[index];
  if (player === undefined) {
    throw new Error(`possession: no player at side ${String(side)} index ${String(index)}`);
  }
  return player;
}

function teamIndex(ctx: TripContext, side: SideIndex, player: SimulationPlayer): number {
  const index = ctx.teams[side].players.indexOf(player);
  if (index < 0) throw new Error('possession: hook returned a player outside the active unit');
  return index;
}

let sharedWasm: PossessionWasm | null = null;
let loadedLayout: StaticLayout | null = null;
let activeRuntime: Runtime | null = null;

function wasmRuntime(): PossessionWasm {
  if (sharedWasm !== null) return sharedWasm;
  compiled ??= new WebAssembly.Module(POSSESSION_WASM_BYTES);
  const kernel = (): PossessionWasm => {
    if (sharedWasm === null) throw new Error('possession: kernel is not initialized');
    return sharedWasm;
  };
  const memoryView = (pointer: number, length: number): Float64Array =>
    new Float64Array(kernel().memory.buffer, pointer, length);
  const current = (): Runtime => {
    if (activeRuntime === null) throw new Error('possession: no active trip runtime');
    return activeRuntime;
  };
  const instance = new WebAssembly.Instance(compiled, {
    env: {
      derived_create: () => {
        throw new Error('possession: derived RNG requires battle context');
      },
      derived_next_host: () => {
        throw new Error('possession: derived RNG requires battle context');
      },
      derived_pick_host: () => {
        throw new Error('possession: derived RNG requires battle context');
      },
      derived_int_host: () => {
        throw new Error('possession: derived RNG requires battle context');
      },
      rng_next: () => current().ctx.rng.next(),
      rng_chance: (probability: number) => (current().ctx.rng.chance(probability) ? 1 : 0),
      rng_pick: (pointer: number, length: number) => {
        const runtime = current();
        const offset = (pointer - kernel().input_ptr()) / 8;
        const entry = runtime.current?.pickTables.get(offset);
        if (entry === undefined) {
          throw new Error(
            `possession: missing pick table offset=${String(offset)} length=${String(length)}`,
          );
        }
        if (entry.items.length + 1 !== length) {
          throw new Error('possession: pick table length mismatch');
        }
        const selected = runtime.ctx.rng.weightedPickTable(entry.items, entry.table);
        const index = entry.items.indexOf(selected);
        if (index < 0) throw new Error('possession: RNG returned an unknown item');
        return index;
      },
      hook_sync: (remaining: number, clock: number, hasClock: number) => {
        const ctx = current().ctx;
        ctx.state.secondsRemaining = remaining;
        if (hasClock !== 0) {
          const target = ctx.shotClock ?? { remaining: clock };
          target.remaining = clock;
          ctx.shotClock = target;
        }
      },
      hook_full_clock: (side: number) => {
        const ctx = current().ctx;
        if (ctx.havoc === undefined) throw new Error('possession: missing havoc runtime');
        return ctx.havoc.fullShotClock(side as SideIndex);
      },
      hook_rebound_clock: (side: number) => {
        const ctx = current().ctx;
        if (ctx.havoc === undefined) throw new Error('possession: missing havoc runtime');
        return ctx.havoc.reboundShotClock(side as SideIndex);
      },
      hook_shot_clock_violation: (side: number, limit: number) => {
        current().ctx.havoc?.onShotClockViolation(side as SideIndex, limit);
      },
      hook_cancel_turnover: (offense: number, handler: number) => {
        const ctx = current().ctx;
        return ctx.havoc?.cancelTurnover(
          offense as SideIndex,
          playerAt(ctx, offense as SideIndex, handler),
        )
          ? 1
          : 0;
      },
      hook_turnover: (offense: number, handler: number, cancelled: number) => {
        const ctx = current().ctx;
        ctx.havoc?.onTurnover(
          offense as SideIndex,
          playerAt(ctx, offense as SideIndex, handler),
          cancelled !== 0,
        );
      },
      hook_steal: (defense: number, stealer: number) => {
        const ctx = current().ctx;
        ctx.havoc?.onSteal(defense as SideIndex, playerAt(ctx, defense as SideIndex, stealer));
      },
      hook_shot_plan: (
        out: number,
        offense: number,
        defense: number,
        shooter: number,
        zone: number,
        action: number,
        passed: number,
      ) => {
        const ctx = current().ctx;
        if (ctx.havoc === undefined) return 0;
        const offenseSide = offense as SideIndex;
        const defenseSide = defense as SideIndex;
        const plan = ctx.havoc.planShot({
          offense: offenseSide,
          defense: defenseSide,
          shooter: playerAt(ctx, offenseSide, shooter),
          zone: SHOT_ZONES[zone] ?? 'rim',
          action: ACTION_TYPES[action] ?? 'isolation',
          passed: passed !== 0,
        });
        const prep = ctx.preps[defenseSide];
        const slot =
          plan.defender === null
            ? -1
            : (prep.slotByPlayerId.get(prep.keyOf(plan.defender)) ??
              teamIndex(ctx, defenseSide, plan.defender));
        const target = memoryView(out, 28);
        target[0] = slot;
        target[1] = plan.coverage.contestScale;
        target[2] = plan.coverage.contestPointDelta;
        target[3] = plan.coverage.makePointDelta;
        target[4] = plan.coverage.blockPointDelta;
        target[5] = plan.shotKind === 'dunk' ? 2 : plan.shotKind === 'layup' ? 1 : 0;
        target[6] = plan.putback ? 1 : 0;
        target[7] = 0;
        if (plan.defender === null && ctx.havoc.shotReach !== undefined) {
          const defenders = ctx.teams[defenseSide].players;
          for (let index = 0; index < defenders.length; index += 1) {
            const defender = defenders[index];
            if (defender === undefined) continue;
            const reach = ctx.havoc.shotReach(defender, SHOT_ZONES[zone] ?? 'rim');
            target[8 + index] = reach.contestPointDelta;
            target[18 + index] = reach.blockPointDelta;
          }
        }
        return 1;
      },
      hook_foul: (
        out: number,
        foulerSide: number,
        fouler: number,
        offenseSide: number,
        shooter: number,
        shooting: number,
        made: number,
        inBonus: number,
        zone: number,
      ) => {
        const ctx = current().ctx;
        if (ctx.havoc === undefined) return 0;
        const foulerSideIndex = foulerSide as SideIndex;
        const offenseSideIndex = offenseSide as SideIndex;
        const awards = ctx.havoc.onFoul({
          fouler: playerAt(ctx, foulerSideIndex, fouler),
          foulerSide: foulerSideIndex,
          offenseSide: offenseSideIndex,
          shooter: shooter >= 0 ? playerAt(ctx, offenseSideIndex, shooter) : null,
          shooting: shooting !== 0,
          madeShot: made !== 0,
          inBonus: inBonus !== 0,
          zone: zone >= 0 ? (SHOT_ZONES[zone] ?? null) : null,
        });
        const target = memoryView(out, 8);
        target[0] = awards.freeThrowsAwarded;
        target[1] = awards.bonusAttempts;
        target[2] = awards.technicalFreeThrows;
        target[3] = awards.technicalForDefense ? 1 : 0;
        target[4] = awards.doubleOrNothingFreeThrows;
        return 1;
      },
      hook_field_goal: (
        offense: number,
        shooter: number,
        made: number,
        three: number,
        passed: number,
        shotKind: number,
        putback: number,
        zone: number,
      ) => {
        const runtime = current();
        const ctx = runtime.ctx;
        const offenseSide = offense as SideIndex;
        ctx.havoc?.onFieldGoal({
          offense: offenseSide,
          shooter: playerAt(ctx, offenseSide, shooter),
          made: made !== 0,
          three: three !== 0,
          passed: passed !== 0,
          shotKind: shotKind === 2 ? 'dunk' : shotKind === 1 ? 'layup' : 'jumper',
          putback: putback !== 0,
          zone: SHOT_ZONES[zone] ?? 'rim',
        });
        const layout = runtime.current;
        if (layout !== null && layout.hasHavoc && ctx.havoc !== undefined) {
          const evidenceOffset = 16 + layout.count[0] + layout.count[1];
          const index = evidenceOffset + (offenseSide === 0 ? 0 : layout.count[0]) + shooter;
          const target = memoryView(
            wasmRuntime().input_ptr() + (layout.dynamicOffset + index) * 8,
            1,
          );
          target[0] = evidenceState(ctx, playerAt(ctx, offenseSide, shooter));
        }
      },
      hook_free_throw: (side: number, shooter: number, made: number, bonus: number) => {
        const ctx = current().ctx;
        ctx.havoc?.onFreeThrow({
          side: side as SideIndex,
          shooter: playerAt(ctx, side as SideIndex, shooter),
          made: made !== 0,
          bonus: bonus !== 0,
        });
      },
      hook_assist: (offense: number, assister: number, scorer: number) => {
        const ctx = current().ctx;
        ctx.havoc?.onAssist(
          offense as SideIndex,
          playerAt(ctx, offense as SideIndex, assister),
          playerAt(ctx, offense as SideIndex, scorer),
        );
      },
      hook_rebound: (side: number, rebounder: number, offensive: number) => {
        const ctx = current().ctx;
        ctx.havoc?.onRebound(
          side as SideIndex,
          playerAt(ctx, side as SideIndex, rebounder),
          offensive !== 0,
        );
      },
      hook_block: (defense: number, blocker: number, shooter: number) => {
        const ctx = current().ctx;
        const defenseSide = defense as SideIndex;
        ctx.havoc?.onBlock(
          defenseSide,
          playerAt(ctx, defenseSide, blocker),
          playerAt(ctx, (1 - defenseSide) as SideIndex, shooter),
        );
      },
      hook_pass_intercepted: (passer: number, defender: number) => {
        const runtime = current();
        const ctx = runtime.ctx;
        const offenseSide = runtime.currentOffense;
        const defenseSide = (1 - offenseSide) as SideIndex;
        ctx.apron?.onPassIntercepted?.(
          playerAt(ctx, offenseSide, passer),
          playerAt(ctx, defenseSide, defender),
        );
      },
      hook_effects_trip: (
        _handlerValid: number,
        handler: number,
        shooterValid: number,
        shooter: number,
        defenderValid: number,
        defender: number,
        rebound0: number,
        rebound1: number,
      ) => {
        const runtime = current();
        const ctx = runtime.ctx;
        if (ctx.effects === undefined) return;
        const offense = runtime.currentOffense;
        const defense = (1 - offense) as SideIndex;
        ctx.effects.recordTrip({
          homeUnit: ctx.teamUnits[0],
          awayUnit: ctx.teamUnits[1],
          handler: playerVersion(playerAt(ctx, offense, handler)),
          ...(shooterValid !== 0
            ? { shooter: playerVersion(playerAt(ctx, offense, shooter)) }
            : {}),
          ...(defenderValid !== 0
            ? { defender: playerVersion(playerAt(ctx, defense, defender)) }
            : {}),
          reboundContestCounts: [rebound0, rebound1],
        });
      },
    },
  });
  const exported: unknown = instance.exports;
  sharedWasm = exported as PossessionWasm;
  return sharedWasm;
}

function createRuntime(ctx: TripContext, recorder: GameRecorder): Runtime {
  return {
    ctx,
    recorder,
    current: null,
    entries: [],
    currentOffense: 0,
  };
}
function loadStatic(runtime: Runtime, layout: StaticLayout): void {
  const target = new Float64Array(
    wasmRuntime().memory.buffer,
    wasmRuntime().input_ptr(),
    layout.data.length,
  );
  target.set(layout.data);
  runtime.current = layout;
  loadedLayout = layout;
}

function cacheEntry(runtime: Runtime): StaticLayout {
  const ctx = runtime.ctx;
  const struck: [string | null, string | null] = [struckKeyOf(ctx, 0), struckKeyOf(ctx, 1)];
  for (const entry of runtime.entries) {
    if (
      entry.prep[0] === ctx.preps[0] &&
      entry.prep[1] === ctx.preps[1] &&
      entry.struck[0] === struck[0] &&
      entry.struck[1] === struck[1] &&
      entry.hasHavoc === (ctx.havoc !== undefined) &&
      entry.internalRng === canUseInternalRng(ctx)
    ) {
      return entry;
    }
  }
  const layout = buildStatic(ctx);
  runtime.entries.push(layout);
  if (runtime.entries.length > 8) runtime.entries.shift();
  return layout;
}

function writeDynamic(runtime: Runtime, offense: SideIndex): void {
  const ctx = runtime.ctx;
  const layout = runtime.current;
  if (layout === null) throw new Error('possession: static preparation missing');
  const values = new Float64Array(
    wasmRuntime().memory.buffer,
    wasmRuntime().input_ptr() + layout.dynamicOffset * 8,
    16 + 2 * 10 + 2 * 10,
  );
  let clock = -1;
  if (ctx.havoc !== undefined) clock = ctx.havoc.fullShotClock(offense);
  else if (ctx.gameRule === 'twenty-second-clock') clock = 20;
  const race = ctx.race;
  const decided =
    race === undefined ? 0 : race.decided === 'home' ? 1 : race.decided === 'away' ? 2 : 0;
  values[0] = offense;
  values[1] = ctx.state.secondsRemaining;
  values[2] = ctx.state.periodIndex;
  values[3] = ctx.state.periodFouls[0];
  values[4] = ctx.state.periodFouls[1];
  values[5] = POSSESSION_STARTS.indexOf(ctx.possessionStart);
  values[6] = clock;
  values[7] = decided;
  values[8] = race?.home ?? 0;
  values[9] = race?.away ?? 0;
  values[10] = race?.target ?? 0;
  values[15] = layout.internalRng ? (ctx.rng.getState?.() ?? 0) >>> 0 : 0;
  for (const side of [0, 1] as const) {
    const forced = ctx.apron?.forcedActor(ctx.teams[side]) ?? null;
    values[11 + side] = forced === null ? -1 : teamIndex(ctx, side, forced);
    values[13 + side] = ctx.apron?.passInterceptionChance?.(side) ?? 0;
  }
  let cursor = 16;
  for (const side of [0, 1] as const) {
    const prep = ctx.preps[side];
    for (const player of ctx.teams[side].players) {
      values[cursor] = ctx.personalFouls[side].get(prep.keyOf(player)) ?? 0;
      cursor += 1;
    }
  }
  for (const side of [0, 1] as const) {
    for (const player of ctx.teams[side].players) {
      values[cursor] = ctx.havoc === undefined ? 0 : evidenceState(ctx, player);
      cursor += 1;
    }
  }
}

function applyTeam(team: RecorderSide, data: Float64Array, offset: number): void {
  const value = (index: number): number => data[offset + index] ?? 0;
  team.points += value(0);
  team.fieldGoalMakes += value(1);
  team.fieldGoalAttempts += value(2);
  team.threeMakes += value(3);
  team.threeAttempts += value(4);
  team.freeThrowMakes += value(5);
  team.freeThrowAttempts += value(6);
  team.offensiveRebounds += value(7);
  team.defensiveRebounds += value(8);
  team.assists += value(9);
  team.steals += value(10);
  team.blocks += value(11);
  team.turnovers += value(12);
  team.fouls += value(13);
  team.teamRebounds += value(14);
  team.possessions += value(15);
  team.freeThrowTrips += value(16);
  team.reboundOpportunities += value(17);
  team.assistedFieldGoals += value(18);
  team.unassistedFieldGoals += value(19);
  team.shotClockViolations += value(24);
  const points = value(0);
  if (points !== 0) {
    const last = team.periodPoints.length - 1;
    team.periodPoints[last] = (team.periodPoints[last] ?? 0) + points;
  }
  SHOT_ZONES.forEach((zone, index) => {
    team.zoneAttempts[zone] += value(25 + index);
    team.zoneMakes[zone] += value(30 + index);
  });
  team.deepAttempts += value(35);
  team.deepMakes += value(36);
}

function applyPlayer(player: RecorderPlayer, data: Float64Array, offset: number): void {
  const value = (index: number): number => data[offset + index] ?? 0;
  player.points += value(0);
  player.fieldGoalMakes += value(1);
  player.fieldGoalAttempts += value(2);
  player.threeMakes += value(3);
  player.threeAttempts += value(4);
  player.freeThrowMakes += value(5);
  player.freeThrowAttempts += value(6);
  player.offensiveRebounds += value(7);
  player.defensiveRebounds += value(8);
  player.assists += value(9);
  player.steals += value(10);
  player.blocks += value(11);
  player.turnovers += value(12);
  player.fouls += value(13);
  player.assistOpportunities += value(20);
  player.offensiveReboundChances += value(21);
  player.defensiveReboundChances += value(22);
  player.contestedShots += value(23);
  SHOT_ZONES.forEach((zone, index) => {
    player.zoneAttempts[zone] += value(25 + index);
    player.zoneMakes[zone] += value(30 + index);
  });
  player.deepAttempts += value(35);
  player.deepMakes += value(36);
}

function applyOutput(runtime: Runtime, output: Float64Array): void {
  const ctx = runtime.ctx;
  const layout = runtime.current;
  if (layout === null) throw new Error('possession: static preparation missing');
  ctx.state.secondsRemaining = output[2] ?? 0;
  ctx.state.periodFouls = [output[3] ?? 0, output[4] ?? 0];
  const start = POSSESSION_STARTS[output[5] ?? 0];
  if (start !== undefined) ctx.possessionStart = start;
  const clock = output[6] ?? -1;
  if (clock >= 0) {
    const target = ctx.shotClock ?? { remaining: clock };
    target.remaining = clock;
    ctx.shotClock = target;
  } else {
    delete ctx.shotClock;
  }
  const race = ctx.race;
  if (race !== undefined) {
    race.home = output[15] ?? race.home;
    race.away = output[16] ?? race.away;
    const decided = output[17] ?? 0;
    race.decided = decided === 1 ? 'home' : decided === 2 ? 'away' : null;
  }
  let cursor = 19;
  for (const side of [0, 1] as const) {
    const prep = ctx.preps[side];
    for (const player of ctx.teams[side].players) {
      ctx.personalFouls[side].set(prep.keyOf(player), output[cursor] ?? 0);
      cursor += 1;
    }
  }
  for (const side of [0, 1] as const) {
    const count = layout.count[side];
    const recorder = runtime.recorder;
    applyTeam(recorder.sides[side], output, cursor);
    cursor += STAT_FIELDS;
    const active = recorder.activeRosterIndices(side);
    for (let slot = 0; slot < count; slot += 1) {
      const rosterIndex = active[slot];
      const player = rosterIndex === undefined ? undefined : recorder.players[side][rosterIndex];
      if (player === undefined) {
        throw new Error(
          `possession: missing recorder player side=${String(side)} slot=${String(slot)} count=${String(count)} active=${String(active.length)} roster=${String(rosterIndex)}`,
        );
      }
      applyPlayer(player, output, cursor);
      cursor += STAT_FIELDS;
    }
  }
}

export function resolvePossessionTripWithWasm(
  ctx: TripContext,
  offenseSide: SideIndex,
  recorder: GameRecorder,
): boolean {
  let runtime = runtimes.get(ctx);
  if (runtime === undefined) {
    runtime = createRuntime(ctx, recorder);
    runtimes.set(ctx, runtime);
  }
  runtime.recorder = recorder;
  runtime.currentOffense = offenseSide;
  const previous = activeRuntime;
  activeRuntime = runtime;
  try {
    return runTrip(runtime, offenseSide);
  } finally {
    activeRuntime = previous;
  }
}

function runTrip(runtime: Runtime, offenseSide: SideIndex): boolean {
  const ctx = runtime.ctx;
  const layout = cacheEntry(runtime);
  if (loadedLayout !== layout) loadStatic(runtime, layout);
  writeDynamic(runtime, offenseSide);
  const status = wasmRuntime().run_trip();
  if (status !== 0) throw new Error(`possession kernel failed: ${String(status)}`);
  const output = new Float64Array(
    wasmRuntime().memory.buffer,
    wasmRuntime().output_ptr(),
    OUTPUT_DOUBLES,
  );
  applyOutput(runtime, output);
  if (layout.internalRng) ctx.rng.setState?.(output[18] ?? 0);
  return (output[0] ?? 0) !== 0;
}
