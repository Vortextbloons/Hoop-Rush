import type {
  HavocBattleEvent,
  HavocBattleInput,
  HavocBattleMutationRollup,
  HavocBattleResult,
  HavocBattleScoringEntry,
  HavocBattleTape,
  HavocBattleTeamInput,
  HavocGameAudit,
  HavocHighlight,
  HavocMutationId,
  HavocParticipantLine,
  HavocShotKind,
  HavocTeamResult,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '../../../../../../packages/data-contracts/src/index.ts';
import {
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_PERSONAL_FOUL_LIMIT,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
  havocAuthoritativeChannelSchema,
  havocBattleInputSchema,
  havocBattleResultSchema,
  havocBattleTapeSchema,
  seasonDigestHex,
  seedSchema,
} from '../../../../../../packages/data-contracts/src/index.ts';
import { clamp } from '../../../domain/math.ts';
import type { ApronRuntimeHooks } from '../../../sim/apron-runtime.ts';
import {
  MAX_PERIODS_HARD_CAP,
  OVERTIME_PERIOD_SECONDS,
  REGULATION_PERIOD_SECONDS,
} from '../../../sim/clock.ts';
import { ENGINE_CONSTANTS } from '../../../sim/constants.ts';
import { freeThrowsForZone } from '../../../sim/fouls.ts';
import type {
  HavocCoveragePlan,
  HavocEvidence,
  HavocFoulResult,
  HavocRuntimeHooks,
  HavocShotPlan,
} from '../../../sim/havoc-runtime.ts';
import type { EngineContext } from '../../../sim/kernel.ts';
import { sameGroupMatchWeight } from '../../../sim/position-responsibilities.ts';
import {
  createGameState,
  createTripContext,
  resolveTrip,
  type TripContext,
} from '../../../sim/possession.ts';
import { GameRecorder, type SideIndex } from '../../../sim/recorder.ts';
import type { Rng } from '../../../sim/rng.ts';
import { pickDefender } from '../../../sim/usage.ts';
import { auditHavocBattleGame, type HavocBattleAuditFacts } from './battle-audit.ts';
import { havocBattleGameInputDigest } from './battle-digests.ts';
import { HAVOC_DOUBLE_MISS_GIFT, HavocFieldGoalRuntime } from './battle-field-goal.ts';
import { HavocMutationLedger } from './battle-mutation-ledger.ts';
import { HavocParticipants } from './battle-participants.ts';
import { HavocProfileEffects } from './battle-profile-effects.ts';
import type {
  Attribution,
  HavocBattleEventPayload,
  HavocBattleScoringPayload,
  ParticipantState,
  RollupCounters,
  TeamRuntime,
} from './battle-runtime-types.ts';
import { havocBattleCapabilityTargets } from './battle-targets.ts';
export { HAVOC_SCORING_SOURCE_MUTATION, havocFieldGoalValue } from './battle-scoring.ts';
export type {
  HavocFieldGoalContribution,
  HavocFieldGoalValue,
  HavocFieldGoalValueInput,
} from './battle-scoring.ts';

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

const HAVOC_HEAT_EXPIRY_POSSESSIONS = 5;
const HAVOC_BOUNTY_EXPIRY_POSSESSIONS = 5;
const HAVOC_REBOUND_LOOP_EVERY = 3;
const HAVOC_GOLDEN_ASSIST_EVERY = 3;
const HAVOC_DOUBLE_OR_NOTHING_FOUL_FREE_THROWS = 1;
const HAVOC_EXTRA_POSSESSION_RUSH_SECONDS = 12;

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

const ALL_AUTHORITATIVE: ReadonlySet<string> = new Set(havocAuthoritativeChannelSchema.options);

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

class HavocBattleRuntime implements HavocRuntimeHooks {
  private readonly participants: HavocParticipants;
  private readonly ledger: HavocMutationLedger;
  private readonly profileEffects: HavocProfileEffects;
  get teams(): [TeamRuntime, TeamRuntime] {
    return this.participants.teams;
  }
  get events(): HavocBattleEvent[] {
    return this.ledger.events;
  }
  get scoring(): HavocBattleScoringEntry[] {
    return this.ledger.scoring;
  }

  period = 1;
  possessionId = 0;

  private shotKindOrdinal = 0;
  private coverageCache: {
    possessionId: number;
    assignment: Map<string, ParticipantState>;
    help: ParticipantState[];
    rng: Rng;
  } | null = null;

  private readonly bodySnatcherTargets: ReadonlyMap<string, string>;
  private readonly hostileTakeoverTargets: ReadonlyMap<string, { from: string; to: string }>;
  private readonly bountyTargets: readonly [string | null, string | null];

  private rushedExtraSide: SideIndex | null = null;
  private darwinismDirty = false;
  private tripContext: TripContext | null = null;
  private readonly input: HavocBattleInput;
  private readonly context: EngineContext;
  private readonly mainRng: Rng;
  private readonly fieldGoal: HavocFieldGoalRuntime;

  constructor(
    input: HavocBattleInput,
    context: EngineContext,
    mainRng: Rng,
    recorder: GameRecorder,
  ) {
    this.input = input;
    this.context = context;
    this.mainRng = mainRng;
    this.participants = new HavocParticipants(input, recorder, {
      tripContext: () => this.requireTripContext(),
      evidenceOf: (player) => this.evidenceOf(player),
      reboundWeightScale: (player) => this.reboundWeightScale(player),
      reboundMeanReach: (player) => this.reboundMeanReach(player),
      pushEvent: (event) => this.pushEvent(event),
    });
    this.ledger = new HavocMutationLedger(input.gameNumber, this.participants, {
      period: () => this.period,
      possessionId: () => this.possessionId,
      clock: () => this.clock(),
    });
    this.profileEffects = new HavocProfileEffects(this.participants, this.ledger, {
      fullShotClock: (side) => this.fullShotClockOf(side),
      tripContext: () => this.tripContext,
    });
    this.fieldGoal = new HavocFieldGoalRuntime({
      teams: this.teams,
      context,
      possessionId: () => this.possessionId,
      tripContext: () => this.tripContext,
      requireParticipant: (player) => this.requireParticipant(player),
      period: () => this.period,
      rollupFor: (participant, mutation) => this.rollupFor(participant, mutation),
      activeOwners: (side, mutation) => this.activeOwners(side, mutation),
      runtimeSeed: (...parts) => runtimeSeed(input.seed, ...parts),
      pushEvent: (event) => this.pushEvent(event),
      pushScoring: (entry) => this.pushScoring(entry),
      attribute: (attributions) => {
        this.attribute(attributions);
      },
      markDarwinismDirty: () => {
        this.darwinismDirty = true;
      },
    });
    const targets = havocBattleCapabilityTargets(input);
    this.bodySnatcherTargets = targets.bodySnatcher;
    this.hostileTakeoverTargets = targets.hostileTakeover;
    this.bountyTargets = targets.bounty;
  }

  initialize(): void {
    this.rebuildBattleProfiles();
    this.rebuildActiveTeams();
  }

  attachTripContext(tripContext: TripContext): void {
    this.tripContext = tripContext;
    tripContext.havoc = this;
  }

  keyOf(player: SimulationPlayer): string {
    return this.participants.get(player)?.instanceId ?? `unknown:${player.playerId}`;
  }

  responsibilitySlotOf(player: SimulationPlayer): number {
    return this.participants.get(player)?.slotIndex ?? 0;
  }

  evidenceOf(player: SimulationPlayer): HavocEvidence | undefined {
    const participant = this.participants.get(player);
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
    if (participant.darwinismDecayPoints > 0) {
      return {
        isAuthoritative: (channel) =>
          participant.effective.authoritativeChannels.includes(channel) ||
          HAVOC_DARWINISM_CHANNELS.has(channel),
      };
    }
    return participant.evidence;
  }

  reboundWeightScale(player: SimulationPlayer): number {
    const participant = this.participants.get(player);
    if (participant === undefined) return 1;
    return (
      1 + (HAVOC_WINGSPAN_REBOUND_WEIGHT * participant.effective.physical.wingspanDeltaInches) / 24
    );
  }

  reboundMeanReach(player: SimulationPlayer): number {
    const participant = this.participants.get(player);
    if (participant === undefined) return 0;
    return 4 * participant.effective.physical.reachUnits;
  }

  aggregateDivisor(): number {
    return 5;
  }

  private participantOf(player: SimulationPlayer | null): ParticipantState | null {
    return this.participants.participantOf(player);
  }

  private requireParticipant(player: SimulationPlayer): ParticipantState {
    return this.participants.requireParticipant(player);
  }

  private activeOwners(side: SideIndex, mutationId: HavocMutationId): ParticipantState[] {
    return this.participants.activeOwners(side, mutationId);
  }

  private rollupFor(
    participant: ParticipantState,
    mutationId: HavocMutationId,
  ): RollupCounters | undefined {
    return this.ledger.rollupFor(participant, mutationId);
  }

  private attribute(attributions: readonly Attribution[]): void {
    this.ledger.attribute(attributions);
  }

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

  cancelTurnover(_offense: SideIndex, handler: SimulationPlayer): boolean {
    const participant = this.participantOf(handler);
    if (participant === null || !participant.mutations.has('possession-refund')) return false;
    const period = this.period;
    if (participant.refundUsed[period] === true) return false;
    participant.refundUsed[period] = true;
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

  planShot(args: {
    offense: SideIndex;
    defense: SideIndex;
    shooter: SimulationPlayer;
    zone: ShotZone;
    action: import('../../../sim/usage.ts').ActionType;
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

  onFieldGoal(args: Parameters<HavocRuntimeHooks['onFieldGoal']>[0]): void {
    this.fieldGoal.onFieldGoal(args);
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
            side: this.teams[(1 - args.side) as SideIndex].side,
            kind: 'bonus',
            actorInstanceId: shooter.instanceId,
            beneficiaryInstanceId: null,
            nominalPoints: 0,
            addends: [{ source: 'double-or-nothing', points: HAVOC_DOUBLE_MISS_GIFT }],
            multipliers: [],
            points: HAVOC_DOUBLE_MISS_GIFT,
            owners: doubleOwners.map((owner) => owner.instanceId),
            originalEventSequence: attemptSequence,
          });
          this.attribute([
            { owner: primary, mutationId: 'double-or-nothing', points: -HAVOC_DOUBLE_MISS_GIFT },
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
    const bountyTarget = this.bountyTargets[defense];
    if (
      blockerState.mutations.has('the-bounty') &&
      bountyTarget !== null &&
      shooterState.instanceId === bountyTarget &&
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

  beginPossession(possessionId: number): void {
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
    for (const [ownerId, swap] of this.hostileTakeoverTargets) {
      const owner = this.teams[0].byId.get(ownerId) ?? this.teams[1].byId.get(ownerId);
      const from = this.teams[0].byId.get(swap.from) ?? this.teams[1].byId.get(swap.from);
      const to = this.teams[0].byId.get(swap.to) ?? this.teams[1].byId.get(swap.to);
      if (owner === undefined || from === undefined || to === undefined) continue;
      from.takeoverWith = swap.to;
      to.takeoverBy = swap.from;
      const counters = this.rollupFor(owner, 'hostile-takeover');
      if (counters !== undefined) counters.triggers += 1;
      this.pushEvent({
        kind: 'hostile-takeover',
        outcome: 'applied',
        ownerInstanceId: ownerId,
        side: this.teams[owner.sideIndex].side,
        fromInstanceId: swap.from,
        toInstanceId: swap.to,
      });
    }
    for (const team of this.teams) {
      const owner = team.participants.find(
        (participant) =>
          participant.kind === 'starter' && participant.mutations.has('oops-all-centers'),
      );
      if (owner === undefined) continue;
      team.centersOwner = owner.instanceId;
      const resized = team.input.starters.map((participant) => participant.instanceId).sort();
      const counters = this.rollupFor(owner, 'oops-all-centers');
      if (counters !== undefined) counters.triggers += 1;
      this.pushEvent({
        kind: 'oops-all-centers',
        outcome: 'applied',
        ownerInstanceId: owner.instanceId,
        side: team.side,
        resizedInstanceIds: resized,
      });
    }
    this.rebuildBattleProfiles();
    this.rebuildActiveTeams();
    this.recomputeEqualizer(true);
    this.recomputeTimeLord('tipoff');
  }

  processBoundary(): void {
    const changed = this.participants.processExits();
    const equalizerChanged = this.recomputeEqualizer(false);
    const timeLordChanged = this.recomputeTimeLord('owner-exit');
    const darwinismChanged = this.darwinismDirty;
    this.darwinismDirty = false;
    if (changed || equalizerChanged || timeLordChanged || darwinismChanged) {
      this.rebuildBattleProfiles();
      this.rebuildActiveTeams();
    }
  }

  private globalById(instanceId: string): ParticipantState | null {
    return this.participants.globalById(instanceId);
  }

  private recomputeEqualizer(tipoff: boolean): boolean {
    return this.profileEffects.recomputeEqualizer(tipoff);
  }

  private recomputeTimeLord(source: 'tipoff' | 'owner-exit'): boolean {
    return this.profileEffects.recomputeTimeLord(source);
  }

  private rebuildBattleProfiles(): void {
    this.profileEffects.rebuildBattleProfiles();
  }

  private rebuildActiveTeams(): void {
    this.participants.rebuildActiveTeams();
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

  private clock(): number {
    const seconds = this.tripContext?.state.secondsRemaining ?? 0;
    return Math.max(0, Math.round(seconds));
  }

  pushEvent(event: HavocBattleEventPayload): number {
    return this.ledger.pushEvent(event);
  }

  pushScoring(entry: HavocBattleScoringPayload): number {
    return this.ledger.pushScoring(entry);
  }

  rollupsOf(): HavocBattleMutationRollup[] {
    return this.ledger.rollupsOf();
  }

  highlightsOf(overtimePeriods: number): HavocHighlight[] {
    return this.ledger.highlightsOf(overtimePeriods);
  }

  sidePoints(side: SideIndex): number {
    return this.ledger.sidePoints(side);
  }

  participantPoints(instanceId: string): number {
    return this.ledger.participantPoints(instanceId);
  }

  teamBonusPoints(sideIndex: SideIndex): number {
    return this.ledger.teamBonusPoints(sideIndex);
  }

  teamOf(sideIndex: SideIndex): TeamRuntime {
    return this.teams[sideIndex];
  }

  activeParticipants(sideIndex: SideIndex): ParticipantState[] {
    return this.teams[sideIndex].active;
  }
}

export interface HavocBattleOptions {
  readonly apron?: ApronRuntimeHooks;
}

interface HavocBattleRun {
  readonly result: HavocBattleResult;
  readonly tape: HavocBattleTape;
  /** Facts the simulation already established; the audit reuses them. */
  readonly auditFacts: HavocBattleAuditFacts;
}

class HavocBattleController {
  private readonly input: HavocBattleInput;
  private readonly context: EngineContext;
  private readonly rng: Rng;
  private readonly recorder: GameRecorder;
  private readonly state = createGameState();
  private readonly runtime: HavocBattleRuntime;
  private readonly options: HavocBattleOptions;
  private inputDigest: string | null = null;
  private tripContext: TripContext;
  private offense: SideIndex = 0;
  private period = 1;
  private secondsRemaining = REGULATION_PERIOD_SECONDS;
  private possessionId = 0;

  constructor(input: HavocBattleInput, context: EngineContext, options: HavocBattleOptions = {}) {
    this.input = input;
    this.context = context;
    this.options = options;
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
    if (this.options.apron !== undefined) this.tripContext.apron = this.options.apron;
    this.runtime = new HavocBattleRuntime(input, context, this.rng, this.recorder);
    this.runtime.attachTripContext(this.tripContext);
    this.runtime.initialize();
  }

  private placeholderTeam(team: HavocBattleTeamInput): SimulationTeam {
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

  private battleInputDigest(): string {
    return (this.inputDigest ??= havocBattleGameInputDigest(this.input));
  }

  run(): HavocBattleRun {
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
      this.runtime.beginPossession(this.possessionId);
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

  private buildResult(): HavocBattleRun {
    const overtimePeriods = Math.max(0, this.period - 4);
    const gameSeconds = 4 * REGULATION_PERIOD_SECONDS + overtimePeriods * OVERTIME_PERIOD_SECONDS;
    const home = this.buildTeamResult(0, gameSeconds);
    const away = this.buildTeamResult(1, gameSeconds);
    const homeScore = home.points;
    const awayScore = away.points;
    const result = havocBattleResultSchema.parse({
      schemaVersion: HAVOC_SCHEMA_VERSION,
      gameNumber: this.input.gameNumber,
      variant: this.input.variant,
      seed: this.input.seed,
      engineVersion: this.context.engineVersion,
      rulesVersion: HAVOC_RULES_VERSION,
      mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
      profileVersion: this.input.profile.profileVersion,
      dataVersion: this.input.versionSet.dataVersion,
      home,
      away,
      winner: homeScore > awayScore ? 'home' : 'away',
      overtimePeriods,
      inputDigest: this.battleInputDigest(),
      rollups: this.runtime.rollupsOf(),
      highlights: this.runtime.highlightsOf(overtimePeriods),
    });
    const tape: HavocBattleTape = {
      schemaVersion: HAVOC_SCHEMA_VERSION,
      gameNumber: this.input.gameNumber,
      variant: this.input.variant,
      seed: this.input.seed,
      events: this.runtime.events,
      scoring: this.runtime.scoring,
    };
    return {
      result,
      tape,
      auditFacts: { inputDigest: result.inputDigest, resultValidated: true },
    };
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

export function simulateHavocBattleGame(
  rawInput: HavocBattleInput,
  context: EngineContext,
  options: HavocBattleOptions = {},
): { result: HavocBattleResult; tape: HavocBattleTape } {
  return simulateValidatedHavocBattleGame(havocBattleInputSchema.parse(rawInput), context, options);
}

export function simulateValidatedHavocBattleGame(
  input: HavocBattleInput,
  context: EngineContext,
  options: HavocBattleOptions = {},
): { result: HavocBattleResult; tape: HavocBattleTape } {
  const battle = new HavocBattleController(input, context, options).run();
  return { result: battle.result, tape: havocBattleTapeSchema.parse(battle.tape) };
}

export function simulateAuditedHavocBattleGame(
  input: HavocBattleInput,
  context: EngineContext,
  options: HavocBattleOptions = {},
): { result: HavocBattleResult; tape: HavocBattleTape; audit: HavocGameAudit } {
  const battle = new HavocBattleController(input, context, options).run();
  const audit = auditHavocBattleGame(input, battle.result, battle.tape, battle.auditFacts);
  let tape: HavocBattleTape | undefined;
  return {
    result: battle.result,
    audit,
    get tape() {
      return (tape ??= havocBattleTapeSchema.parse(battle.tape));
    },
  };
}
