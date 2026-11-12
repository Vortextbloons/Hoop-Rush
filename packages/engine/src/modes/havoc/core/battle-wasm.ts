import type {
  EraSimulationProfile,
  HavocBattleEvent,
  HavocBattleInput,
  HavocBattleMutationRollup,
  HavocBattleScoringEntry,
  HavocBattleTeamInput,
  HavocHighlight,
  HavocMutationId,
  HavocTeamResult,
  HavocParticipant,
  HavocScoringSource,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_MUTATION_IDS,
  POSITIONS,
  REQUIRED_RATING_KEYS,
  havocAuthoritativeChannelSchema,
} from '@hoop-rush/data-contracts';
import { ENGINE_CONSTANTS as C } from '../../../sim/constants.ts';
import { meanTripSeconds, MAX_PERIODS_HARD_CAP } from '../../../sim/clock.ts';
import { HavocSimulationExhaustedError } from './battle-error.ts';
import { nonShootingFoulProbability } from '../../../sim/fouls.ts';
import { prepareTeam, type TeamPrep } from '../../../sim/prepare.ts';
import type { EngineContext } from '../../../sim/kernel.ts';
import type { HavocEvidence } from '../../../sim/havoc-runtime.ts';
import { POSSESSION_STARTS } from '../../../sim/possession-wasm.ts';
import { eraPossEstimatePerTrip, turnoverProbability } from '../../../sim/security.ts';
import {
  DEEP_FOUR_FT_MISS,
  DEEP_FOUR_MAKE_SCALE,
  DEEP_FOUR_SPLIT,
} from '../../../sim/evolution-rules.ts';
import { createRng, type Rng, type WeightedPickTable } from '../../../sim/rng.ts';
import { contestPenalty } from '../../../sim/shooting.ts';
import { ACTION_TYPES } from '../../../sim/usage.ts';
import { SHOT_ZONES } from '../../../domain/zones.ts';
import { freeThrowProbability, shootingFoulProbability } from '../../../sim/fouls.ts';
import {
  blockComponents,
  assistBase,
  shotComponents,
  zeroTable,
} from '../../../sim/possession-wasm.ts';
import { POSSESSION_WASM_BYTES } from '../../../sim/wasm/possession-wasm.gen.ts';

const CHANNELS = havocAuthoritativeChannelSchema.options;
const MUTATION_INDEX = new Map<HavocMutationId, number>(
  HAVOC_MUTATION_IDS.map((mutation, index) => [mutation, index]),
);
const ALL_AUTHORITATIVE = { isAuthoritative: () => true } as const;

export interface BattleApronSpec {
  readonly side: 0 | 1;
  readonly payroll: 1 | 2;
  readonly targetInstanceId: string;
  readonly handle: number;
}

export interface BattleKernel {
  memory: WebAssembly.Memory;
  battle_scratch_ptr(): number;
  battle_scratch_capacity(): number;
  battle_string_scratch_ptr(): number;
  battle_string_scratch_capacity(): number;
  battle_create(): number;
  battle_destroy(handle: number): void;
  battle_intern(handle: number, length: number): number;
  battle_init(handle: number, length: number): number;
  battle_participant_count(handle: number): number;
  battle_active_count(handle: number, side: number): number;
  battle_active_index(handle: number, side: number, slot: number): number;
  battle_struck_index(handle: number, side: number): number;
  battle_fill_team_spec(handle: number, side: number): number;
  battle_layout_ptr(handle: number, side: number, struck: number): number;
  battle_install_layout(handle: number, side: number, struck: number, length: number): number;
  battle_tipoff(handle: number): number;
  battle_open(handle: number): number;
  battle_begin_period(handle: number, period: number, seconds: number): number;
  battle_end_period(handle: number): number;
  battle_begin_possession(handle: number, possessionId: number, offense: number): number;
  battle_end_possession(handle: number, offense: number): void;
  battle_boundary(handle: number): number;
  battle_expire_extra(handle: number): void;
  battle_consume_extra(handle: number, side: number): number;
  battle_trip(handle: number, offense: number, seconds: number): number;
  battle_run_segment(
    handle: number,
    offense: number,
    seconds: number,
    first: number,
    possessionId: number,
  ): number;
  battle_finalize(handle: number, gameSeconds: number): number;
  battle_side_points_scalar(handle: number, side: number): number;
  battle_seconds(handle: number): number;
  battle_output_ptr(): number;
  battle_event_ptr(handle: number): number;
  battle_event_count(handle: number): number;
  battle_scoring_ptr(handle: number): number;
  battle_scoring_count(handle: number): number;
  apron_fact_player_ptr(handle: number, index: number, defender: number): number;
  apron_fact_player_len(handle: number, index: number, defender: number): number;
  apron_create(side: number, payroll: number): number;
  apron_destroy(handle: number): void;
  apron_reset(handle: number, side: number, payroll: number): number;
  apron_begin(handle: number, offense: number): number;
  apron_end(handle: number): void;
  apron_offense_ordinal(handle: number): number;
  apron_defense_ordinal(handle: number): number;
  apron_isolation(handle: number): number;
  apron_strike(handle: number): number;
  apron_interception_chance(handle: number, offense: number): number;
  apron_record_interception(handle: number): number;
  apron_fact_count(handle: number): number;
  apron_fact_kind(handle: number, index: number): number;
  apron_fact_ordinal(handle: number, index: number): number;
}

let compiled: WebAssembly.Module | undefined;
let kernel: BattleKernel | null = null;
let activeExternalRng: Rng | null = null;
let derivedFactory: EngineContext['rngFactory'] | null = null;
let derivedStreams: Rng[] = [];
type PickEntry = { items: readonly unknown[]; table: WeightedPickTable };
let activePickTables = new Map<number, PickEntry>();
let pendingPickTables: Array<{ offset: number; entry: PickEntry }> = [];
let collectPickTables = false;

function memoryView(
  start: number,
  length: number,
  Constructor: Float64ArrayConstructor,
): Float64Array {
  return new Constructor(currentKernel().memory.buffer, start, length);
}

function requiredStream(handle: number): Rng {
  const stream = derivedStreams[handle];
  if (stream === undefined) throw new Error('battle: missing derived RNG stream');
  return stream;
}
function currentKernel(): BattleKernel {
  if (kernel === null) throw new Error('havoc battle: kernel is not initialized');
  return kernel;
}

export function battleKernel(): BattleKernel {
  if (kernel !== null) return kernel;
  compiled ??= new WebAssembly.Module(POSSESSION_WASM_BYTES);
  const instance = new WebAssembly.Instance(compiled, {
    env: {
      derived_create: (pointer: number, length: number) => {
        if (derivedFactory === null) throw new Error('battle: missing derived RNG factory');
        const seed = new TextDecoder().decode(
          new Uint8Array(currentKernel().memory.buffer, pointer, length),
        );
        derivedStreams.push(derivedFactory(seed));
        return derivedStreams.length - 1;
      },
      derived_next_host: (handle: number) => requiredStream(handle).next(),
      derived_int_host: (handle: number, min: number, max: number) =>
        requiredStream(handle).nextInt(min, max),
      derived_pick_host: (handle: number, pointer: number, length: number, total: number) => {
        const weights = Array.from(
          new Float64Array(currentKernel().memory.buffer, pointer, length),
        );
        return requiredStream(handle).weightedPick(
          Array.from({ length }, (_, i) => i),
          { weights, total },
        );
      },
      rng_next: () => {
        if (activeExternalRng === null) throw new Error('havoc battle: missing external RNG');
        return activeExternalRng.next();
      },
      rng_chance: (probability: number) => {
        if (activeExternalRng === null) throw new Error('havoc battle: missing external RNG');
        return activeExternalRng.chance(probability) ? 1 : 0;
      },
      rng_pick: (pointer: number, length: number) => {
        if (activeExternalRng === null) throw new Error('havoc battle: missing external RNG');
        const entry = activePickTables.get(pointer);
        if (entry === undefined || entry.items.length + 1 !== length)
          throw new Error('battle: missing custom RNG pick table');
        const selected = activeExternalRng.weightedPickTable(entry.items, entry.table);
        const index = entry.items.indexOf(selected);
        if (index < 0) throw new Error('battle: custom RNG returned an unknown item');
        return index;
      },
      hook_sync: () => {
        throw new Error('havoc battle: trip hook_sync is not available in the battle kernel');
      },
      hook_full_clock: () => {
        throw new Error('havoc battle: trip hook_full_clock is not available in the battle kernel');
      },
      hook_rebound_clock: () => {
        throw new Error(
          'havoc battle: trip hook_rebound_clock is not available in the battle kernel',
        );
      },
      hook_shot_clock_violation: () => {
        throw new Error(
          'havoc battle: trip hook_shot_clock_violation is not available in the battle kernel',
        );
      },
      hook_cancel_turnover: () => {
        throw new Error(
          'havoc battle: trip hook_cancel_turnover is not available in the battle kernel',
        );
      },
      hook_turnover: () => {
        throw new Error('havoc battle: trip hook_turnover is not available in the battle kernel');
      },
      hook_steal: () => {
        throw new Error('havoc battle: trip hook_steal is not available in the battle kernel');
      },
      hook_shot_plan: () => {
        throw new Error('havoc battle: trip hook_shot_plan is not available in the battle kernel');
      },
      hook_foul: () => {
        throw new Error('havoc battle: trip hook_foul is not available in the battle kernel');
      },
      hook_field_goal: () => {
        throw new Error('havoc battle: trip hook_field_goal is not available in the battle kernel');
      },
      hook_free_throw: () => {
        throw new Error('havoc battle: trip hook_free_throw is not available in the battle kernel');
      },
      hook_assist: () => {
        throw new Error('havoc battle: trip hook_assist is not available in the battle kernel');
      },
      hook_rebound: () => {
        throw new Error('havoc battle: trip hook_rebound is not available in the battle kernel');
      },
      hook_block: () => {
        throw new Error('havoc battle: trip hook_block is not available in the battle kernel');
      },
      hook_pass_intercepted: () => {
        throw new Error(
          'havoc battle: trip hook_pass_intercepted is not available in the battle kernel',
        );
      },
      hook_effects_trip: () => {
        throw new Error(
          'havoc battle: trip hook_effects_trip is not available in the battle kernel',
        );
      },
    },
  });
  kernel = instance.exports as unknown as BattleKernel;
  return kernel;
}

function scratch(length: number): Float64Array {
  return new Float64Array(
    battleKernel().memory.buffer,
    battleKernel().battle_scratch_ptr(),
    length,
  );
}

const encoder = new TextEncoder();
function intern(handle: number, value: string): number {
  const bytes = encoder.encode(value);
  const capacity = battleKernel().battle_string_scratch_capacity();
  if (bytes.length > capacity) throw new Error('havoc battle: string table overflow');
  new Uint8Array(
    battleKernel().memory.buffer,
    battleKernel().battle_string_scratch_ptr(),
    bytes.length,
  ).set(bytes);
  const index = battleKernel().battle_intern(handle, bytes.length);
  if (index < 0) throw new Error('havoc battle: failed to intern a string');
  return index;
}

function channelMask(channels: readonly string[]): number {
  let mask = 0;
  for (const [index, channel] of CHANNELS.entries()) {
    if (channels.includes(channel)) mask |= 1 << index;
  }
  return mask;
}

function mutationBits(participant: HavocParticipant): {
  mask: number;
  order: [number, number, number];
} {
  let mask = 0;
  const order: [number, number, number] = [0, 0, 0];
  participant.mutationPackage.forEach((entry, index) => {
    const mutation = MUTATION_INDEX.get(entry.mutationId);
    if (mutation === undefined) return;
    mask += 2 ** mutation;
    if (index < 3) order[index] = mutation + 1;
  });
  return { mask, order };
}

interface ParticipantBinding {
  readonly participant: HavocParticipant;
  readonly team: HavocBattleTeamInput;
  readonly side: 0 | 1;
  readonly index: number;
}

function battleParticipants(input: HavocBattleInput): ParticipantBinding[] {
  const bindings: ParticipantBinding[] = [];
  for (const side of [0, 1] as const) {
    const team = side === 0 ? input.home : input.away;
    for (const participant of [...team.starters, ...team.replacements, ...team.clones]) {
      bindings.push({ participant, team, side, index: bindings.length });
    }
  }
  return bindings;
}

interface BattleInit {
  readonly handle: number;
  readonly bindings: ParticipantBinding[];
}

function initializeBattle(
  input: HavocBattleInput,
  context: EngineContext,
  apronSpecs: readonly BattleApronSpec[],
): BattleInit {
  const handle = battleKernel().battle_create();
  if (handle === 0) throw new Error('havoc battle: failed to create kernel state');
  try {
    const bindings = battleParticipants(input);
    const indexOfInstance = new Map(
      bindings.map((binding) => [binding.participant.instanceId, binding.index]),
    );
    const seed = intern(handle, input.seed);
    const ids = bindings.map((binding) => ({
      instance: intern(handle, binding.participant.instanceId),
      player: intern(handle, binding.participant.source.playerId),
      version:
        binding.participant.source.playerVersionId === null
          ? -1
          : intern(handle, binding.participant.source.playerVersionId),
    }));
    const externalRng = context.rngFactory !== createRng;
    const values: number[] = [];
    values.push(7, 1);
    values.push(input.gameNumber);
    values.push(seed);
    values.push((externalRng ? 1 : 0) | (apronSpecs.length > 0 ? 16 : 0));
    values.push(...battleConstantFields(input.profile));
    values.push(
      bindings.length,
      input.home.starters.length + input.home.replacements.length + input.home.clones.length,
      input.away.starters.length + input.away.replacements.length + input.away.clones.length,
    );
    values.push(apronSpecs.length);
    for (const spec of apronSpecs) {
      values.push(
        spec.side,
        spec.payroll,
        indexOfInstance.get(spec.targetInstanceId) ?? -1,
        spec.handle,
      );
    }
    bindings.forEach((binding, index) => {
      const participant = binding.participant;
      const physical = participant.effective.physical;
      const mutations = mutationBits(participant);
      values.push(
        binding.side,
        participant.kind === 'starter' ? 0 : participant.kind === 'replacement' ? 1 : 2,
      );
      values.push(POSITIONS.indexOf(participant.slot));
      values.push(
        participant.ownerInstanceId === null
          ? -1
          : (indexOfInstance.get(participant.ownerInstanceId) ?? -1),
      );
      values.push(participant.source.originalOverall);
      values.push(mutations.mask);
      values.push(...mutations.order);
      values.push(
        physical.heightInches,
        physical.weightLbs ?? 0,
        physical.wingspanDeltaInches,
        physical.reachUnits,
        physical.baselineHeightInches,
      );
      values.push(channelMask(participant.effective.authoritativeChannels));
      for (const key of REQUIRED_RATING_KEYS) values.push(participant.source.profile.ratings[key]);
      for (const key of Object.keys(participant.source.profile.tendencies) as Array<
        keyof typeof participant.source.profile.tendencies
      >) {
        values.push(participant.source.profile.tendencies[key]);
      }
      for (const key of REQUIRED_RATING_KEYS) values.push(participant.effective.ratings[key]);
      for (const key of Object.keys(participant.effective.tendencies) as Array<
        keyof typeof participant.effective.tendencies
      >) {
        values.push(participant.effective.tendencies[key]);
      }
      values.push(ids[index]?.instance ?? -1, ids[index]?.player ?? -1, ids[index]?.version ?? -1);
    });
    const target = scratch(values.length);
    target.set(values);
    const status = battleKernel().battle_init(handle, values.length);
    if (status !== 0) throw new Error(`havoc battle: kernel init failed (${String(status)})`);
    return { handle, bindings };
  } catch (error) {
    battleKernel().battle_destroy(handle);
    throw error;
  }
}

function battleConstantFields(profile: EraSimulationProfile): number[] {
  const eraPoss = eraPossEstimatePerTrip(profile) ?? 1;
  return [
    meanTripSeconds(profile),
    eraPoss,
    0.5 + (profile.parameters.assistAnchorRating - 50) / 100,
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
    0,
    0,
    profile.parameters.offensiveReboundRate,
    C.offensiveReboundScale,
    C.offensiveReboundRange,
    C.offensiveReboundRimBonus,
    C.offensiveReboundPerimeterPenalty,
    DEEP_FOUR_SPLIT,
    DEEP_FOUR_MAKE_SCALE,
    DEEP_FOUR_FT_MISS,
  ];
}

interface PreparedSide {
  readonly side: 0 | 1;
  readonly team: SimulationTeam;
  readonly prep: TeamPrep;
  defenseTeam: SimulationTeam;
  defensePrep: TeamPrep;
  readonly profile: EraSimulationProfile;
  readonly evidenceByPlayer: Map<SimulationPlayer, HavocEvidence | undefined>;
  readonly changesEvidence: boolean;
}

const PARTICIPANT_SPEC_FIELDS = 52;
const PARTICIPANT_RECORD_FIELDS = 50;

interface PreparedSideResult {
  readonly spec: Float64Array;
  readonly prepared: PreparedSide;
  readonly players: SimulationPlayer[];
  readonly bindings: ParticipantBinding[];
  readonly evidence: Map<SimulationPlayer, HavocEvidence>;
  readonly scale: Map<SimulationPlayer, number>;
  readonly reach: Map<SimulationPlayer, number>;
  readonly slots: Map<SimulationPlayer, number>;
}

function preparedSide(
  input: HavocBattleInput,
  handle: number,
  side: 0 | 1,
  allBindings: readonly ParticipantBinding[],
  previous?: PreparedSideResult,
): PreparedSideResult {
  const count = battleKernel().battle_active_count(handle, side);
  const length = battleKernel().battle_fill_team_spec(handle, side);
  const spec = scratch(length);
  if (
    previous?.spec.length === length &&
    spec.every((value, index) => value === previous.spec[index])
  ) {
    return previous;
  }
  let cursor = 1;
  const players: SimulationPlayer[] = [];
  const bindings: ParticipantBinding[] = [];
  const evidence = new Map<SimulationPlayer, HavocEvidence>();
  const scale = new Map<SimulationPlayer, number>();
  const reach = new Map<SimulationPlayer, number>();
  const slots = new Map<SimulationPlayer, number>();
  for (let slot = 0; slot < count; slot += 1) {
    const index = spec[cursor] ?? -1;
    const binding = allBindings[index];
    if (binding === undefined) {
      throw new Error('havoc battle: missing participant binding');
    }
    const base = cursor + 1;
    const source = binding.participant.source;
    const heightInches = spec[base] ?? 78;
    const weightLbs = spec[base + 1] ?? 215;
    const ratings = Object.fromEntries(
      REQUIRED_RATING_KEYS.map((key, field) => [key, spec[base + 5 + field] ?? 0]),
    ) as SimulationPlayer['ratings'];
    const tendencyFields = Object.keys(binding.participant.effective.tendencies) as Array<
      keyof SimulationPlayer['tendencies']
    >;
    const tendencies = Object.fromEntries(
      tendencyFields.map((key, field) => [key, spec[base + 23 + field] ?? 0]),
    ) as SimulationPlayer['tendencies'];
    const mask = spec[base + 46] ?? 0;
    const slotIndex = spec[base + 47] ?? 0;
    const player: SimulationPlayer = {
      playerId: source.playerId,
      ...(source.playerVersionId === null ? {} : { playerVersionId: source.playerVersionId }),
      displayName: source.displayName,
      positions: source.positions,
      heightInches: Math.round(heightInches),
      weightLbs: weightLbs <= 0 ? null : Math.round(weightLbs),
      ratings,
      tendencies,
      ...(source.profile.anchors === undefined ? {} : { anchors: source.profile.anchors }),
      ...(source.profile.reconstructedThreePoint === undefined
        ? {}
        : { reconstructedThreePoint: source.profile.reconstructedThreePoint }),
      overall: source.originalOverall,
    };
    players.push(player);
    bindings.push(binding);
    evidence.set(player, {
      isAuthoritative: (channel) => (mask & (1 << CHANNELS.indexOf(channel))) !== 0,
    });
    scale.set(player, spec[base + 48] ?? 1);
    reach.set(player, spec[base + 49] ?? 0);
    slots.set(player, slotIndex);
    cursor = base + PARTICIPANT_SPEC_FIELDS - 1;
  }
  const teamInput = side === 0 ? input.home : input.away;
  const team: SimulationTeam = {
    teamId: teamInput.teamId,
    displayName: teamInput.displayName,
    players: players,
  };
  const keyByPlayer = new Map<SimulationPlayer, string>();
  players.forEach((player, index) => {
    keyByPlayer.set(player, bindings[index]?.participant.instanceId ?? player.playerId);
  });
  const prepared: PreparedSide = {
    side,
    team,
    prep: prepareTeam(team, input.profile, {
      keyOf: (player) => keyByPlayer.get(player) ?? player.playerId,
      responsibilitySlotOf: (player) => slots.get(player) ?? 0,
      evidenceOf: (player) => evidence.get(player),
      aggregateDivisor: 5,
      rebounderWeightScale: (player) => scale.get(player) ?? 1,
      reboundMeanReach: (player) => reach.get(player) ?? 0,
    }),
    defenseTeam: team,
    defensePrep: undefined as unknown as TeamPrep,
    profile: input.profile,
    evidenceByPlayer: evidence,
    changesEvidence: input.home.starters
      .concat(input.away.starters)
      .some((participant) =>
        participant.mutationPackage.some((entry) => entry.mutationId === 'basketball-darwinism'),
      ),
  };
  return { spec: spec.slice(), prepared, players, bindings, evidence, scale, reach, slots };
}

function buildBattleTeamBlock(
  prepared: PreparedSide,
  books: [PreparedSideResult, PreparedSideResult],
  adjusted?: { readonly prep: TeamPrep; readonly pool: SimulationPlayer[] },
): number[] {
  const team = prepared.team;
  const prep = prepared.prep;
  const defense = books[(1 - prepared.side) as 0 | 1];
  const defensePrep = defense.prepared.prep;
  const count = team.players.length;
  const shooters = defense.prepared.team.players.length;
  const profile = prepared.profile;
  const changesEvidence = books[0].prepared.changesEvidence || books[1].prepared.changesEvidence;
  const data: number[] = [];
  const table = (value: WeightedPickTable, items: readonly unknown[] = team.players): void => {
    if (collectPickTables)
      pendingPickTables.push({ offset: data.length * 8, entry: { items, table: value } });
    data.push(value.total, ...value.weights);
  };
  const evidenceOf = (player: SimulationPlayer): HavocEvidence | undefined =>
    books[prepared.side].evidence.get(player);
  const variants = [evidenceOf, () => ALL_AUTHORITATIVE] as const;
  const variantCount = changesEvidence ? 2 : 1;
  const keyOf = (player: SimulationPlayer): string =>
    books[prepared.side].bindings[team.players.indexOf(player)]?.participant.instanceId ??
    player.playerId;
  table(prep.initiatorPickTable);
  table(prep.foulerPickTable);
  table(prep.stealerPickTable);
  table(prep.rebounderPickTables[0]);
  table(prep.rebounderPickTables[1]);
  team.players.forEach((player) =>
    data.push(
      prep.freeThrowP[team.players.indexOf(player)] ?? freeThrowProbability(player, profile),
    ),
  );
  table(prep.freeThrowShooterPickTable);
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
  const turnoverVariants: number[][] = [];
  for (let variant = 0; variant < variantCount; variant += 1) {
    const values: number[] = [];
    for (const player of team.players) {
      values.push(
        turnoverProbabilityFor(player, defensePrep.pressure, profile, variants[variant]?.(player)),
      );
    }
    turnoverVariants.push(values);
  }
  data.push(...(turnoverVariants[0] ?? []));
  data.push(...(turnoverVariants[1] ?? turnoverVariants[0] ?? []));
  for (const player of team.players) {
    const tables = prep.actionPickTables.get(keyOf(player));
    if (tables === undefined) throw new Error('havoc battle: missing action tables');
    for (const start of POSSESSION_STARTS) table(tables.byStart[start], ACTION_TYPES);
  }
  for (const player of team.players) {
    const values = prep.passP.get(keyOf(player));
    if (values === undefined) throw new Error('havoc battle: missing pass probabilities');
    data.push(...values);
  }
  for (const initiator of team.players) {
    const shots = prep.teammateShots.get(keyOf(initiator));
    if (shots === undefined) throw new Error('havoc battle: missing teammate shots');
    for (const action of ACTION_TYPES) {
      const weights = shots.byAction[ACTION_TYPES.indexOf(action)];
      if (weights === undefined) throw new Error('havoc battle: missing teammate weights');
      table(weights.pickTable, weights.teammates);
    }
  }
  for (const shooter of team.players) {
    const zones = prep.zonePrep.get(keyOf(shooter));
    if (zones === undefined) throw new Error('havoc battle: missing zone preparation');
    for (const action of ACTION_TYPES) table(zones.actionPickTables[action], SHOT_ZONES);
  }
  for (let zoneIndex = 0; zoneIndex < SHOT_ZONES.length; zoneIndex += 1) {
    for (let shooterSlot = 0; shooterSlot < count; shooterSlot += 1) {
      const defenderTable = prep.defenderBase.pickTables[zoneIndex]?.[shooterSlot];
      if (defenderTable === undefined) throw new Error('havoc battle: missing defender table');
      table(defenderTable);
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
  for (const player of team.players) data.push(prep.twoPointAnchor.get(keyOf(player)) ?? -1);
  const blockVariants: Array<[number[], number[]]> = [];
  for (let variant = 0; variant < variantCount; variant += 1) {
    const cells = count * 7 * 5;
    const value = new Array<number>(cells);
    const maximum = new Array<number>(cells);
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
    for (const defender of defense.prepared.team.players) {
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
                0.5 + (profile.parameters.assistAnchorRating - 50) / 100,
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
  data.push(...Array.from({ length: team.players.length * 2 }, () => 0));
  data.push(0);
  if (adjusted === undefined) {
    data.push(0);
    data.push(0);
  } else {
    const pool = adjusted.pool;
    data.push(1);
    data.push(pool.length);
    for (const player of pool) data.push(team.players.indexOf(player));
    data.push(adjusted.prep.defensiveReboundMean);
    table(adjusted.prep.stealerPickTable, pool);
    table(adjusted.prep.rebounderPickTables[1], pool);
    for (let zoneIndex = 0; zoneIndex < SHOT_ZONES.length; zoneIndex += 1) {
      for (let shooterSlot = 0; shooterSlot < shooters; shooterSlot += 1) {
        const defenderTable = adjusted.prep.defenderBase.pickTables[zoneIndex]?.[shooterSlot];
        if (defenderTable === undefined) {
          table(zeroTable(pool.length), pool);
          continue;
        }
        table(defenderTable, pool);
      }
    }
    table(zeroTable(pool.length), pool);
  }
  return data;
}

function turnoverProbabilityFor(
  player: SimulationPlayer,
  pressure: number,
  profile: EraSimulationProfile,
  evidence: HavocEvidence | undefined,
): number {
  return turnoverProbability(
    player,
    pressure,
    eraPossEstimatePerTrip(profile) ?? 1,
    profile,
    0,
    0,
    evidence,
  );
}
function sideName(side: number): 'home' | 'away' {
  return side === 0 ? 'home' : 'away';
}

function shotZoneName(zone: number): (typeof SHOT_ZONES)[number] {
  return SHOT_ZONES[zone] ?? 'rim';
}

function shotKindName(kind: number): 'layup' | 'dunk' | 'jumper' {
  return kind === 2 ? 'dunk' : kind === 1 ? 'layup' : 'jumper';
}

const SCORING_SOURCES: HavocScoringSource[] = [
  'roulette',
  'four-point-dunk',
  'reverse-basketball',
  'golden-assist',
  'double-or-nothing',
  'heat-check',
  'second-chance-jackpot',
  'the-bounty',
  'buzzer-bandit',
  'charity-casino',
  'cold-blooded',
  'triple-threat',
];

function scoringSourceName(source: number): HavocScoringSource {
  return SCORING_SOURCES[source] ?? 'roulette';
}

function decodeEvents(handle: number, bindings: readonly ParticipantBinding[]): HavocBattleEvent[] {
  const count = battleKernel().battle_event_count(handle);
  const pointer = battleKernel().battle_event_ptr(handle);
  const records = memoryView(pointer, count * 25, Float64Array);
  const instance = (index: number): string => {
    const binding = bindings[index];
    return binding?.participant.instanceId ?? '';
  };
  const side = (value: number): 'home' | 'away' => sideName(value);
  const events: HavocBattleEvent[] = [];
  for (let record = 0; record < count; record += 1) {
    const base = record * 25;
    const value = (field: number): number => records[base + field] ?? 0;
    const kind = value(0);
    const common = {
      sequence: value(1),
      gameNumber: value(2),
      period: value(3),
      clockSeconds: value(4),
    };
    let event: HavocBattleEvent;
    switch (kind) {
      case 1:
        event = { ...common, kind: 'period-start' };
        break;
      case 2:
        event = { ...common, kind: 'period-end', homeScore: value(5), awayScore: value(6) };
        break;
      case 3:
        event = {
          ...common,
          kind: 'possession-start',
          possessionId: value(5),
          offenseSide: side(value(6)),
        };
        break;
      case 4:
        event = {
          ...common,
          kind: 'shot-attempt',
          possessionId: value(11),
          shooterInstanceId: instance(value(5)),
          side: side(value(6)),
          zone: shotZoneName(value(7)),
          shotKind: shotKindName(value(8)),
          made: value(9) !== 0,
          nominalPoints: value(10) === 3 ? 3 : 2,
        };
        break;
      case 5:
        event = {
          ...common,
          kind: 'free-throw-attempt',
          possessionId: value(11),
          shooterInstanceId: instance(value(5)),
          side: side(value(6)),
          made: value(7) !== 0,
          bonus: value(8) !== 0,
        };
        break;
      case 6:
        event = {
          ...common,
          kind: 'rebound',
          possessionId: value(11),
          playerInstanceId: instance(value(5)),
          side: side(value(6)),
          offensive: value(7) !== 0,
        };
        break;
      case 7:
        event = {
          ...common,
          kind: 'assist',
          possessionId: value(11),
          assisterInstanceId: instance(value(5)),
          scorerInstanceId: instance(value(6)),
          side: side(value(7)),
        };
        break;
      case 8:
        event = {
          ...common,
          kind: 'steal',
          possessionId: value(11),
          stealerInstanceId: instance(value(5)),
          side: side(value(6)),
        };
        break;
      case 9:
        event = {
          ...common,
          kind: 'block',
          possessionId: value(11),
          blockerInstanceId: instance(value(5)),
          shooterInstanceId: instance(value(6)),
          side: side(value(7)),
        };
        break;
      case 10:
        event = {
          ...common,
          kind: 'turnover',
          possessionId: value(11),
          playerInstanceId: instance(value(5)),
          side: side(value(6)),
        };
        break;
      case 11:
        event = {
          ...common,
          kind: 'turnover-cancelled',
          possessionId: value(11),
          playerInstanceId: instance(value(5)),
          side: side(value(6)),
          originalSequence: value(7),
        };
        break;
      case 12:
        event = {
          ...common,
          kind: 'foul',
          possessionId: value(11),
          foulerInstanceId: instance(value(5)),
          side: side(value(6)),
          shooting: value(7) !== 0,
          shooterInstanceId: value(8) < 0 ? null : instance(value(8)),
          freeThrowsAwarded: value(9),
          technicalFreeThrows: value(10),
        };
        break;
      case 13:
        event = {
          ...common,
          kind: 'substitution',
          outInstanceId: instance(value(5)),
          inInstanceId: instance(value(6)),
          reason: 'foul-out',
        };
        break;
      case 14:
        event = {
          ...common,
          kind: 'shot-clock-violation',
          possessionId: value(5),
          offenseSide: side(value(6)),
          limitSeconds: value(7),
        };
        break;
      case 15:
        event = {
          ...common,
          kind: 'extra-possession',
          outcome: value(5) === 0 ? 'queued' : value(5) === 1 ? 'started' : 'expired',
          ownerInstanceId: instance(value(6)),
          side: side(value(7)),
          possessionId: value(8) < 0 ? null : value(8),
        };
        break;
      case 16:
        event = {
          ...common,
          kind: 'clone',
          outcome: value(5) === 0 ? 'entered' : 'exited',
          ownerInstanceId: instance(value(6)),
          cloneInstanceId: instance(value(7)),
          side: side(value(8)),
          reason: value(9) < 0 ? null : value(9) === 0 ? 'owner-exited' : 'fouled-out',
        };
        break;
      case 17:
        event = {
          ...common,
          kind: 'time-lord',
          side: side(value(5)),
          fullSeconds: value(6),
          reboundSeconds: value(7),
          source: value(8) === 0 ? 'tipoff' : 'owner-exit',
        };
        break;
      case 18:
        event = {
          ...common,
          kind: 'body-snatcher',
          outcome: value(5) === 0 ? 'applied' : 'ended',
          ownerInstanceId: instance(value(6)),
          targetInstanceId: instance(value(7)),
          side: side(value(8)),
        };
        break;
      case 19: {
        const capped = Array.from({ length: value(7) }, (_v, index) => instance(value(8 + index)));
        event = {
          ...common,
          kind: 'great-equalizer',
          outcome: value(5) === 0 ? 'applied' : 'updated',
          ownerInstanceId: instance(value(6)),
          cappedInstanceIds: capped,
        };
        break;
      }
      case 20:
        event = {
          ...common,
          kind: 'four-point-dunk',
          shooterInstanceId: instance(value(5)),
          side: side(value(6)),
          scoringSequence: value(7),
        };
        break;
      case 21:
        event = {
          ...common,
          kind: 'golden-assist',
          assisterInstanceId: instance(value(5)),
          side: side(value(6)),
          scoringSequence: value(7),
        };
        break;
      case 22:
        event = {
          ...common,
          kind: 'heat-check',
          outcome: value(5) === 0 ? 'armed' : value(5) === 1 ? 'consumed' : 'expired',
          ownerInstanceId: instance(value(6)),
          side: side(value(7)),
          scoringSequence: value(8) < 0 ? null : value(8),
        };
        break;
      case 23:
        event = {
          ...common,
          kind: 'putback',
          outcome: value(5) === 0 ? 'armed' : value(5) === 1 ? 'consumed' : 'lost',
          ownerInstanceId: instance(value(6)),
          side: side(value(7)),
          reboundSequence: value(8) < 0 ? null : value(8),
          scoringSequence: value(9) < 0 ? null : value(9),
        };
        break;
      case 24:
        event = {
          ...common,
          kind: 'and-one-bonus',
          shooterInstanceId: instance(value(5)),
          side: side(value(6)),
          foulSequence: value(7),
          bonusFreeThrows: value(8) === 2 ? 2 : 1,
        };
        break;
      case 25:
        event = {
          ...common,
          kind: 'double-or-nothing-foul',
          ownerInstanceId: instance(value(5)),
          side: side(value(6)),
          foulSequence: value(7),
          freeThrowsGranted: 1,
        };
        break;
      case 26:
        event = {
          ...common,
          kind: 'possession-refund',
          ownerInstanceId: instance(value(5)),
          side: side(value(6)),
          turnoverSequence: value(7),
        };
        break;
      case 27:
        event = {
          ...common,
          kind: 'rebound-loop',
          ownerInstanceId: instance(value(5)),
          side: side(value(6)),
          reboundOrdinal: value(7),
          granted: value(8),
        };
        break;
      case 28:
        event = {
          ...common,
          kind: 'bounty',
          outcome: value(5) === 0 ? 'armed' : value(5) === 1 ? 'consumed' : 'expired',
          ownerInstanceId: instance(value(6)),
          side: side(value(7)),
          blockedInstanceId: value(8) < 0 ? null : instance(value(8)),
          scoringSequence: value(9) < 0 ? null : value(9),
        };
        break;
      case 29:
        event = {
          ...common,
          kind: 'foul-relief',
          ownerInstanceId: instance(value(5)),
          side: side(value(6)),
          foulSequence: value(7),
          chargedFoulsAfter: value(8),
        };
        break;
      case 30:
        event = {
          ...common,
          kind: 'roulette',
          ownerInstanceId: instance(value(5)),
          side: side(value(6)),
          attemptOrdinal: value(7),
          rolled: value(8),
          nominal: value(9) === 3 ? 3 : 2,
          scoringSequence: value(10) < 0 ? null : value(10),
        };
        break;
      case 31:
        event = {
          ...common,
          kind: 'buzzer-bandit',
          outcome: value(5) === 0 ? 'doubled' : 'penalized',
          ownerInstanceId: instance(value(6)),
          shooterInstanceId: instance(value(7)),
          side: side(value(8)),
          shotClockTenths: value(9),
          scoringSequence: value(10) < 0 ? null : value(10),
        };
        break;
      case 32:
        event = {
          ...common,
          kind: 'charity-casino',
          outcome: value(5) === 0 ? 'made' : 'missed',
          ownerInstanceId: instance(value(6)),
          side: side(value(7)),
          scoringSequence: value(8) < 0 ? null : value(8),
          bonusSequence: value(9) < 0 ? null : value(9),
        };
        break;
      case 33:
        event = {
          ...common,
          kind: 'fusion-dance',
          outcome: value(5) === 0 ? 'applied' : 'ended',
          ownerInstanceId: instance(value(6)),
          donorInstanceId: instance(value(7)),
          side: side(value(8)),
        };
        break;
      case 34:
        event = {
          ...common,
          kind: 'darwinism',
          ownerInstanceId: instance(value(5)),
          side: side(value(6)),
          shooterInstanceId: instance(value(7)),
          shooterDecayAfter: value(8),
        };
        break;
      case 35:
        event = {
          ...common,
          kind: 'cold-blooded',
          outcome:
            value(5) === 0
              ? 'armed'
              : value(5) === 1
                ? 'consumed'
                : value(5) === 2
                  ? 'reset'
                  : 'penalty',
          ownerInstanceId: instance(value(6)),
          side: side(value(7)),
          missStreak: value(8),
          scoringSequence: value(9) < 0 ? null : value(9),
        };
        break;
      case 36:
        event = {
          ...common,
          kind: 'triple-threat',
          outcome:
            value(5) === 0
              ? 'progress'
              : value(5) === 1
                ? 'earned'
                : value(5) === 2
                  ? 'consumed'
                  : 'reset',
          ownerInstanceId: instance(value(6)),
          side: side(value(7)),
          shotClass:
            value(8) < 0 ? null : value(8) === 0 ? 'rim' : value(8) === 1 ? 'midrange' : 'three',
          scoringSequence: value(9) < 0 ? null : value(9),
        };
        break;
      case 37: {
        const resized = Array.from({ length: value(8) }, (_v, index) => instance(value(9 + index)));
        event = {
          ...common,
          kind: 'oops-all-centers',
          outcome: 'applied',
          ownerInstanceId: instance(value(6)),
          side: side(value(7)),
          resizedInstanceIds: resized,
        };
        break;
      }
      case 38:
        event = {
          ...common,
          kind: 'hostile-takeover',
          outcome: 'applied',
          ownerInstanceId: instance(value(6)),
          side: side(value(7)),
          fromInstanceId: instance(value(8)),
          toInstanceId: instance(value(9)),
        };
        break;
      case 39:
        event = {
          ...common,
          kind: 'game-end',
          homeScore: value(5),
          awayScore: value(6),
          winner: value(7) === 0 ? 'home' : 'away',
        };
        break;
      default:
        throw new Error(`havoc battle: unknown event kind ${String(kind)}`);
    }
    events.push(event);
  }
  return events;
}

function decodeScoring(
  handle: number,
  bindings: readonly ParticipantBinding[],
): HavocBattleScoringEntry[] {
  const count = battleKernel().battle_scoring_count(handle);
  const pointer = battleKernel().battle_scoring_ptr(handle);
  const records = memoryView(pointer, count * 44, Float64Array);
  const instance = (index: number): string => bindings[index]?.participant.instanceId ?? '';
  const entries: HavocBattleScoringEntry[] = [];
  for (let record = 0; record < count; record += 1) {
    const base = record * 44;
    const value = (field: number): number => records[base + field] ?? 0;
    const kinds = ['field-goal', 'free-throw', 'adjustment', 'bonus'] as const;
    const addends = Array.from({ length: value(12) }, (_v, index) => ({
      source: scoringSourceName(value(20 + index * 2)),
      points: value(21 + index * 2),
    }));
    const multipliers: HavocBattleScoringEntry['multipliers'] = Array.from(
      { length: value(13) },
      (_v, index) => ({
        source: scoringSourceName(value(36 + index * 2)),
        factor: value(37 + index * 2) === 3 ? 3 : 2,
      }),
    );
    const owners = Array.from({ length: value(14) }, (_v, index) => instance(value(15 + index)));
    entries.push({
      sequence: value(0),
      gameNumber: value(1),
      period: value(2),
      clockSeconds: value(3),
      possessionId: value(4),
      side: sideName(value(5)),
      kind: kinds[value(6)] ?? 'adjustment',
      actorInstanceId: instance(value(7)),
      beneficiaryInstanceId: value(8) < 0 ? null : instance(value(8)),
      nominalPoints: value(9),
      addends,
      multipliers,
      points: value(10),
      owners,
      originalEventSequence: value(11) < 0 ? null : value(11),
    });
  }
  return entries;
}

interface BattleRawOutput {
  readonly home: HavocTeamResult;
  readonly away: HavocTeamResult;
  readonly events: HavocBattleEvent[];
  readonly scoring: HavocBattleScoringEntry[];
  readonly rollups: HavocBattleMutationRollup[];
  readonly highlights: HavocHighlight[];
  readonly overtimePeriods: number;
}

function decodeTeam(
  input: HavocBattleInput,
  bindings: readonly ParticipantBinding[],
  side: 0 | 1,
  teamRecord: Float64Array,
  participantRecords: Float64Array,
  periods: number[][],
): HavocTeamResult {
  const value = (field: number): number => teamRecord[field] ?? 0;
  const stats = (field: number): number => value(2 + field);
  const points = value(1);
  const fgm = stats(1);
  const fga = stats(2);
  const tpm = stats(3);
  const tpa = stats(4);
  const ftm = stats(5);
  const fta = stats(6);
  const nominal = (fgm - tpm) * 2 + tpm * 3 + ftm;
  const teamInput = side === 0 ? input.home : input.away;
  const lines = [];
  for (
    let record = 0;
    record < participantRecords.length / PARTICIPANT_RECORD_FIELDS;
    record += 1
  ) {
    const base = record * PARTICIPANT_RECORD_FIELDS;
    const participant = bindings[record]?.participant;
    if (participant === undefined || bindings[record]?.side !== side) continue;
    if ((participantRecords[base + 6] ?? 0) === 0) continue;
    const stat = (field: number): number => participantRecords[base + 10 + field] ?? 0;
    const playerPoints = participantRecords[base + 9] ?? 0;
    const playerFgm = stat(1);
    const playerTpm = stat(3);
    const playerFtm = stat(5);
    const playerNominal = (playerFgm - playerTpm) * 2 + playerTpm * 3 + playerFtm;
    const secondsPlayed = participantRecords[base + 4] ?? 0;
    lines.push({
      instanceId: participant.instanceId,
      kind: participant.kind,
      slot: participant.slot,
      ownerInstanceId: participant.ownerInstanceId,
      sourcePlayerId: participant.source.playerId,
      sourcePlayerVersionId: participant.source.playerVersionId,
      displayName: participant.source.displayName,
      secondsPlayed,
      minutes: Math.round(secondsPlayed / 60),
      points: playerPoints,
      fieldGoals: { made: playerFgm, attempted: stat(2) },
      threes: { made: playerTpm, attempted: stat(4) },
      freeThrows: { made: stat(5), attempted: stat(6) },
      rebounds: { total: stat(7) + stat(8), offensive: stat(7), defensive: stat(8) },
      assists: stat(9),
      steals: stat(10),
      blocks: stat(11),
      turnovers: stat(12),
      fouls: stat(13),
      chargedFouls: participantRecords[base + 5] ?? 0,
      adjustments: playerPoints - playerNominal,
    });
  }
  return {
    side: side === 0 ? 'home' : 'away',
    teamId: teamInput.teamId,
    displayName: teamInput.displayName,
    points,
    fieldGoals: { made: fgm, attempted: fga },
    threes: { made: tpm, attempted: tpa },
    freeThrows: { made: ftm, attempted: fta },
    rebounds: {
      total: stats(7) + stats(8) + stats(14),
      offensive: stats(7),
      defensive: stats(8),
      team: stats(14),
    },
    assists: stats(9),
    steals: stats(10),
    blocks: stats(11),
    turnovers: stats(12),
    fouls: stats(13),
    adjustments: points - nominal,
    teamBonusPoints: value(42),
    periods: periods[side] ?? [],
    courtSeconds: value(43),
    participants: lines,
  };
}

function decodeOutput(
  input: HavocBattleInput,
  handle: number,
  bindings: readonly ParticipantBinding[],
  overtimePeriods: number,
): BattleRawOutput {
  const pointer = battleKernel().battle_output_ptr();
  const output = memoryView(pointer, 65536, Float64Array);
  const header = (field: number): number => output[field] ?? 0;
  const teamCount = header(0);
  const participantCount = header(1);
  const rollupCount = header(2);
  const highlightCount = header(3);
  let cursor = 16;
  const teamRecords = output.subarray(cursor, cursor + teamCount * 44);
  cursor += teamCount * 44;
  const participantRecords = output.subarray(
    cursor,
    cursor + participantCount * PARTICIPANT_RECORD_FIELDS,
  );
  cursor += participantCount * PARTICIPANT_RECORD_FIELDS;
  const rollupRecords = output.subarray(cursor, cursor + rollupCount * 15);
  cursor += rollupCount * 15;
  const highlightRecords = output.subarray(cursor, cursor + highlightCount * 6);
  cursor += highlightCount * 6;
  const periods: number[][] = [[], []];
  for (let side = 0; side < 2; side += 1) {
    const sideIndex = output[cursor] ?? 0;
    cursor += 1;
    const count = output[cursor] ?? 0;
    cursor += 1;
    const values = Array.from({ length: count }, (_value, index) => output[cursor + index] ?? 0);
    cursor += count;
    periods[sideIndex === 0 ? 0 : 1] = values;
  }
  const rollups: HavocBattleMutationRollup[] = [];
  for (let record = 0; record < rollupCount; record += 1) {
    const base = record * 15;
    const value = (field: number): number => rollupRecords[base + field] ?? 0;
    const owner = bindings[value(0)]?.participant;
    if (owner === undefined) continue;
    rollups.push({
      ownerInstanceId: owner.instanceId,
      mutationId: HAVOC_MUTATION_IDS[value(1)] ?? 'growth-spurt',
      side: sideName(value(2)),
      triggers: value(3),
      pointsDelta: value(4),
      freeThrowsGranted: value(5),
      turnoversCancelled: value(6),
      extraPossessionsEarned: value(7),
      extraPossessionsUsed: value(8),
      extraPossessionsExpired: value(9),
      swapPoints: value(10),
      swapSeconds: value(12),
      capSeconds: value(13),
      activeSeconds: value(14),
      ratingChanges: value(11),
    });
  }
  const highlightKinds = ['mutation', 'foul-out', 'negative-score'] as const;
  const highlights: HavocHighlight[] = [];
  for (let record = 0; record < highlightCount; record += 1) {
    const base = record * 6;
    const value = (field: number): number => highlightRecords[base + field] ?? 0;
    highlights.push({
      kind: highlightKinds[value(0)] ?? 'mutation',
      period: value(1),
      clockSeconds: value(2),
      instanceId: value(3) < 0 ? null : (bindings[value(3)]?.participant.instanceId ?? null),
      mutationId: value(4) < 0 ? null : (HAVOC_MUTATION_IDS[value(4)] ?? null),
      pointsDelta: value(5),
    });
  }
  const homeRecord = teamRecords.subarray(0, 44);
  const awayRecord = teamRecords.subarray(44, 88);
  return {
    home: decodeTeam(input, bindings, 0, homeRecord, participantRecords, periods),
    away: decodeTeam(input, bindings, 1, awayRecord, participantRecords, periods),
    events: decodeEvents(handle, bindings),
    scoring: decodeScoring(handle, bindings),
    rollups,
    highlights,
    overtimePeriods,
  };
}

export class HavocBattleWasmSimulation {
  private readonly input: HavocBattleInput;
  private readonly context: EngineContext;
  private readonly init: BattleInit;
  private offense: 0 | 1 = 0;
  private period = 1;
  private seconds = 720;
  private possessionId = 0;
  private books?: [PreparedSideResult, PreparedSideResult];
  private struck: [number, number] = [-1, -1];

  constructor(
    input: HavocBattleInput,
    context: EngineContext,
    apronSpecs: readonly BattleApronSpec[] = [],
  ) {
    this.input = input;
    this.context = context;
    this.init = initializeBattle(input, context, apronSpecs);
  }

  private installLayouts(): void {
    const books: [PreparedSideResult, PreparedSideResult] = [
      preparedSide(this.input, this.init.handle, 0, this.init.bindings, this.books?.[0]),
      preparedSide(this.input, this.init.handle, 1, this.init.bindings, this.books?.[1]),
    ];
    const struck: [number, number] = [
      battleKernel().battle_struck_index(this.init.handle, 0),
      battleKernel().battle_struck_index(this.init.handle, 1),
    ];
    if (
      this.books?.[0] === books[0] &&
      this.books[1] === books[1] &&
      this.struck[0] === struck[0] &&
      this.struck[1] === struck[1]
    )
      return;
    this.books = books;
    this.struck = struck;
    const preparedBooks: [PreparedSide, PreparedSide] = [books[0].prepared, books[1].prepared];
    preparedBooks[0].defenseTeam = books[1].prepared.team;
    preparedBooks[0].defensePrep = books[1].prepared.prep;
    preparedBooks[1].defenseTeam = books[0].prepared.team;
    preparedBooks[1].defensePrep = books[0].prepared.prep;
    for (const side of [0, 1] as const) {
      const prepared = preparedBooks[side];
      const normal = buildBattleTeamBlock(prepared, books);
      this.writeLayout(side, 0, normal);
      const struckIndex = battleKernel().battle_struck_index(this.init.handle, side);
      if (struckIndex < 0) continue;
      const struckSlot = books[side].bindings.findIndex((binding) => binding.index === struckIndex);
      const pool = books[side].players.filter((_player, slot) => slot !== struckSlot);
      const team: SimulationTeam = {
        teamId: prepared.team.teamId,
        displayName: prepared.team.displayName,
        players: pool,
      };
      const keyByPlayer = new Map<SimulationPlayer, string>();
      books[side].players.forEach((player, slot) => {
        keyByPlayer.set(
          player,
          books[side].bindings[slot]?.participant.instanceId ?? player.playerId,
        );
      });
      const adjustedPrep = prepareTeam(team, this.input.profile, { aggregateDivisor: 5 });
      const struck = buildBattleTeamBlock(prepared, books, { prep: adjustedPrep, pool });
      this.writeLayout(side, 1, struck);
    }
  }

  private writeLayout(side: 0 | 1, struck: 0 | 1, data: readonly number[]): void {
    const target = scratch(data.length);
    target.set(data);
    const status = battleKernel().battle_install_layout(
      this.init.handle,
      side,
      struck,
      data.length,
    );
    if (status !== 0) throw new Error(`havoc battle: layout install failed (${String(status)})`);
    if (collectPickTables) {
      const pointer = battleKernel().battle_layout_ptr(this.init.handle, side, struck);
      for (const { offset, entry } of pendingPickTables)
        activePickTables.set(pointer + offset, entry);
      pendingPickTables = [];
    }
  }

  run(): BattleRawOutput {
    const handle = this.init.handle;
    const previousRng = activeExternalRng;
    const previousFactory = derivedFactory;
    const previousStreams = derivedStreams;
    const previousPickTables = activePickTables;
    const previousPendingPickTables = pendingPickTables;
    const previousCollectPickTables = collectPickTables;
    try {
      derivedFactory = this.context.rngFactory;
      derivedStreams = [];
      activePickTables = new Map();
      pendingPickTables = [];
      collectPickTables = this.context.rngFactory !== createRng;
      if (battleKernel().battle_tipoff(handle) !== 0) {
        throw new Error('havoc battle: tipoff failed');
      }
      this.installLayouts();
      activeExternalRng =
        this.context.rngFactory === createRng ? null : this.context.rngFactory(this.input.seed);
      this.offense = battleKernel().battle_open(handle) === 0 ? 0 : 1;
      this.period = 1;
      this.seconds = 720;
      this.possessionId = 0;
      for (;;) {
        this.playPeriod();
        battleKernel().battle_end_period(handle);
        const home = battleKernel().battle_side_points_scalar(handle, 0);
        const away = battleKernel().battle_side_points_scalar(handle, 1);
        if (this.period >= 4 && home !== away) break;
        if (this.period >= MAX_PERIODS_HARD_CAP) {
          throw new HavocSimulationExhaustedError(
            this.period,
            home,
            away,
            `seed ${this.input.seed} game ${String(this.input.gameNumber)}`,
          );
        }
        this.period += 1;
        this.seconds = this.period <= 4 ? 720 : 300;
        battleKernel().battle_begin_period(handle, this.period, this.seconds);
      }
      const overtimePeriods = Math.max(0, this.period - 4);
      const gameSeconds = 4 * 720 + overtimePeriods * 300;
      battleKernel().battle_finalize(handle, gameSeconds);
      return decodeOutput(this.input, handle, this.init.bindings, overtimePeriods);
    } finally {
      activeExternalRng = previousRng;
      derivedFactory = previousFactory;
      derivedStreams = previousStreams;
      activePickTables = previousPickTables;
      pendingPickTables = previousPendingPickTables;
      collectPickTables = previousCollectPickTables;
      battleKernel().battle_destroy(handle);
    }
  }

  private playPeriod(): void {
    let first = true;
    while (this.seconds > 0) {
      const status = battleKernel().battle_run_segment(
        this.init.handle,
        this.offense,
        this.seconds,
        first ? 1 : 0,
        this.possessionId,
      );
      if (status >>> 0 >= 0xfffffffe) throw new Error('havoc battle: trip kernel error');
      const output = scratch(4);
      this.offense = (output[0] ?? 0) as 0 | 1;
      this.seconds = output[1] ?? 0;
      this.possessionId = output[2] ?? 0;
      first = false;
      if ((status & 1) !== 0) this.installLayouts();
      if ((status & 2) !== 0) break;
    }
  }
}
