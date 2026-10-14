import type {
  HavocEvent,
  HavocGameInput,
  HavocGameResult,
  HavocGameTape,
  HavocHighlight,
  HavocMutationId,
  HavocMutationRollup,
  HavocParticipant,
  HavocParticipantKind,
  HavocParticipantLine,
  HavocScoringEntry,
  HavocScoringSource,
  HavocShotKind,
  HavocSide,
  HavocTeamInput,
  HavocTeamResult,
  Position,
  SimulationPlayer,
  SimulationRatings,
  SimulationTeam,
  ShotZone,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_PERSONAL_FOUL_LIMIT,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
  HAVOC_SCORING_RATING_FIELDS,
  POSITIONS,
  REQUIRED_RATING_KEYS,
  havocAuthoritativeChannelSchema,
  havocGameInputSchema,
  havocGameResultSchema,
  havocGameTapeSchema,
  seasonDigestHex,
  seedSchema,
} from '@hoop-rush/data-contracts';
import type { EngineContext } from '../../sim/kernel.ts';
import type { Rng } from '../../sim/rng.ts';
import {
  MAX_PERIODS_HARD_CAP,
  OVERTIME_PERIOD_SECONDS,
  REGULATION_PERIOD_SECONDS,
} from '../../sim/clock.ts';
import { GameRecorder, type SideIndex } from '../../sim/recorder.ts';
import {
  createGameState,
  createTripContext,
  resolveTrip,
  type TripContext,
} from '../../sim/possession.ts';
import { prepareTeam } from '../../sim/prepare.ts';
import { pickDefender } from '../../sim/usage.ts';
import { sameGroupMatchWeight } from '../../sim/position-responsibilities.ts';
import { freeThrowsForZone } from '../../sim/fouls.ts';
import { ENGINE_CONSTANTS } from '../../sim/constants.ts';
import { clamp } from '../../domain/math.ts';
import type {
  HavocCoveragePlan,
  HavocEvidence,
  HavocFoulResult,
  HavocRuntimeHooks,
  HavocShotPlan,
} from '../../sim/havoc-runtime.ts';
import { havocCapabilityTargets } from './input.ts';
import { havocGameInputDigest } from './digests.ts';

const HAVOC_RUNTIME_SEED_ROOT = 'havoc-runtime-v1';
const HAVOC_DUNK_BASE = 0.15;
const HAVOC_DUNK_VERTICAL_WEIGHT = 0.45;
const HAVOC_DUNK_INSIDE_WEIGHT = 0.2;
const HAVOC_DUNK_HEIGHT_WEIGHT = 0.02;
const HAVOC_UNCOVERED_CONTEST_SCALE = 0.35;
const HAVOC_HELP_PRESSURE_CAP = 0.05;
const HAVOC_CONTEST_REACH_POINTS = 0.015;
const HAVOC_BLOCK_REACH_POINTS = 0.02;
const HAVOC_FINISH_HEIGHT_POINTS = 0.015;
const HAVOC_WINGSPAN_REBOUND_WEIGHT = 0.1;
const HAVOC_EQUALIZER_CAP = 85;
const HAVOC_HIGHLIGHT_LIMIT = 16;
const HAVOC_HEAT_STREAK_ARMS_AT = 3;
const HAVOC_HEAT_EXPIRY_POSSESSIONS = 3;
const HAVOC_BOUNTY_EXPIRY_POSSESSIONS = 3;
const HAVOC_ROULETTE_EVERY_ATTEMPTS = 5;
const HAVOC_ROULETTE_MIN = 1;
const HAVOC_ROULETTE_MAX = 4;
const HAVOC_REBOUND_LOOP_EVERY = 4;
const HAVOC_GOLDEN_ASSIST_EVERY = 3;
const HAVOC_DOUBLE_OR_NOTHING_FOUL_FREE_THROWS = 1;
const HAVOC_DOUBLE_MISS_PENALTY = -1;
const HAVOC_EXTRA_POSSESSION_RUSH_SECONDS = 12;
const HAVOC_BUZZER_WINDOW_TENTHS = 30;
const HAVOC_BUZZER_MISS_PENALTY = -1;
const HAVOC_FUSION_DONOR_RATING = 40;
const HAVOC_DARWINISM_REDUCTION = 5;
const HAVOC_DARWINISM_CHANNELS: ReadonlySet<string> = new Set([
  'two-point-accuracy',
  'three-point-accuracy',
  'free-throw-accuracy',
]);

export class HavocSimulationExhaustedError extends Error {
  readonly code = 'havoc-overtime-exhausted';
  constructor(periods: number, homeScore: number, awayScore: number, context: string) {
    super(
      `havoc: exceeded hard cap ${String(periods)} periods without a winner (${String(homeScore)}-${String(awayScore)}) for ${context}`,
    );
    this.name = 'HavocSimulationExhaustedError';
  }
}

function runtimeSeed(gameSeed: string, ...parts: readonly (string | number)[]): string {
  return seedSchema.parse(
    seasonDigestHex(
      [HAVOC_RUNTIME_SEED_ROOT, gameSeed, ...parts.map((part) => String(part))].join('\u0000'),
    ),
  );
}

export interface HavocFieldGoalValueInput {
  nominal: 2 | 3;
  three: boolean;
  roulette: number | null;
  fourPointDunk: boolean;
  reverseBasketball: boolean;
  heatCheck: boolean;
  putback: boolean;
  bounty: boolean;
  doubleOrNothing: boolean;
  buzzerBandit: boolean;
}

export interface HavocFieldGoalContribution {
  source: HavocScoringSource;
  points: number;
}

export interface HavocFieldGoalValue {
  addends: Array<{ source: HavocScoringSource; points: number }>;
  multipliers: Array<{ source: HavocScoringSource; factor: 2 | 3 }>;
  points: number;
  contributions: HavocFieldGoalContribution[];
}

/**
 * Exact `(nominal + Σ pre-addends) × Π multipliers + dunk bonus` resolution in
 * the stable evidence order. Roulette and reverse-basketball apply before
 * multipliers. At most one multiplier applies per make: the first active source
 * in stable order (heat-check, putback, bounty, double-or-nothing,
 * buzzer-bandit) wins; The Bounty triples while the others double. The
 * four-point-dunk bonus applies after multipliers so multipliers never multiply
 * it. `contributions` are the incremental score deltas at the point each
 * component applies; they sum to `points - nominal`.
 */
export function havocFieldGoalValue(input: HavocFieldGoalValueInput): HavocFieldGoalValue {
  const addends: HavocFieldGoalValue['addends'] = [];
  const multipliers: HavocFieldGoalValue['multipliers'] = [];
  const contributions: HavocFieldGoalContribution[] = [];
  let value = input.nominal;
  const add = (source: HavocScoringSource, points: number): void => {
    addends.push({ source, points });
    contributions.push({ source, points });
    value += points;
  };
  if (input.roulette !== null) add('roulette', input.roulette - input.nominal);
  if (input.reverseBasketball) add('reverse-basketball', input.three ? -2 : 1);
  const multiply = (source: HavocScoringSource, factor: 2 | 3): void => {
    multipliers.push({ source, factor });
    contributions.push({ source, points: value * (factor - 1) });
    value *= factor;
  };
  if (input.heatCheck) multiply('heat-check', 2);
  else if (input.putback) multiply('second-chance-jackpot', 2);
  else if (input.bounty) multiply('the-bounty', 3);
  else if (input.doubleOrNothing) multiply('double-or-nothing', 2);
  else if (input.buzzerBandit) multiply('buzzer-bandit', 2);
  if (input.fourPointDunk) add('four-point-dunk', 1);
  return { addends, multipliers, points: value, contributions };
}

interface RollupCounters {
  triggers: number;
  pointsDelta: number;
  freeThrowsGranted: number;
  turnoversCancelled: number;
  extraPossessionsEarned: number;
  extraPossessionsUsed: number;
  extraPossessionsExpired: number;
  ratingChanges: number;
}

interface ParticipantState {
  instanceId: string;
  kind: HavocParticipantKind;
  slot: Position;
  slotIndex: number;
  ownerInstanceId: string | null;
  source: HavocParticipant['source'];
  effective: HavocParticipant['effective'];
  mutations: Set<HavocMutationId>;
  sideIndex: SideIndex;
  rosterIndex: number;
  active: boolean;
  started: boolean;
  replaced: boolean;
  cloneExited: boolean;
  committedFouls: number;
  chargedFouls: number;
  swapWith: string | null;
  swappedBy: string | null;
  fgStreak: number;
  heatArmed: boolean;
  heatArmedAt: number | null;
  fgaCount: number;
  assistCount: number;
  shootingFoulsDrawn: number;
  refundUsed: [boolean, boolean];
  reboundLoopCount: number;
  putbackArmedAt: number | null;
  bountyArmed: boolean;
  bountyArmedAt: number | null;
  activeSeconds: number;
  darwinismReductions: number;
  fusionDonorInstanceId: string | null;
  fusionOwnerInstanceId: string | null;
  simPlayer: SimulationPlayer;
  evidence: HavocEvidence | undefined;
  rollup: Map<HavocMutationId, RollupCounters>;
}

interface TeamRuntime {
  sideIndex: SideIndex;
  side: HavocSide;
  input: HavocTeamInput;
  participants: ParticipantState[];
  active: ParticipantState[];
  byId: Map<string, ParticipantState>;
  extraQueue: Array<{ ownerInstanceId: string; side: HavocSide }>;
}

type HavocEventPayload = HavocEvent extends infer E
  ? E extends HavocEvent
    ? Omit<E, 'sequence' | 'gameNumber' | 'period' | 'clockSeconds'>
    : never
  : never;

type HavocScoringPayload = Omit<
  HavocScoringEntry,
  'sequence' | 'gameNumber' | 'period' | 'clockSeconds' | 'possessionId'
>;

interface Attribution {
  owner: ParticipantState;
  mutationId: HavocScoringSource;
  points: number;
}

const SCORING_SOURCE_MUTATION: Record<HavocScoringSource, HavocMutationId> = {
  roulette: 'basketball-roulette',
  'four-point-dunk': 'four-point-dunk',
  'reverse-basketball': 'reverse-basketball',
  'golden-assist': 'golden-assist',
  'double-or-nothing': 'double-or-nothing',
  'heat-check': 'heat-check',
  'second-chance-jackpot': 'second-chance-jackpot',
  'the-bounty': 'the-bounty',
  'buzzer-bandit': 'buzzer-bandit',
  'charity-casino': 'charity-casino',
};
export { SCORING_SOURCE_MUTATION as HAVOC_SCORING_SOURCE_MUTATION };

const ALL_AUTHORITATIVE: ReadonlySet<string> = new Set(havocAuthoritativeChannelSchema.options);

function zeroRollup(): RollupCounters {
  return {
    triggers: 0,
    pointsDelta: 0,
    freeThrowsGranted: 0,
    turnoversCancelled: 0,
    extraPossessionsEarned: 0,
    extraPossessionsUsed: 0,
    extraPossessionsExpired: 0,
    ratingChanges: 0,
  };
}

function capRatings(ratings: SimulationRatings, cap: number): SimulationRatings {
  return {
    insideScoring: Math.min(cap, ratings.insideScoring),
    closeShot: Math.min(cap, ratings.closeShot),
    midrange: Math.min(cap, ratings.midrange),
    threePoint: Math.min(cap, ratings.threePoint),
    freeThrow: Math.min(cap, ratings.freeThrow),
    ballHandling: Math.min(cap, ratings.ballHandling),
    passing: Math.min(cap, ratings.passing),
    offensiveIq: Math.min(cap, ratings.offensiveIq),
    offensiveRebound: Math.min(cap, ratings.offensiveRebound),
    defensiveRebound: Math.min(cap, ratings.defensiveRebound),
    perimeterDefense: Math.min(cap, ratings.perimeterDefense),
    interiorDefense: Math.min(cap, ratings.interiorDefense),
    steal: Math.min(cap, ratings.steal),
    block: Math.min(cap, ratings.block),
    defensiveIq: Math.min(cap, ratings.defensiveIq),
    speed: Math.min(cap, ratings.speed),
    strength: Math.min(cap, ratings.strength),
    vertical: Math.min(cap, ratings.vertical),
  };
}

function zoneDefenseSkill(defender: SimulationPlayer, zone: ShotZone): number {
  const ratings = defender.ratings;
  return zone === 'rim' || zone === 'shortMid'
    ? ratings.interiorDefense
    : zone === 'longMid'
      ? (ratings.interiorDefense + ratings.perimeterDefense) / 2
      : ratings.perimeterDefense;
}

function zoneDefenseWeight(defender: SimulationPlayer, zone: ShotZone): number {
  return Math.max(0.25, (zoneDefenseSkill(defender, zone) - 45) / 35);
}

export interface HavocCoverageAssignment {
  assignment: Array<{ shooterInstanceId: string; defenderInstanceId: string }>;
  uncoveredInstanceIds: string[];
  helpInstanceIds: string[];
}

/**
 * Deterministic per-trip primary defender assignment. Each defender covers at
 * most one offensive actor; when the offense has more actors than the defense,
 * the surplus attackers are uncovered.
 */
export function havocCoverageAssignment(
  offenseInstanceIds: readonly string[],
  defenseInstanceIds: readonly string[],
  matchWeight: (defenderInstanceId: string, shooterInstanceId: string) => number,
  rng: Rng,
): HavocCoverageAssignment {
  const assignment: HavocCoverageAssignment['assignment'] = [];
  const covered = new Set<string>();
  const used = new Set<string>();
  for (const defenderId of defenseInstanceIds) {
    const candidates = offenseInstanceIds.filter((instanceId) => !covered.has(instanceId));
    if (candidates.length === 0) break;
    const weights = candidates.map((candidate) =>
      Math.max(0.0001, matchWeight(defenderId, candidate)),
    );
    const chosen = rng.weightedPick(candidates, weights);
    assignment.push({ shooterInstanceId: chosen, defenderInstanceId: defenderId });
    covered.add(chosen);
    used.add(defenderId);
  }
  return {
    assignment,
    uncoveredInstanceIds: offenseInstanceIds.filter((instanceId) => !covered.has(instanceId)),
    helpInstanceIds: defenseInstanceIds.filter((instanceId) => !used.has(instanceId)),
  };
}

class HavocGameRuntime implements HavocRuntimeHooks {
  readonly events: HavocEvent[] = [];
  readonly scoring: HavocScoringEntry[] = [];
  readonly teams: [TeamRuntime, TeamRuntime];
  period = 1;
  possessionId = 0;
  private eventSeq = 0;
  private scoreSeq = 0;
  private shotKindOrdinal = 0;
  private coverageCache: {
    possessionId: number;
    assignment: Map<string, ParticipantState>;
    help: ParticipantState[];
    rng: Rng;
  } | null = null;
  private readonly playerInstance = new Map<SimulationPlayer, ParticipantState>();
  private readonly bodySnatcherTargets: ReadonlyMap<string, string>;
  private readonly bountyTarget: string | null;
  private lastTimeLord: [number, number];
  private lastCapped: string[] = [];
  private equalizerApplied = false;
  private rushedExtraSide: SideIndex | null = null;
  private darwinismDirty = false;
  private tripContext: TripContext | null = null;
  private readonly input: HavocGameInput;
  private readonly context: EngineContext;
  private readonly mainRng: Rng;
  private readonly recorder: GameRecorder;

  constructor(input: HavocGameInput, context: EngineContext, mainRng: Rng, recorder: GameRecorder) {
    this.input = input;
    this.context = context;
    this.mainRng = mainRng;
    this.recorder = recorder;
    const home = this.buildTeam(input.home, 0);
    const away = this.buildTeam(input.away, 1);
    this.teams = [home, away];
    const targets = havocCapabilityTargets(input);
    this.bodySnatcherTargets = targets.bodySnatcher;
    this.bountyTarget = targets.bounty;
    this.lastTimeLord = [ENGINE_CONSTANTS.shotClockSeconds, ENGINE_CONSTANTS.shotClockSeconds];
  }

  initialize(): void {
    this.rebuildBattleProfiles();
    this.rebuildActiveTeams();
  }

  attachTripContext(tripContext: TripContext): void {
    this.tripContext = tripContext;
    tripContext.havoc = this;
  }

  private buildTeam(input: HavocTeamInput, sideIndex: SideIndex): TeamRuntime {
    const participants: ParticipantState[] = [];
    const byId = new Map<string, ParticipantState>();
    const add = (participant: HavocParticipant): void => {
      const mutations = new Set(participant.mutationPackage.map((entry) => entry.mutationId));
      const state: ParticipantState = {
        instanceId: participant.instanceId,
        kind: participant.kind,
        slot: participant.slot,
        slotIndex: Math.max(0, POSITIONS.indexOf(participant.slot)),
        ownerInstanceId: participant.ownerInstanceId,
        source: participant.source,
        effective: participant.effective,
        mutations,
        sideIndex,
        rosterIndex: participants.length,
        active: false,
        started: false,
        replaced: false,
        cloneExited: false,
        committedFouls: 0,
        chargedFouls: 0,
        swapWith: null,
        swappedBy: null,
        fgStreak: 0,
        heatArmed: false,
        heatArmedAt: null,
        fgaCount: 0,
        assistCount: 0,
        shootingFoulsDrawn: 0,
        refundUsed: [false, false],
        reboundLoopCount: 0,
        putbackArmedAt: null,
        bountyArmed: false,
        bountyArmedAt: null,
        activeSeconds: 0,
        darwinismReductions: 0,
        fusionDonorInstanceId: null,
        fusionOwnerInstanceId: null,
        simPlayer: undefined as unknown as SimulationPlayer,
        evidence: undefined,
        rollup: new Map(),
      };
      for (const mutation of mutations) state.rollup.set(mutation, zeroRollup());
      participants.push(state);
      byId.set(state.instanceId, state);
    };
    for (const starter of input.starters) add(starter);
    for (const replacement of input.replacements) add(replacement);
    for (const clone of input.clones) add(clone);
    const team: TeamRuntime = {
      sideIndex,
      side: input.side,
      input,
      participants,
      active: [],
      byId,
      extraQueue: [],
    };
    for (const participant of participants) {
      if (participant.kind === 'starter') {
        participant.active = true;
        participant.started = true;
      }
    }
    return team;
  }

  // ---------------------------------------------------------------- identity

  keyOf(player: SimulationPlayer): string {
    return this.playerInstance.get(player)?.instanceId ?? `unknown:${player.playerId}`;
  }

  responsibilitySlotOf(player: SimulationPlayer): number {
    return this.playerInstance.get(player)?.slotIndex ?? 0;
  }

  evidenceOf(player: SimulationPlayer): HavocEvidence | undefined {
    const participant = this.playerInstance.get(player);
    if (participant === undefined) return undefined;
    if (participant.swapWith !== null || participant.swappedBy !== null) {
      return { isAuthoritative: (channel) => ALL_AUTHORITATIVE.has(channel) };
    }
    if (participant.fusionDonorInstanceId !== null) {
      return { isAuthoritative: (channel) => ALL_AUTHORITATIVE.has(channel) };
    }
    if (participant.fusionOwnerInstanceId !== null) {
      const owner = this.globalById(participant.fusionOwnerInstanceId);
      if (owner !== null && owner.active) {
        return { isAuthoritative: (channel) => ALL_AUTHORITATIVE.has(channel) };
      }
    }
    if (participant.darwinismReductions > 0) {
      return {
        isAuthoritative: (channel) =>
          participant.effective.authoritativeChannels.includes(channel) ||
          HAVOC_DARWINISM_CHANNELS.has(channel),
      };
    }
    return participant.evidence;
  }

  reboundWeightScale(player: SimulationPlayer): number {
    const participant = this.playerInstance.get(player);
    if (participant === undefined) return 1;
    return (
      1 + (HAVOC_WINGSPAN_REBOUND_WEIGHT * participant.effective.physical.wingspanDeltaInches) / 24
    );
  }

  reboundMeanReach(player: SimulationPlayer): number {
    const participant = this.playerInstance.get(player);
    if (participant === undefined) return 0;
    return 4 * participant.effective.physical.reachUnits;
  }

  aggregateDivisor(): number {
    return 5;
  }

  private participantOf(player: SimulationPlayer | null): ParticipantState | null {
    if (player === null) return null;
    return this.playerInstance.get(player) ?? null;
  }

  private requireParticipant(player: SimulationPlayer): ParticipantState {
    const participant = this.playerInstance.get(player);
    if (participant === undefined) {
      throw new Error(`havoc: unknown runtime participant ${player.playerId}`);
    }
    return participant;
  }

  private activeOwners(side: SideIndex, mutationId: HavocMutationId): ParticipantState[] {
    return this.teams[side].active.filter((participant) => participant.mutations.has(mutationId));
  }

  private rollupFor(
    participant: ParticipantState,
    mutationId: HavocMutationId,
  ): RollupCounters | undefined {
    let counters = participant.rollup.get(mutationId);
    if (counters === undefined && participant.mutations.has(mutationId)) {
      counters = zeroRollup();
      participant.rollup.set(mutationId, counters);
    }
    return counters;
  }

  private attribute(attributions: readonly Attribution[]): void {
    for (const attribution of attributions) {
      const counters = this.rollupFor(
        attribution.owner,
        SCORING_SOURCE_MUTATION[attribution.mutationId],
      );
      if (counters === undefined) continue;
      counters.pointsDelta += attribution.points;
    }
  }

  // ------------------------------------------------------------------ clock

  fullShotClock(side: SideIndex): number {
    return this.fullShotClockOf(side);
  }

  private fullShotClockOf(side: SideIndex): number {
    let limit: number;
    if (this.activeOwners(side, 'time-lord').length > 0) limit = 30;
    else if (this.activeOwners((1 - side) as SideIndex, 'time-lord').length > 0) limit = 12;
    else limit = ENGINE_CONSTANTS.shotClockSeconds;
    if (this.rushedExtraSide === side) {
      limit = Math.min(limit, HAVOC_EXTRA_POSSESSION_RUSH_SECONDS);
    }
    return limit;
  }

  reboundShotClock(side: SideIndex): number {
    return Math.min(14, this.fullShotClockOf(side));
  }

  onShotClockViolation(side: SideIndex, limitSeconds: number): void {
    this.pushEvent({
      kind: 'shot-clock-violation',
      possessionId: this.possessionId,
      offenseSide: this.teams[side].side,
      limitSeconds: Math.max(1, Math.round(limitSeconds)),
    });
  }

  // -------------------------------------------------------------- turnovers

  cancelTurnover(offense: SideIndex, handler: SimulationPlayer): boolean {
    const participant = this.participantOf(handler);
    if (participant === null || !participant.mutations.has('possession-refund')) return false;
    const half = this.period <= 2 ? 0 : 1;
    if (participant.refundUsed[half]) return false;
    participant.refundUsed[half] = true;
    const counters = this.rollupFor(participant, 'possession-refund');
    if (counters !== undefined) {
      counters.triggers += 1;
      counters.turnoversCancelled += 1;
    }
    return true;
  }

  onTurnover(offense: SideIndex, handler: SimulationPlayer, cancelled: boolean): void {
    const participant = this.requireParticipant(handler);
    const sequence = this.pushEvent({
      kind: 'turnover',
      possessionId: this.possessionId,
      playerInstanceId: participant.instanceId,
      side: this.teams[offense].side,
    });
    if (cancelled) {
      this.pushEvent({
        kind: 'turnover-cancelled',
        possessionId: this.possessionId,
        playerInstanceId: participant.instanceId,
        side: this.teams[offense].side,
        originalSequence: sequence,
      });
      this.pushEvent({
        kind: 'possession-refund',
        ownerInstanceId: participant.instanceId,
        side: this.teams[offense].side,
        turnoverSequence: sequence,
      });
    }
    participant.putbackArmedAt = null;
  }

  onSteal(defense: SideIndex, stealer: SimulationPlayer): void {
    const participant = this.requireParticipant(stealer);
    this.pushEvent({
      kind: 'steal',
      possessionId: this.possessionId,
      stealerInstanceId: participant.instanceId,
      side: this.teams[defense].side,
    });
  }

  // ----------------------------------------------------------------- shots

  planShot(args: {
    offense: SideIndex;
    defense: SideIndex;
    shooter: SimulationPlayer;
    zone: ShotZone;
    action: import('../../sim/usage.ts').ActionType;
    passed: boolean;
  }): HavocShotPlan {
    const shooter = this.requireParticipant(args.shooter);
    const tripContext = this.requireTripContext();
    const putback = shooter.putbackArmedAt !== null && !args.passed;
    const coverage = this.ensureCoverage(args.offense, args.defense);
    let defender: ParticipantState;
    let contestScale = 1;
    let helpPressure = 0;
    if (coverage === null) {
      const defensePrep = tripContext.preps[args.defense];
      const offensePrep = tripContext.preps[args.offense];
      const shooterSlot = offensePrep.slotByPlayerId.get(offensePrep.keyOf(args.shooter)) ?? 0;
      const chosen = pickDefender(
        tripContext.teams[args.defense],
        args.zone,
        this.mainRng,
        defensePrep.defenderBase,
        shooterSlot,
      );
      defender = this.requireParticipant(chosen);
    } else {
      const assigned = coverage.assignment.get(shooter.instanceId);
      if (assigned !== undefined) {
        defender = assigned;
      } else {
        defender = this.pickHelper(coverage, args.defense, args.zone);
        contestScale = HAVOC_UNCOVERED_CONTEST_SCALE;
      }
      helpPressure = this.helpPressure(coverage.help, args.zone);
    }
    const interior = args.zone === 'rim' || args.zone === 'shortMid';
    const defenderReach = defender.effective.physical.reachUnits;
    const contestPointDelta = interior ? -HAVOC_CONTEST_REACH_POINTS * defenderReach : 0;
    const blockPointDelta = interior ? HAVOC_BLOCK_REACH_POINTS * defenderReach : 0;
    const physical = shooter.effective.physical;
    const heightFeet = clamp((physical.heightInches - physical.baselineHeightInches) / 12, -2, 2);
    const finishDelta = args.zone === 'rim' ? HAVOC_FINISH_HEIGHT_POINTS * heightFeet : 0;
    const planCoverage: HavocCoveragePlan = {
      contestScale,
      contestPointDelta,
      makePointDelta: finishDelta - helpPressure,
      blockPointDelta,
    };
    return {
      defender: defender.simPlayer,
      coverage: planCoverage,
      shotKind: this.classifyShot(shooter, args.zone, putback),
      putback,
    };
  }

  private requireTripContext(): TripContext {
    if (this.tripContext === null) {
      throw new Error('havoc: trip context not attached');
    }
    return this.tripContext;
  }

  private ensureCoverage(
    offense: SideIndex,
    defense: SideIndex,
  ): { assignment: Map<string, ParticipantState>; help: ParticipantState[]; rng: Rng } | null {
    const offenseTeam = this.teams[offense];
    const defenseTeam = this.teams[defense];
    if (offenseTeam.active.length === 5 && defenseTeam.active.length === 5) return null;
    if (this.coverageCache !== null && this.coverageCache.possessionId === this.possessionId) {
      return this.coverageCache;
    }
    const rng = this.context.rngFactory(
      runtimeSeed(this.input.seed, 'coverage', this.possessionId, offense),
    );
    const byId = new Map(
      this.teams.flatMap((team) => team.participants).map((p) => [p.instanceId, p]),
    );
    const result = havocCoverageAssignment(
      offenseTeam.active.map((participant) => participant.instanceId),
      defenseTeam.active.map((participant) => participant.instanceId),
      (defenderId, shooterId) => {
        const defender = byId.get(defenderId);
        const shooter = byId.get(shooterId);
        if (defender === undefined || shooter === undefined) return 1;
        return sameGroupMatchWeight(defender.slotIndex, shooter.slotIndex);
      },
      rng,
    );
    const assignment = new Map<string, ParticipantState>();
    for (const pair of result.assignment) {
      const shooter = byId.get(pair.shooterInstanceId);
      const defender = byId.get(pair.defenderInstanceId);
      if (shooter !== undefined && defender !== undefined) {
        assignment.set(shooter.instanceId, defender);
      }
    }
    const help = result.helpInstanceIds
      .map((instanceId) => byId.get(instanceId))
      .filter((participant): participant is ParticipantState => participant !== undefined);
    this.coverageCache = { possessionId: this.possessionId, assignment, help, rng };
    return this.coverageCache;
  }

  private pickHelper(
    coverage: { assignment: Map<string, ParticipantState>; help: ParticipantState[]; rng: Rng },
    defenseSide: SideIndex,
    zone: ShotZone,
  ): ParticipantState {
    const team = this.teams[defenseSide];
    const assignedIds = new Set(
      [...coverage.assignment.values()].map((participant) => participant.instanceId),
    );
    const candidates = team.active.filter((defender) => !assignedIds.has(defender.instanceId));
    const pool = candidates.length > 0 ? candidates : team.active;
    if (pool.length === 0) {
      throw new Error('havoc: no help defender available');
    }
    const weights = pool.map((defender) => zoneDefenseWeight(defender.simPlayer, zone));
    return coverage.rng.weightedPick(pool, weights);
  }

  private helpPressure(help: readonly ParticipantState[], zone: ShotZone): number {
    let total = 0;
    for (const defender of help) {
      const skill = zoneDefenseSkill(defender.simPlayer, zone);
      total += 0.01 * Math.floor(Math.max(0, skill) / 100);
    }
    return Math.min(HAVOC_HELP_PRESSURE_CAP, total);
  }

  private classifyShot(shooter: ParticipantState, zone: ShotZone, putback: boolean): HavocShotKind {
    if (zone !== 'rim') return 'jumper';
    if (putback) return 'layup';
    this.shotKindOrdinal += 1;
    const rng = this.context.rngFactory(
      runtimeSeed(
        this.input.seed,
        'shot-kind',
        this.possessionId,
        this.shotKindOrdinal,
        shooter.instanceId,
      ),
    );
    const physical = shooter.effective.physical;
    const probability = clamp(
      HAVOC_DUNK_BASE +
        HAVOC_DUNK_VERTICAL_WEIGHT * (shooter.simPlayer.ratings.vertical / 100) +
        HAVOC_DUNK_INSIDE_WEIGHT * (shooter.simPlayer.ratings.insideScoring / 100) +
        HAVOC_DUNK_HEIGHT_WEIGHT * (physical.heightInches - 78),
      0.05,
      0.95,
    );
    return rng.next() < probability ? 'dunk' : 'layup';
  }

  onFieldGoal(args: {
    offense: SideIndex;
    shooter: SimulationPlayer;
    made: boolean;
    three: boolean;
    passed: boolean;
    shotKind: HavocShotKind;
    putback: boolean;
    zone: ShotZone;
  }): void {
    const shooter = this.requireParticipant(args.shooter);
    const team = this.teams[args.offense];
    const nominal: 2 | 3 = args.three ? 3 : 2;
    const shotSequence = this.pushEvent({
      kind: 'shot-attempt',
      possessionId: this.possessionId,
      shooterInstanceId: shooter.instanceId,
      side: team.side,
      zone: args.zone,
      shotKind: args.shotKind,
      made: args.made,
      nominalPoints: nominal,
    });
    const putbackValid = args.putback && !args.passed;
    const putbackArm = shooter.putbackArmedAt;
    if (putbackArm !== null) {
      shooter.putbackArmedAt = null;
      const counters = this.rollupFor(shooter, 'second-chance-jackpot');
      if (counters !== undefined) counters.triggers += 1;
    }
    const heatBefore = shooter.mutations.has('heat-check') && shooter.heatArmed;
    const bountyBefore = shooter.mutations.has('the-bounty') && shooter.bountyArmed;
    const fourPointDunk =
      args.made && args.shotKind === 'dunk' && shooter.mutations.has('four-point-dunk');
    const reverseOwners = this.activeOwners(args.offense, 'reverse-basketball');
    const doubleOwners = this.activeOwners(args.offense, 'double-or-nothing');
    const shotClockRemaining = this.tripContext?.shotClock?.remaining;
    const shotClockTenths =
      shotClockRemaining === undefined ? null : Math.round(shotClockRemaining * 10);
    const buzzerQualifies =
      shooter.active &&
      shooter.mutations.has('buzzer-bandit') &&
      shotClockTenths !== null &&
      shotClockTenths <= HAVOC_BUZZER_WINDOW_TENTHS;
    let roulette: { owner: ParticipantState; rolled: number; ordinal: number } | null = null;
    if (shooter.mutations.has('basketball-roulette')) {
      shooter.fgaCount += 1;
      if (shooter.fgaCount % HAVOC_ROULETTE_EVERY_ATTEMPTS === 0) {
        const rng = this.context.rngFactory(
          runtimeSeed(this.input.seed, 'roulette', shooter.instanceId, shooter.fgaCount),
        );
        roulette = {
          owner: shooter,
          rolled: rng.nextInt(HAVOC_ROULETTE_MIN, HAVOC_ROULETTE_MAX),
          ordinal: shooter.fgaCount,
        };
      }
    }
    let scoringSequence: number | null = null;
    if (args.made) {
      const value = havocFieldGoalValue({
        nominal,
        three: args.three,
        roulette: roulette === null ? null : roulette.rolled,
        fourPointDunk,
        reverseBasketball: reverseOwners.length > 0,
        heatCheck: heatBefore,
        putback: putbackValid,
        bounty: bountyBefore,
        doubleOrNothing: doubleOwners.length > 0,
        buzzerBandit: buzzerQualifies,
      });
      const attributions: Attribution[] = [];
      const ownerIds: string[] = [];
      const pushOwner = (participant: ParticipantState): void => {
        if (!ownerIds.includes(participant.instanceId)) ownerIds.push(participant.instanceId);
      };
      for (const contribution of value.contributions) {
        if (contribution.source === 'roulette' || contribution.source === 'four-point-dunk') {
          pushOwner(shooter);
          attributions.push({
            owner: shooter,
            mutationId: contribution.source,
            points: contribution.points,
          });
          continue;
        }
        const owners =
          contribution.source === 'reverse-basketball'
            ? reverseOwners
            : contribution.source === 'second-chance-jackpot' ||
                contribution.source === 'the-bounty'
              ? [shooter]
              : contribution.source === 'heat-check' || contribution.source === 'buzzer-bandit'
                ? [shooter]
                : doubleOwners;
        const primary = owners[0];
        if (primary === undefined) continue;
        if (
          contribution.source === 'reverse-basketball' ||
          contribution.source === 'double-or-nothing'
        ) {
          for (const owner of owners) pushOwner(owner);
        } else {
          pushOwner(primary);
        }
        attributions.push({
          owner: primary,
          mutationId: contribution.source,
          points: contribution.points,
        });
      }
      scoringSequence = this.pushScoring({
        side: team.side,
        kind: 'field-goal',
        actorInstanceId: shooter.instanceId,
        beneficiaryInstanceId: null,
        nominalPoints: nominal,
        addends: value.addends,
        multipliers: value.multipliers,
        points: value.points,
        owners: ownerIds,
        originalEventSequence: shotSequence,
      });
      this.attribute(attributions);
      if (buzzerQualifies) {
        const counters = this.rollupFor(shooter, 'buzzer-bandit');
        if (counters !== undefined) counters.triggers += 1;
        this.pushEvent({
          kind: 'buzzer-bandit',
          outcome: 'doubled',
          ownerInstanceId: shooter.instanceId,
          shooterInstanceId: shooter.instanceId,
          side: team.side,
          shotClockTenths: shotClockTenths,
          scoringSequence,
        });
      }
    } else {
      const penaltyOwner = doubleOwners[0];
      if (penaltyOwner !== undefined) {
        scoringSequence = this.pushScoring({
          side: team.side,
          kind: 'adjustment',
          actorInstanceId: shooter.instanceId,
          beneficiaryInstanceId: null,
          nominalPoints: 0,
          addends: [{ source: 'double-or-nothing', points: HAVOC_DOUBLE_MISS_PENALTY }],
          multipliers: [],
          points: HAVOC_DOUBLE_MISS_PENALTY,
          owners: doubleOwners.map((owner) => owner.instanceId),
          originalEventSequence: shotSequence,
        });
        this.attribute([
          {
            owner: penaltyOwner,
            mutationId: 'double-or-nothing',
            points: HAVOC_DOUBLE_MISS_PENALTY,
          },
        ]);
      }
      if (buzzerQualifies) {
        const penaltySequence = this.pushScoring({
          side: team.side,
          kind: 'adjustment',
          actorInstanceId: shooter.instanceId,
          beneficiaryInstanceId: null,
          nominalPoints: 0,
          addends: [{ source: 'buzzer-bandit', points: HAVOC_BUZZER_MISS_PENALTY }],
          multipliers: [],
          points: HAVOC_BUZZER_MISS_PENALTY,
          owners: [shooter.instanceId],
          originalEventSequence: shotSequence,
        });
        const counters = this.rollupFor(shooter, 'buzzer-bandit');
        if (counters !== undefined) {
          counters.triggers += 1;
          counters.pointsDelta += HAVOC_BUZZER_MISS_PENALTY;
        }
        this.pushEvent({
          kind: 'buzzer-bandit',
          outcome: 'penalized',
          ownerInstanceId: shooter.instanceId,
          shooterInstanceId: shooter.instanceId,
          side: team.side,
          shotClockTenths: shotClockTenths,
          scoringSequence: penaltySequence,
        });
      }
    }
    if (args.made) {
      const darwinismOwners = [
        ...this.activeOwners(0, 'basketball-darwinism'),
        ...this.activeOwners(1, 'basketball-darwinism'),
      ];
      const primary = darwinismOwners[0];
      if (primary !== undefined) {
        shooter.darwinismReductions += 1;
        for (const owner of darwinismOwners) {
          const counters = this.rollupFor(owner, 'basketball-darwinism');
          if (counters !== undefined) {
            counters.triggers += 1;
            counters.ratingChanges += HAVOC_DARWINISM_REDUCTION;
          }
        }
        this.pushEvent({
          kind: 'darwinism',
          ownerInstanceId: primary.instanceId,
          side: this.teams[primary.sideIndex].side,
          shooterInstanceId: shooter.instanceId,
          shooterReductionsAfter: shooter.darwinismReductions,
        });
        this.darwinismDirty = true;
      }
    }
    const mutate = (participant: ParticipantState, mutationId: HavocMutationId): void => {
      const counters = this.rollupFor(participant, mutationId);
      if (counters !== undefined) counters.triggers += 1;
    };
    if (fourPointDunk) {
      mutate(shooter, 'four-point-dunk');
      this.pushEvent({
        kind: 'four-point-dunk',
        shooterInstanceId: shooter.instanceId,
        side: team.side,
        scoringSequence: scoringSequence ?? 0,
      });
    }
    if (putbackArm !== null) {
      if (putbackValid && args.made) {
        this.pushEvent({
          kind: 'putback',
          outcome: 'consumed',
          ownerInstanceId: shooter.instanceId,
          side: team.side,
          reboundSequence: putbackArm,
          scoringSequence,
        });
      } else {
        this.pushEvent({
          kind: 'putback',
          outcome: 'lost',
          ownerInstanceId: shooter.instanceId,
          side: team.side,
          reboundSequence: putbackArm,
          scoringSequence: null,
        });
      }
    }
    for (const mate of team.active) {
      if (mate.instanceId === shooter.instanceId) continue;
      const arm = mate.putbackArmedAt;
      if (arm === null) continue;
      mate.putbackArmedAt = null;
      this.pushEvent({
        kind: 'putback',
        outcome: 'lost',
        ownerInstanceId: mate.instanceId,
        side: team.side,
        reboundSequence: arm,
        scoringSequence: null,
      });
    }
    if (shooter.mutations.has('heat-check')) {
      if (args.made) {
        if (heatBefore) {
          shooter.heatArmed = false;
          shooter.heatArmedAt = null;
          shooter.fgStreak = 0;
          mutate(shooter, 'heat-check');
          this.pushEvent({
            kind: 'heat-check',
            outcome: 'consumed',
            ownerInstanceId: shooter.instanceId,
            side: team.side,
            scoringSequence,
          });
        } else {
          shooter.fgStreak += 1;
          if (shooter.fgStreak >= HAVOC_HEAT_STREAK_ARMS_AT) {
            shooter.heatArmed = true;
            shooter.heatArmedAt = this.possessionId;
            mutate(shooter, 'heat-check');
            this.pushEvent({
              kind: 'heat-check',
              outcome: 'armed',
              ownerInstanceId: shooter.instanceId,
              side: team.side,
              scoringSequence: null,
            });
          }
        }
      } else {
        shooter.fgStreak = 0;
        if (shooter.heatArmed) {
          shooter.heatArmed = false;
          shooter.heatArmedAt = null;
          this.pushEvent({
            kind: 'heat-check',
            outcome: 'expired',
            ownerInstanceId: shooter.instanceId,
            side: team.side,
            scoringSequence: null,
          });
        }
      }
    }
    if (args.made && bountyBefore) {
      shooter.bountyArmed = false;
      shooter.bountyArmedAt = null;
      mutate(shooter, 'the-bounty');
      this.pushEvent({
        kind: 'bounty',
        outcome: 'consumed',
        ownerInstanceId: shooter.instanceId,
        side: team.side,
        blockedInstanceId: null,
        scoringSequence,
      });
    }
    if (roulette !== null) {
      mutate(roulette.owner, 'basketball-roulette');
      this.pushEvent({
        kind: 'roulette',
        ownerInstanceId: roulette.owner.instanceId,
        side: team.side,
        attemptOrdinal: roulette.ordinal,
        rolled: roulette.rolled,
        nominal,
        scoringSequence: args.made ? scoringSequence : null,
      });
    }
  }

  onFreeThrow(args: {
    side: SideIndex;
    shooter: SimulationPlayer;
    made: boolean;
    bonus: boolean;
  }): void {
    const shooter = this.requireParticipant(args.shooter);
    const team = this.teams[args.side];
    const attemptSequence = this.pushEvent({
      kind: 'free-throw-attempt',
      possessionId: this.possessionId,
      shooterInstanceId: shooter.instanceId,
      side: team.side,
      made: args.made,
      bonus: args.bonus,
    });
    const doubleOwners = this.activeOwners(args.side, 'double-or-nothing');
    const charityOwner = shooter.active && shooter.mutations.has('charity-casino') ? shooter : null;
    if (args.made) {
      const scoringSequence = this.pushScoring({
        side: team.side,
        kind: 'free-throw',
        actorInstanceId: shooter.instanceId,
        beneficiaryInstanceId: null,
        nominalPoints: 1,
        addends: charityOwner !== null ? [{ source: 'charity-casino', points: 2 }] : [],
        multipliers: [],
        points: charityOwner !== null ? 3 : 1,
        owners: charityOwner !== null ? [shooter.instanceId] : [],
        originalEventSequence: attemptSequence,
      });
      if (charityOwner !== null) {
        const counters = this.rollupFor(charityOwner, 'charity-casino');
        if (counters !== undefined) counters.triggers += 1;
        this.attribute([{ owner: charityOwner, mutationId: 'charity-casino', points: 2 }]);
        this.pushEvent({
          kind: 'charity-casino',
          outcome: 'made',
          ownerInstanceId: charityOwner.instanceId,
          side: team.side,
          scoringSequence,
          bonusSequence: null,
        });
      }
    } else {
      if (doubleOwners.length > 0) {
        const primary = doubleOwners[0];
        if (primary !== undefined) {
          this.pushScoring({
            side: team.side,
            kind: 'adjustment',
            actorInstanceId: shooter.instanceId,
            beneficiaryInstanceId: null,
            nominalPoints: 0,
            addends: [{ source: 'double-or-nothing', points: HAVOC_DOUBLE_MISS_PENALTY }],
            multipliers: [],
            points: HAVOC_DOUBLE_MISS_PENALTY,
            owners: doubleOwners.map((owner) => owner.instanceId),
            originalEventSequence: attemptSequence,
          });
          this.attribute([
            { owner: primary, mutationId: 'double-or-nothing', points: HAVOC_DOUBLE_MISS_PENALTY },
          ]);
        }
      }
      if (charityOwner !== null) {
        const bonusSequence = this.pushScoring({
          side: this.teams[(1 - args.side) as SideIndex].side,
          kind: 'bonus',
          actorInstanceId: charityOwner.instanceId,
          beneficiaryInstanceId: null,
          nominalPoints: 0,
          addends: [{ source: 'charity-casino', points: 2 }],
          multipliers: [],
          points: 2,
          owners: [charityOwner.instanceId],
          originalEventSequence: attemptSequence,
        });
        const counters = this.rollupFor(charityOwner, 'charity-casino');
        if (counters !== undefined) {
          counters.triggers += 1;
          counters.pointsDelta -= 2;
        }
        this.pushEvent({
          kind: 'charity-casino',
          outcome: 'missed',
          ownerInstanceId: charityOwner.instanceId,
          side: team.side,
          scoringSequence: null,
          bonusSequence,
        });
      }
    }
  }

  onAssist(offense: SideIndex, assister: SimulationPlayer, scorer: SimulationPlayer): void {
    const passer = this.requireParticipant(assister);
    const receiver = this.requireParticipant(scorer);
    const team = this.teams[offense];
    const assistSequence = this.pushEvent({
      kind: 'assist',
      possessionId: this.possessionId,
      assisterInstanceId: passer.instanceId,
      scorerInstanceId: receiver.instanceId,
      side: team.side,
    });
    if (!passer.mutations.has('golden-assist')) return;
    passer.assistCount += 1;
    if (passer.assistCount % HAVOC_GOLDEN_ASSIST_EVERY !== 0) return;
    const counters = this.rollupFor(passer, 'golden-assist');
    if (counters !== undefined) counters.triggers += 1;
    const scoringSequence = this.pushScoring({
      side: team.side,
      kind: 'adjustment',
      actorInstanceId: passer.instanceId,
      beneficiaryInstanceId: receiver.instanceId,
      nominalPoints: 0,
      addends: [{ source: 'golden-assist', points: 1 }],
      multipliers: [],
      points: 1,
      owners: [passer.instanceId],
      originalEventSequence: assistSequence,
    });
    this.attribute([{ owner: passer, mutationId: 'golden-assist', points: 1 }]);
    this.pushEvent({
      kind: 'golden-assist',
      assisterInstanceId: passer.instanceId,
      side: team.side,
      scoringSequence,
    });
  }

  onRebound(side: SideIndex, rebounder: SimulationPlayer, offensive: boolean): void {
    const participant = this.requireParticipant(rebounder);
    const team = this.teams[side];
    const reboundSequence = this.pushEvent({
      kind: 'rebound',
      possessionId: this.possessionId,
      playerInstanceId: participant.instanceId,
      side: team.side,
      offensive,
    });
    if (!offensive) return;
    if (participant.mutations.has('rebound-loop')) {
      participant.reboundLoopCount += 1;
      if (participant.reboundLoopCount % HAVOC_REBOUND_LOOP_EVERY === 0) {
        const counters = this.rollupFor(participant, 'rebound-loop');
        if (counters !== undefined) {
          counters.triggers += 1;
          counters.extraPossessionsEarned += 1;
        }
        this.pushEvent({
          kind: 'rebound-loop',
          ownerInstanceId: participant.instanceId,
          side: team.side,
          reboundOrdinal: participant.reboundLoopCount,
          granted: 1,
        });
        team.extraQueue.push({ ownerInstanceId: participant.instanceId, side: team.side });
        this.pushEvent({
          kind: 'extra-possession',
          outcome: 'queued',
          ownerInstanceId: participant.instanceId,
          side: team.side,
          possessionId: null,
        });
      }
    }
    if (participant.mutations.has('second-chance-jackpot')) {
      participant.putbackArmedAt = reboundSequence;
      this.pushEvent({
        kind: 'putback',
        outcome: 'armed',
        ownerInstanceId: participant.instanceId,
        side: team.side,
        reboundSequence,
        scoringSequence: null,
      });
    }
  }

  onBlock(defense: SideIndex, blocker: SimulationPlayer, shooter: SimulationPlayer): void {
    const blockerState = this.requireParticipant(blocker);
    const shooterState = this.requireParticipant(shooter);
    this.pushEvent({
      kind: 'block',
      possessionId: this.possessionId,
      blockerInstanceId: blockerState.instanceId,
      shooterInstanceId: shooterState.instanceId,
      side: this.teams[defense].side,
    });
    if (
      blockerState.mutations.has('the-bounty') &&
      this.bountyTarget !== null &&
      shooterState.instanceId === this.bountyTarget &&
      !blockerState.bountyArmed
    ) {
      blockerState.bountyArmed = true;
      blockerState.bountyArmedAt = this.possessionId;
      const counters = this.rollupFor(blockerState, 'the-bounty');
      if (counters !== undefined) counters.triggers += 1;
      this.pushEvent({
        kind: 'bounty',
        outcome: 'armed',
        ownerInstanceId: blockerState.instanceId,
        side: this.teams[defense].side,
        blockedInstanceId: shooterState.instanceId,
        scoringSequence: null,
      });
    }
  }

  onFoul(args: {
    fouler: SimulationPlayer;
    foulerSide: SideIndex;
    offenseSide: SideIndex;
    shooter: SimulationPlayer | null;
    shooting: boolean;
    madeShot: boolean;
    inBonus: boolean;
    zone: ShotZone | null;
  }): HavocFoulResult {
    const fouler = this.requireParticipant(args.fouler);
    const foulerTeam = this.teams[args.foulerSide];
    fouler.committedFouls += 1;
    fouler.chargedFouls += 1;
    const doubleOwners = this.activeOwners(args.foulerSide, 'double-or-nothing');
    const doubleOrNothingFreeThrows =
      doubleOwners.length > 0 ? HAVOC_DOUBLE_OR_NOTHING_FOUL_FREE_THROWS : 0;
    let freeThrowsAwarded = 0;
    let bonusAttempts = 0;
    let andOneShooter: ParticipantState | null = null;
    if (args.shooting) {
      if (args.madeShot) {
        freeThrowsAwarded = 1;
      } else {
        freeThrowsAwarded = args.zone === null ? 2 : freeThrowsForZone(args.zone);
      }
    } else if (args.inBonus) {
      freeThrowsAwarded = 2;
    }
    if (args.shooting && args.shooter !== null && args.madeShot) {
      const shooter = this.requireParticipant(args.shooter);
      if (shooter.mutations.has('and-one-machine')) {
        andOneShooter = shooter;
        freeThrowsAwarded += 1;
        bonusAttempts = 1;
      }
    }
    const technicalFreeThrows =
      fouler.kind === 'replacement' && fouler.committedFouls >= HAVOC_PERSONAL_FOUL_LIMIT ? 1 : 0;
    const foulSequence = this.pushEvent({
      kind: 'foul',
      possessionId: this.possessionId,
      foulerInstanceId: fouler.instanceId,
      side: foulerTeam.side,
      shooting: args.shooting,
      shooterInstanceId:
        args.shooter === null ? null : this.requireParticipant(args.shooter).instanceId,
      freeThrowsAwarded,
      technicalFreeThrows,
    });
    if (andOneShooter !== null) {
      const counters = this.rollupFor(andOneShooter, 'and-one-machine');
      if (counters !== undefined) {
        counters.triggers += 1;
        counters.freeThrowsGranted += 1;
      }
      this.pushEvent({
        kind: 'and-one-bonus',
        shooterInstanceId: andOneShooter.instanceId,
        side: this.teams[args.offenseSide].side,
        foulSequence,
        bonusFreeThrows: 1,
      });
    }
    if (doubleOrNothingFreeThrows > 0) {
      const owner = doubleOwners[0];
      if (owner !== undefined) {
        const counters = this.rollupFor(owner, 'double-or-nothing');
        if (counters !== undefined) {
          counters.triggers += 1;
          counters.freeThrowsGranted += doubleOrNothingFreeThrows;
        }
        this.pushEvent({
          kind: 'double-or-nothing-foul',
          ownerInstanceId: owner.instanceId,
          side: foulerTeam.side,
          foulSequence,
          freeThrowsGranted: doubleOrNothingFreeThrows,
        });
      }
    }
    if (args.shooting && args.shooter !== null) {
      const shooter = this.requireParticipant(args.shooter);
      if (shooter.mutations.has('foul-thief')) {
        shooter.shootingFoulsDrawn += 1;
        if (shooter.shootingFoulsDrawn % 2 === 0 && shooter.chargedFouls > 0) {
          shooter.chargedFouls -= 1;
          const counters = this.rollupFor(shooter, 'foul-thief');
          if (counters !== undefined) counters.triggers += 1;
          this.pushEvent({
            kind: 'foul-relief',
            ownerInstanceId: shooter.instanceId,
            side: this.teams[args.offenseSide].side,
            foulSequence,
            chargedFoulsAfter: shooter.chargedFouls,
          });
        }
      }
    }
    return {
      freeThrowsAwarded,
      bonusAttempts,
      technicalFreeThrows,
      technicalForDefense: args.foulerSide === args.offenseSide && !args.shooting,
      doubleOrNothingFreeThrows,
    };
  }

  // -------------------------------------------------------------- lifecycle

  beginPossession(offense: SideIndex, possessionId: number): void {
    this.possessionId = possessionId;
    this.shotKindOrdinal = 0;
    this.coverageCache = null;
    for (const team of this.teams) {
      for (const participant of team.participants) {
        if (participant.heatArmed && participant.heatArmedAt !== null) {
          if (possessionId - participant.heatArmedAt >= HAVOC_HEAT_EXPIRY_POSSESSIONS) {
            participant.heatArmed = false;
            participant.heatArmedAt = null;
            participant.fgStreak = 0;
            this.pushEvent({
              kind: 'heat-check',
              outcome: 'expired',
              ownerInstanceId: participant.instanceId,
              side: team.side,
              scoringSequence: null,
            });
          }
        }
        if (participant.bountyArmed && participant.bountyArmedAt !== null) {
          if (possessionId - participant.bountyArmedAt >= HAVOC_BOUNTY_EXPIRY_POSSESSIONS) {
            participant.bountyArmed = false;
            participant.bountyArmedAt = null;
            this.pushEvent({
              kind: 'bounty',
              outcome: 'expired',
              ownerInstanceId: participant.instanceId,
              side: team.side,
              blockedInstanceId: null,
              scoringSequence: null,
            });
          }
        }
      }
    }
  }

  onPossessionEnd(offense: SideIndex): void {
    const team = this.teams[offense];
    for (const participant of team.active) {
      const arm = participant.putbackArmedAt;
      if (arm === null) continue;
      participant.putbackArmedAt = null;
      this.pushEvent({
        kind: 'putback',
        outcome: 'lost',
        ownerInstanceId: participant.instanceId,
        side: team.side,
        reboundSequence: arm,
        scoringSequence: null,
      });
    }
    this.coverageCache = null;
    this.rushedExtraSide = null;
  }

  beginTipoff(): void {
    for (const team of this.teams) {
      for (const participant of team.participants) {
        if (participant.kind !== 'clone' || participant.ownerInstanceId === null) continue;
        const owner = team.byId.get(participant.ownerInstanceId);
        if (owner?.active !== true || !owner.mutations.has('clone-army')) continue;
        participant.active = true;
        participant.started = true;
        const counters = owner.rollup.get('clone-army');
        if (counters !== undefined) counters.triggers += 1;
        this.pushEvent({
          kind: 'clone',
          outcome: 'entered',
          ownerInstanceId: participant.ownerInstanceId,
          cloneInstanceId: participant.instanceId,
          side: team.side,
          reason: null,
        });
      }
    }
    for (const team of this.teams) {
      const owner = team.participants.find(
        (participant) =>
          participant.kind === 'starter' && participant.mutations.has('fusion-dance'),
      );
      if (owner === undefined) continue;
      const donor = team.participants
        .filter(
          (participant) =>
            participant.kind === 'starter' && participant.instanceId !== owner.instanceId,
        )
        .sort(
          (left, right) =>
            right.source.originalOverall - left.source.originalOverall ||
            left.slotIndex - right.slotIndex,
        )[0];
      if (donor === undefined) continue;
      owner.fusionDonorInstanceId = donor.instanceId;
      donor.fusionOwnerInstanceId = owner.instanceId;
      const counters = this.rollupFor(owner, 'fusion-dance');
      if (counters !== undefined) counters.triggers += 1;
      this.pushEvent({
        kind: 'fusion-dance',
        outcome: 'applied',
        ownerInstanceId: owner.instanceId,
        donorInstanceId: donor.instanceId,
        side: team.side,
      });
    }
    for (const [ownerId, targetId] of this.bodySnatcherTargets) {
      const owner = this.teams[0].byId.get(ownerId) ?? this.teams[1].byId.get(ownerId);
      const target = this.teams[0].byId.get(targetId) ?? this.teams[1].byId.get(targetId);
      if (owner === undefined || target === undefined) continue;
      owner.swapWith = targetId;
      target.swappedBy = ownerId;
      const counters = this.rollupFor(owner, 'body-snatcher');
      if (counters !== undefined) counters.triggers += 1;
      this.pushEvent({
        kind: 'body-snatcher',
        outcome: 'applied',
        ownerInstanceId: ownerId,
        targetInstanceId: targetId,
        side: this.teams[owner.sideIndex].side,
      });
    }
    this.rebuildBattleProfiles();
    this.rebuildActiveTeams();
    this.recomputeEqualizer(true);
    this.recomputeTimeLord('tipoff');
  }

  processBoundary(): void {
    let changed = false;
    for (const team of this.teams) {
      for (const participant of team.participants) {
        if (!participant.active) continue;
        if (participant.chargedFouls < HAVOC_PERSONAL_FOUL_LIMIT) continue;
        if (participant.kind === 'starter' && !participant.replaced) {
          const replacement = team.participants.find(
            (candidate) =>
              candidate.kind === 'replacement' &&
              candidate.ownerInstanceId === participant.instanceId,
          );
          participant.active = false;
          participant.replaced = true;
          if (replacement !== undefined) {
            replacement.active = true;
            replacement.started = true;
          }
          this.pushEvent({
            kind: 'substitution',
            outInstanceId: participant.instanceId,
            inInstanceId: replacement?.instanceId ?? participant.instanceId,
            reason: 'foul-out',
          });
          this.endPowersFor(participant);
          this.removeClone(team, participant.instanceId, 'owner-exited');
          changed = true;
        } else if (participant.kind === 'clone') {
          this.removeClone(team, participant.ownerInstanceId ?? '', 'fouled-out');
          changed = true;
        }
      }
    }
    const equalizerChanged = this.recomputeEqualizer(false);
    const timeLordChanged = this.recomputeTimeLord('owner-exit');
    const darwinismChanged = this.darwinismDirty;
    this.darwinismDirty = false;
    if (changed || equalizerChanged || timeLordChanged || darwinismChanged) {
      this.rebuildBattleProfiles();
      this.rebuildActiveTeams();
    }
  }

  private endPowersFor(participant: ParticipantState): void {
    participant.heatArmed = false;
    participant.heatArmedAt = null;
    participant.fgStreak = 0;
    participant.bountyArmed = false;
    participant.bountyArmedAt = null;
    participant.putbackArmedAt = null;
    if (participant.fusionDonorInstanceId !== null) {
      const donorId = participant.fusionDonorInstanceId;
      const donor = this.globalById(donorId);
      participant.fusionDonorInstanceId = null;
      if (donor !== null) donor.fusionOwnerInstanceId = null;
      this.pushEvent({
        kind: 'fusion-dance',
        outcome: 'ended',
        ownerInstanceId: participant.instanceId,
        donorInstanceId: donorId,
        side: this.teams[participant.sideIndex].side,
      });
    }
    if (participant.swapWith !== null) {
      const target = this.globalById(participant.swapWith);
      const targetId = participant.swapWith;
      participant.swapWith = null;
      if (target !== null) target.swappedBy = null;
      this.pushEvent({
        kind: 'body-snatcher',
        outcome: 'ended',
        ownerInstanceId: participant.instanceId,
        targetInstanceId: targetId,
        side: this.teams[participant.sideIndex].side,
      });
    }
  }

  private removeClone(
    team: TeamRuntime,
    ownerInstanceId: string,
    reason: 'owner-exited' | 'fouled-out',
  ): void {
    const clone = team.participants.find(
      (candidate) =>
        candidate.kind === 'clone' &&
        candidate.ownerInstanceId === ownerInstanceId &&
        candidate.active,
    );
    if (clone === undefined) return;
    clone.active = false;
    clone.cloneExited = true;
    this.pushEvent({
      kind: 'clone',
      outcome: 'exited',
      ownerInstanceId,
      cloneInstanceId: clone.instanceId,
      side: team.side,
      reason,
    });
  }

  private globalById(instanceId: string): ParticipantState | null {
    return this.teams[0].byId.get(instanceId) ?? this.teams[1].byId.get(instanceId) ?? null;
  }

  private equalizerApplies(participant: ParticipantState): boolean {
    return this.teams.some(
      (team) =>
        team.sideIndex !== participant.sideIndex &&
        this.activeOwners(team.sideIndex, 'the-great-equalizer').length > 0,
    );
  }

  private recomputeEqualizer(tipoff: boolean): boolean {
    const capped: ParticipantState[] = [];
    for (const team of this.teams) {
      const sample = team.active[0] ?? team.participants[0];
      if (sample === undefined || team.active.length === 0) continue;
      if (!this.equalizerApplies(sample)) continue;
      for (const participant of team.active) capped.push(participant);
    }
    const ids = capped.map((participant) => participant.instanceId).sort();
    if (!tipoff && ids.join(',') === this.lastCapped.join(',')) return false;
    this.lastCapped = ids;
    const ownerTeam = this.teams.find(
      (team) => this.activeOwners(team.sideIndex, 'the-great-equalizer').length > 0,
    );
    const owner =
      ownerTeam === undefined
        ? null
        : this.activeOwners(ownerTeam.sideIndex, 'the-great-equalizer')[0];
    if (owner === null || owner === undefined) return false;
    const counters = this.rollupFor(owner, 'the-great-equalizer');
    if (counters !== undefined) counters.triggers += 1;
    this.pushEvent({
      kind: 'great-equalizer',
      outcome: this.equalizerApplied ? 'updated' : 'applied',
      ownerInstanceId: owner.instanceId,
      cappedInstanceIds: ids.slice(0, 10),
    });
    this.equalizerApplied = true;
    if (!tipoff) this.rebuildBattleProfiles();
    return true;
  }

  private recomputeTimeLord(source: 'tipoff' | 'owner-exit'): boolean {
    const limits: [number, number] = [this.fullShotClockOf(0), this.fullShotClockOf(1)];
    const changed = limits[0] !== this.lastTimeLord[0] || limits[1] !== this.lastTimeLord[1];
    if (!changed) return false;
    const previous = [...this.lastTimeLord] as [number, number];
    this.lastTimeLord = limits;
    for (const side of [0, 1] as const) {
      if (limits[side] === previous[side]) continue;
      this.pushEvent({
        kind: 'time-lord',
        side: this.teams[side].side,
        fullSeconds: limits[side],
        reboundSeconds: Math.min(14, limits[side]),
        source,
      });
      if (
        this.tripContext !== null &&
        this.tripContext.shotClock !== undefined &&
        source === 'owner-exit'
      ) {
        this.tripContext.shotClock.remaining = Math.min(
          this.tripContext.shotClock.remaining,
          limits[side],
        );
      }
    }
    return true;
  }

  private rebuildBattleProfiles(): void {
    for (const team of this.teams) {
      for (const participant of team.participants) {
        let ratings = { ...participant.effective.ratings };
        let tendencies = { ...participant.effective.tendencies };
        if (participant.fusionDonorInstanceId !== null) {
          const donor = this.globalById(participant.fusionDonorInstanceId);
          if (donor !== null && participant.active) {
            for (const field of REQUIRED_RATING_KEYS) {
              ratings[field] = Math.max(ratings[field], donor.effective.ratings[field]);
            }
            tendencies.usageRate = 99;
          }
        } else if (participant.fusionOwnerInstanceId !== null) {
          const owner = this.globalById(participant.fusionOwnerInstanceId);
          if (owner !== null && owner.active) {
            for (const field of REQUIRED_RATING_KEYS) {
              ratings[field] = HAVOC_FUSION_DONOR_RATING;
            }
          }
        }
        if (participant.swapWith !== null) {
          const target = this.globalById(participant.swapWith);
          if (target !== null) {
            ratings = { ...target.source.profile.ratings };
            tendencies = { ...target.source.profile.tendencies };
          }
        } else if (participant.swappedBy !== null) {
          const owner = this.globalById(participant.swappedBy);
          if (owner !== null) {
            ratings = { ...owner.source.profile.ratings };
            tendencies = { ...owner.source.profile.tendencies };
          }
        }
        if (participant.darwinismReductions > 0) {
          for (const field of HAVOC_SCORING_RATING_FIELDS) {
            ratings[field] = Math.max(
              0,
              ratings[field] - HAVOC_DARWINISM_REDUCTION * participant.darwinismReductions,
            );
          }
        }
        if (this.equalizerApplies(participant)) {
          ratings = capRatings(ratings, HAVOC_EQUALIZER_CAP);
        }
        participant.evidence =
          participant.effective.authoritativeChannels.length === 0
            ? undefined
            : {
                isAuthoritative: (channel) =>
                  participant.effective.authoritativeChannels.includes(channel),
              };
        participant.simPlayer = {
          playerId: participant.source.playerId,
          ...(participant.source.playerVersionId === null
            ? {}
            : { playerVersionId: participant.source.playerVersionId }),
          displayName: participant.source.displayName,
          positions: participant.source.positions,
          heightInches: participant.effective.physical.heightInches,
          weightLbs: participant.effective.physical.weightLbs,
          ratings,
          tendencies,
          ...(participant.source.profile.anchors === undefined
            ? {}
            : { anchors: participant.source.profile.anchors }),
          ...(participant.source.profile.reconstructedThreePoint === undefined
            ? {}
            : { reconstructedThreePoint: participant.source.profile.reconstructedThreePoint }),
          overall: participant.source.originalOverall,
        };
      }
    }
    this.playerInstance.clear();
    for (const team of this.teams) {
      for (const participant of team.participants) {
        this.playerInstance.set(participant.simPlayer, participant);
      }
    }
  }

  private rebuildActiveTeams(): void {
    for (const team of this.teams) {
      const bySlot: ParticipantState[] = [];
      for (let slot = 0; slot < 5; slot += 1) {
        const participant = team.participants.find(
          (candidate) =>
            candidate.active && candidate.kind !== 'clone' && candidate.slotIndex === slot,
        );
        if (participant !== undefined) bySlot.push(participant);
      }
      const clones = team.participants.filter(
        (candidate) => candidate.active && candidate.kind === 'clone',
      );
      team.active = [...bySlot, ...clones];
      const simTeam: SimulationTeam = {
        teamId: team.input.teamId,
        displayName: team.input.displayName,
        players: team.active.map((participant) => participant.simPlayer),
      };
      const tripContext = this.requireTripContext();
      tripContext.teams[team.sideIndex] = simTeam;
      tripContext.preps[team.sideIndex] = prepareTeam(simTeam, this.input.profile, {
        keyOf: (player) => this.playerInstance.get(player)?.instanceId ?? 'missing',
        responsibilitySlotOf: (player) => this.playerInstance.get(player)?.slotIndex ?? 0,
        evidenceOf: (player) => this.evidenceOf(player),
        aggregateDivisor: 5,
        rebounderWeightScale: (player) => this.reboundWeightScale(player),
        reboundMeanReach: (player) => this.reboundMeanReach(player),
      });
      this.recorder.setActiveUnits(
        team.sideIndex,
        team.active.map((participant) => participant.rosterIndex),
      );
    }
  }

  expireExtraPossessions(): void {
    for (const team of this.teams) {
      while (team.extraQueue.length > 0) {
        const grant = team.extraQueue.shift();
        if (grant === undefined) break;
        const owner = team.byId.get(grant.ownerInstanceId);
        if (owner !== undefined) {
          const counters = this.rollupFor(owner, 'rebound-loop');
          if (counters !== undefined) counters.extraPossessionsExpired += 1;
        }
        this.pushEvent({
          kind: 'extra-possession',
          outcome: 'expired',
          ownerInstanceId: grant.ownerInstanceId,
          side: team.side,
          possessionId: null,
        });
      }
    }
  }

  consumeExtraPossession(team: TeamRuntime): { ownerInstanceId: string } | null {
    const grant = team.extraQueue.shift();
    if (grant === undefined) return null;
    const owner = team.byId.get(grant.ownerInstanceId);
    if (owner !== undefined) {
      const counters = this.rollupFor(owner, 'rebound-loop');
      if (counters !== undefined) counters.extraPossessionsUsed += 1;
    }
    this.rushedExtraSide = team.sideIndex;
    this.pushEvent({
      kind: 'extra-possession',
      outcome: 'started',
      ownerInstanceId: grant.ownerInstanceId,
      side: team.side,
      possessionId: this.possessionId + 1,
    });
    return { ownerInstanceId: grant.ownerInstanceId };
  }

  // ----------------------------------------------------------- tape writing

  private clock(): number {
    const seconds = this.tripContext?.state.secondsRemaining ?? 0;
    return Math.max(0, Math.round(seconds));
  }

  pushEvent(event: HavocEventPayload): number {
    const full = {
      sequence: this.eventSeq,
      gameNumber: this.input.gameNumber,
      period: this.period,
      clockSeconds: this.clock(),
      ...event,
    };
    this.events.push(full);
    const sequence = this.eventSeq;
    this.eventSeq += 1;
    return sequence;
  }

  pushScoring(entry: HavocScoringPayload): number {
    const full: HavocScoringEntry = {
      sequence: this.scoreSeq,
      gameNumber: this.input.gameNumber,
      period: this.period,
      clockSeconds: this.clock(),
      possessionId: this.possessionId,
      ...entry,
    };
    this.scoring.push(full);
    const sequence = this.scoreSeq;
    this.scoreSeq += 1;
    return sequence;
  }

  // -------------------------------------------------------------- results

  rollupsOf(): HavocMutationRollup[] {
    const rollups: HavocMutationRollup[] = [];
    for (const team of this.teams) {
      for (const participant of team.participants) {
        if (participant.mutations.size === 0) continue;
        const activeSeconds = Math.round(participant.activeSeconds);
        for (const mutationId of participant.mutations) {
          const counters = participant.rollup.get(mutationId) ?? zeroRollup();
          rollups.push({
            ownerInstanceId: participant.instanceId,
            mutationId,
            side: team.side,
            triggers: counters.triggers,
            pointsDelta: counters.pointsDelta,
            freeThrowsGranted: counters.freeThrowsGranted,
            turnoversCancelled: counters.turnoversCancelled,
            extraPossessionsEarned: counters.extraPossessionsEarned,
            extraPossessionsUsed: counters.extraPossessionsUsed,
            extraPossessionsExpired: counters.extraPossessionsExpired,
            swapSeconds:
              mutationId === 'body-snatcher' || mutationId === 'fusion-dance' ? activeSeconds : 0,
            capSeconds: mutationId === 'the-great-equalizer' ? activeSeconds : 0,
            activeSeconds,
            ratingChanges: counters.ratingChanges,
          });
        }
      }
    }
    return rollups.slice(0, 40);
  }

  highlightsOf(overtimePeriods: number): HavocHighlight[] {
    const highlights: HavocHighlight[] = [];
    for (const entry of this.scoring) {
      if (highlights.length >= HAVOC_HIGHLIGHT_LIMIT) break;
      if (entry.addends.length === 0 && entry.multipliers.length === 0) continue;
      const source = entry.addends[0]?.source ?? entry.multipliers[0]?.source;
      if (source === undefined) continue;
      highlights.push({
        kind: 'mutation',
        period: entry.period,
        clockSeconds: entry.clockSeconds,
        instanceId: entry.actorInstanceId,
        mutationId: SCORING_SOURCE_MUTATION[source],
        pointsDelta: entry.points - entry.nominalPoints,
      });
    }
    for (const team of this.teams) {
      for (const participant of team.participants) {
        if (highlights.length >= HAVOC_HIGHLIGHT_LIMIT) break;
        if (
          (participant.kind === 'starter' && participant.replaced) ||
          (participant.kind === 'clone' && participant.cloneExited)
        ) {
          highlights.push({
            kind: 'foul-out',
            period: this.period,
            clockSeconds: 0,
            instanceId: participant.instanceId,
            mutationId: null,
            pointsDelta: 0,
          });
        }
      }
    }
    const periodTotals = this.periodTotals();
    for (const side of [0, 1] as const) {
      if (highlights.length >= HAVOC_HIGHLIGHT_LIMIT) break;
      const negativeIndex = periodTotals[side].findIndex((points) => points < 0);
      if (negativeIndex >= 0) {
        highlights.push({
          kind: 'negative-score',
          period: negativeIndex + 1,
          clockSeconds: 0,
          instanceId: null,
          mutationId: null,
          pointsDelta: periodTotals[side][negativeIndex] ?? 0,
        });
      }
    }
    void overtimePeriods;
    return highlights.slice(0, HAVOC_HIGHLIGHT_LIMIT);
  }

  private periodTotals(): [number[], number[]] {
    const totals: [number[], number[]] = [
      Array.from({ length: this.period }, () => 0),
      Array.from({ length: this.period }, () => 0),
    ];
    for (const entry of this.scoring) {
      const index = entry.period - 1;
      const side = entry.side === this.teams[0].side ? 0 : 1;
      totals[side][index] = (totals[side][index] ?? 0) + entry.points;
    }
    return totals;
  }

  sidePoints(side: SideIndex): number {
    const target = this.teams[side].side;
    return this.scoring
      .filter((entry) => entry.side === target)
      .reduce((sum, entry) => sum + entry.points, 0);
  }

  participantPoints(instanceId: string): number {
    return this.scoring
      .filter((entry) => entry.actorInstanceId === instanceId && entry.kind !== 'bonus')
      .reduce((sum, entry) => sum + entry.points, 0);
  }

  teamBonusPoints(sideIndex: SideIndex): number {
    const side = this.teams[sideIndex].side;
    return this.scoring
      .filter((entry) => entry.side === side && entry.kind === 'bonus')
      .reduce((sum, entry) => sum + entry.points, 0);
  }

  teamOf(sideIndex: SideIndex): TeamRuntime {
    return this.teams[sideIndex];
  }

  activeParticipants(sideIndex: SideIndex): ParticipantState[] {
    return this.teams[sideIndex].active;
  }
}

class HavocGameController {
  private readonly input: HavocGameInput;
  private readonly context: EngineContext;
  private readonly rng: Rng;
  private readonly recorder: GameRecorder;
  private readonly state = createGameState();
  private readonly runtime: HavocGameRuntime;
  private tripContext: TripContext;
  private offense: SideIndex = 0;
  private period = 1;
  private secondsRemaining = REGULATION_PERIOD_SECONDS;
  private possessionId = 0;

  constructor(input: HavocGameInput, context: EngineContext) {
    this.input = input;
    this.context = context;
    this.rng = context.rngFactory(input.seed);
    const homeCount =
      input.home.starters.length + input.home.replacements.length + input.home.clones.length;
    const awayCount =
      input.away.starters.length + input.away.replacements.length + input.away.clones.length;
    this.recorder = new GameRecorder([homeCount, awayCount]);
    const placeholder: [SimulationTeam, SimulationTeam] = [
      this.placeholderTeam(input.home),
      this.placeholderTeam(input.away),
    ];
    this.tripContext = createTripContext(
      this.rng,
      this.recorder,
      this.state,
      input.profile,
      placeholder,
    );
    this.runtime = new HavocGameRuntime(input, context, this.rng, this.recorder);
    this.runtime.attachTripContext(this.tripContext);
    this.runtime.initialize();
  }

  private placeholderTeam(team: HavocTeamInput): SimulationTeam {
    return {
      teamId: team.teamId,
      displayName: team.displayName,
      players: team.starters.map((starter) => ({
        playerId: starter.source.playerId,
        ...(starter.source.playerVersionId === null
          ? {}
          : { playerVersionId: starter.source.playerVersionId }),
        displayName: starter.source.displayName,
        positions: starter.source.positions,
        heightInches: starter.effective.physical.heightInches,
        weightLbs: starter.effective.physical.weightLbs,
        ratings: starter.effective.ratings,
        tendencies: starter.effective.tendencies,
      })),
    };
  }

  run(): { result: HavocGameResult; tape: HavocGameTape } {
    this.runtime.beginTipoff();
    this.offense = this.rng.chance(0.5) ? 0 : 1;
    this.secondsRemaining = REGULATION_PERIOD_SECONDS;
    this.state.periodIndex = 0;
    this.runtime.period = 1;
    this.runtime.pushEvent({ kind: 'period-start' });
    for (;;) {
      this.playPeriod();
      const homeScore = this.runtime.sidePoints(0);
      const awayScore = this.runtime.sidePoints(1);
      this.runtime.pushEvent({ kind: 'period-end', homeScore, awayScore });
      if (this.period >= 4 && homeScore !== awayScore) break;
      if (this.period >= MAX_PERIODS_HARD_CAP) {
        throw new HavocSimulationExhaustedError(
          this.period,
          homeScore,
          awayScore,
          `seed ${this.input.seed} game ${String(this.input.gameNumber)}`,
        );
      }
      this.period += 1;
      this.runtime.period = this.period;
      this.recorder.nextPeriod();
      this.secondsRemaining =
        this.period <= 4 ? REGULATION_PERIOD_SECONDS : OVERTIME_PERIOD_SECONDS;
      this.state.periodIndex = this.period - 1;
      this.state.periodFouls = [0, 0];
      this.tripContext.possessionStart = 'neutral';
      this.runtime.pushEvent({ kind: 'period-start' });
    }
    this.runtime.expireExtraPossessions();
    const homeScore = this.runtime.sidePoints(0);
    const awayScore = this.runtime.sidePoints(1);
    const winner = homeScore > awayScore ? 'home' : 'away';
    this.runtime.pushEvent({ kind: 'game-end', homeScore, awayScore, winner });
    return this.buildResult();
  }

  private playPeriod(): void {
    let firstOfPeriod = true;
    while (this.secondsRemaining > 0) {
      this.prepareNextPossession(firstOfPeriod);
      firstOfPeriod = false;
      this.possessionId += 1;
      this.runtime.pushEvent({
        kind: 'possession-start',
        possessionId: this.possessionId,
        offenseSide: this.runtime.teams[this.offense].side,
      });
      this.runtime.beginPossession(this.offense, this.possessionId);
      this.state.secondsRemaining = this.secondsRemaining;
      const result = resolveTrip(this.tripContext, this.offense);
      this.secondsRemaining = this.state.secondsRemaining;
      this.distributeSeconds(result.secondsElapsed);
      this.runtime.onPossessionEnd(this.offense);
      this.runtime.processBoundary();
      if (!result.ended) break;
    }
  }

  private prepareNextPossession(firstOfPeriod: boolean): void {
    const team = this.runtime.teamOf(this.offense);
    const grant = this.runtime.consumeExtraPossession(team);
    if (grant !== null) return;
    if (!firstOfPeriod) this.offense = (1 - this.offense) as SideIndex;
  }

  private distributeSeconds(seconds: number): void {
    if (!(seconds > 0)) return;
    for (const team of [0, 1] as const) {
      for (const participant of this.runtime.activeParticipants(team)) {
        participant.activeSeconds += seconds;
        this.recorder.playSeconds(team, participant.rosterIndex, seconds);
      }
    }
  }

  private buildResult(): { result: HavocGameResult; tape: HavocGameTape } {
    const overtimePeriods = Math.max(0, this.period - 4);
    const gameSeconds = 4 * REGULATION_PERIOD_SECONDS + overtimePeriods * OVERTIME_PERIOD_SECONDS;
    const home = this.buildTeamResult(0, gameSeconds);
    const away = this.buildTeamResult(1, gameSeconds);
    const homeScore = home.points;
    const awayScore = away.points;
    const result = havocGameResultSchema.parse({
      schemaVersion: HAVOC_SCHEMA_VERSION,
      gameNumber: this.input.gameNumber,
      variant: this.input.variant,
      seed: this.input.seed,
      engineVersion: this.context.engineVersion,
      rulesVersion: HAVOC_RULES_VERSION,
      mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
      profileVersion: this.input.profile.profileVersion,
      dataVersion: this.input.versionSet.dataVersion,
      humanSide: this.input.humanSide,
      home,
      away,
      winner: homeScore > awayScore ? 'home' : 'away',
      overtimePeriods,
      inputDigest: havocGameInputDigest(this.input),
      rollups: this.runtime.rollupsOf(),
      highlights: this.runtime.highlightsOf(overtimePeriods),
    });
    const tape = havocGameTapeSchema.parse({
      schemaVersion: HAVOC_SCHEMA_VERSION,
      gameNumber: this.input.gameNumber,
      variant: this.input.variant,
      seed: this.input.seed,
      events: this.runtime.events,
      scoring: this.runtime.scoring,
    });
    return { result, tape };
  }

  private buildTeamResult(sideIndex: SideIndex, gameSeconds: number): HavocTeamResult {
    const team = this.runtime.teamOf(sideIndex);
    const recorderSide = this.recorder.sides[sideIndex];
    const participants = team.participants.filter((participant) => participant.started);
    const seconds = this.roundCourtSeconds(participants, gameSeconds);
    const cloneSeconds = participants
      .filter((participant) => participant.kind === 'clone')
      .reduce((sum, participant) => sum + (seconds.get(participant.instanceId) ?? 0), 0);
    const teamPeriods = this.periodTotalsFor(sideIndex);
    const points = this.runtime.sidePoints(sideIndex);
    const nominal =
      (recorderSide.fieldGoalMakes - recorderSide.threeMakes) * 2 +
      recorderSide.threeMakes * 3 +
      recorderSide.freeThrowMakes;
    const lines: HavocParticipantLine[] = participants.map((participant) => {
      const record = this.recorder.players[sideIndex][participant.rosterIndex];
      const secondsPlayed = seconds.get(participant.instanceId) ?? 0;
      const playerPoints = this.runtime.participantPoints(participant.instanceId);
      const fgm = record?.fieldGoalMakes ?? 0;
      const tpm = record?.threeMakes ?? 0;
      const ftm = record?.freeThrowMakes ?? 0;
      const playerNominal = (fgm - tpm) * 2 + tpm * 3 + ftm;
      return {
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
        fieldGoals: { made: fgm, attempted: record?.fieldGoalAttempts ?? 0 },
        threes: { made: tpm, attempted: record?.threeAttempts ?? 0 },
        freeThrows: { made: ftm, attempted: record?.freeThrowAttempts ?? 0 },
        rebounds: {
          total: (record?.offensiveRebounds ?? 0) + (record?.defensiveRebounds ?? 0),
          offensive: record?.offensiveRebounds ?? 0,
          defensive: record?.defensiveRebounds ?? 0,
        },
        assists: record?.assists ?? 0,
        steals: record?.steals ?? 0,
        blocks: record?.blocks ?? 0,
        turnovers: record?.turnovers ?? 0,
        fouls: record?.fouls ?? 0,
        chargedFouls: participant.chargedFouls,
        adjustments: playerPoints - playerNominal,
      };
    });
    return {
      side: sideIndex === 0 ? 'home' : 'away',
      teamId: team.input.teamId,
      displayName: team.input.displayName,
      points,
      fieldGoals: { made: recorderSide.fieldGoalMakes, attempted: recorderSide.fieldGoalAttempts },
      threes: { made: recorderSide.threeMakes, attempted: recorderSide.threeAttempts },
      freeThrows: { made: recorderSide.freeThrowMakes, attempted: recorderSide.freeThrowAttempts },
      rebounds: {
        total:
          recorderSide.offensiveRebounds +
          recorderSide.defensiveRebounds +
          recorderSide.teamRebounds,
        offensive: recorderSide.offensiveRebounds,
        defensive: recorderSide.defensiveRebounds,
        team: recorderSide.teamRebounds,
      },
      assists: recorderSide.assists,
      steals: recorderSide.steals,
      blocks: recorderSide.blocks,
      turnovers: recorderSide.turnovers,
      fouls: recorderSide.fouls,
      adjustments: points - nominal,
      teamBonusPoints: this.runtime.teamBonusPoints(sideIndex),
      periods: teamPeriods,
      courtSeconds: 5 * gameSeconds + cloneSeconds,
      participants: lines,
    };
  }

  private roundCourtSeconds(
    participants: readonly ParticipantState[],
    gameSeconds: number,
  ): Map<string, number> {
    const seconds = new Map<string, number>();
    for (const participant of participants) {
      seconds.set(participant.instanceId, Math.round(participant.activeSeconds));
    }
    for (let slot = 0; slot < 5; slot += 1) {
      const chain = participants.filter(
        (participant) => participant.kind !== 'clone' && participant.slotIndex === slot,
      );
      if (chain.length === 0) continue;
      const rounded = chain.reduce(
        (sum, participant) => sum + (seconds.get(participant.instanceId) ?? 0),
        0,
      );
      const error = gameSeconds - rounded;
      if (error === 0) continue;
      const fractions = chain.map((participant) => ({
        participant,
        fraction: participant.activeSeconds - Math.floor(participant.activeSeconds),
      }));
      fractions.sort((a, b) => b.fraction - a.fraction);
      const chosen = fractions[0]?.participant ?? chain[0];
      if (chosen === undefined) continue;
      seconds.set(chosen.instanceId, (seconds.get(chosen.instanceId) ?? 0) + error);
    }
    return seconds;
  }

  private periodTotalsFor(sideIndex: SideIndex): number[] {
    const side = this.runtime.teams[sideIndex].side;
    const totals = Array.from({ length: this.period }, () => 0);
    for (const entry of this.runtime.scoring) {
      if (entry.side !== side) continue;
      const index = entry.period - 1;
      totals[index] = (totals[index] ?? 0) + entry.points;
    }
    return totals;
  }
}

export function simulateHavocGame(
  rawInput: HavocGameInput,
  context: EngineContext,
): { result: HavocGameResult; tape: HavocGameTape } {
  const input = havocGameInputSchema.parse(rawInput);
  const controller = new HavocGameController(input, context);
  return controller.run();
}
