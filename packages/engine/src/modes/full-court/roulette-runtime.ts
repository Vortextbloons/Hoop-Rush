import type {
  HavocAuthoritativeChannel,
  HavocEffectiveProfile,
  HavocMutationId,
  Seed,
  ShotZone,
  SimulationPlayer,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_SCORING_RATING_FIELDS,
  HAVOC_TENDENCY_FIELDS,
  POSITIONS,
  REQUIRED_RATING_KEYS,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';
import type { HavocEvidence, HavocRuntimeHooks } from '../../sim/havoc-runtime.ts';
import type { GameRecorder, SideIndex } from '../../sim/recorder.ts';
import type { Rng } from '../../sim/rng.ts';
import { havocCoverageAssignment } from '../havoc/core/battle-game.ts';
import { havocFieldGoalValue } from '../havoc/core/battle-scoring.ts';
import { havocBaselineHeightInches } from '../havoc/physical.ts';
import {
  resolveFullCourtRouletteTeam,
  type ResolvedFullCourtRouletteAttachment,
} from './roulette.ts';
import {
  FULL_COURT_FOUL_LIMIT,
  drainedEnergy,
  fatiguedPlayer,
  fatigueLevelOf,
  type FullCourtRotationPlan,
  type FullCourtStaminaProfile,
} from './rotation.ts';
import type { FullCourtTeamGameInput } from './game.ts';

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
const HAVOC_DOUBLE_MISS_GIFT = 1;
const HAVOC_HEAT_STREAK_ARMS_AT = 2;
const HAVOC_ROULETTE_EVERY_ATTEMPTS = 4;
const HAVOC_BUZZER_WINDOW_TENTHS = 50;
const HAVOC_BUZZER_MISS_PENALTY = -1;
const HAVOC_DARWINISM_OWN_TEAM_REDUCTION = 3;
const HAVOC_DARWINISM_OPPONENT_REDUCTION = 5;
const HAVOC_COLD_BLOOD_MAX_BONUS = 5;
const HAVOC_COLD_BLOOD_OPPONENT_GIFT = 1;
const HAVOC_TRIPLE_THREAT_BONUS = 6;
const OOPS_ALL_CENTERS_HEIGHT_INCHES = 87;
const OOPS_ALL_CENTERS_FLOOR = 95;
const OOPS_ALL_CENTERS_SPEED_HANDLING_CAP = 35;
const OOPS_ALL_CENTERS_THREE_CAP = 40;
const EQUALIZER_RATING_CAP = 85;
const FUSION_DONOR_RATING = 40;
const FUSION_OWNER_USAGE = 99;

const ALL_AUTHORITATIVE_CHANNELS: ReadonlySet<HavocAuthoritativeChannel> = new Set([
  'two-point-accuracy',
  'three-point-accuracy',
  'three-point-volume',
  'free-throw-accuracy',
  'block-anchor',
  'assist-anchor',
  'rebound-weights',
  'turnover-blend',
  'offensive-allocation',
]);

const DARWINISM_CHANNELS: readonly HavocAuthoritativeChannel[] = [
  'two-point-accuracy',
  'three-point-accuracy',
  'free-throw-accuracy',
];

export interface FullCourtMutationRollup {
  readonly playerId: string;
  readonly mutationId: HavocMutationId;
  readonly triggers: number;
  readonly pointsDelta: number;
  readonly freeThrowsGranted: number;
  readonly turnoversCancelled: number;
  readonly extraPossessionsEarned: number;
  readonly extraPossessionsUsed: number;
  readonly extraPossessionsExpired: number;
}

interface RollupCounters {
  triggers: number;
  pointsDelta: number;
  freeThrowsGranted: number;
  turnoversCancelled: number;
  extraPossessionsEarned: number;
  extraPossessionsUsed: number;
  extraPossessionsExpired: number;
}

interface RouletteParticipant {
  readonly side: SideIndex;
  readonly recorderIndex: number;
  readonly rosterIndex: number;
  readonly kind: 'roster' | 'clone';
  readonly ownerIndex: number;
  readonly playerId: string;
  readonly ownerPlayerId: string | null;
  readonly participantKey: string;
  readonly slotIndex: number;
  readonly sourcePlayer: SimulationPlayer;
  readonly basePlayer: SimulationPlayer;
  readonly effectivePhysical: HavocEffectiveProfile['physical'];
  readonly authoritativeChannels: ReadonlySet<HavocAuthoritativeChannel>;
  readonly mutations: ReadonlySet<HavocMutationId>;
  readonly mutationOrder: readonly HavocMutationId[];
  readonly originalOverall: number;
  readonly stamina: FullCourtStaminaProfile;
  readonly rollups: Map<HavocMutationId, RollupCounters>;

  active: boolean;
  started: boolean;
  spawned: boolean;
  cloneExited: boolean;
  permanentlyExited: boolean;
  energy: number;
  foulsOut: boolean;
  committedFouls: number;
  foulReliefCount: number;
  shootingFoulsDrawn: number;
  fgStreak: number;
  heatArmed: boolean;
  heatArmedAt: number;
  fgaCount: number;
  assistCount: number;
  refundUsedPeriods: Set<number>;
  reboundLoopCount: number;
  putbackArmedAt: number;
  bountyArmed: boolean;
  bountyArmedAt: number;
  coldBloodStreak: number;
  tripleThreatPeriod: number;
  tripleThreatZones: number;
  darwinismDecay: number;

  swapWith: number;
  swappedBy: number;
  fusionDonor: number;
  fusionOwner: number;
  takeoverWith: number;
  takeoverBy: number;

  dynamicRatings: SimulationPlayer['ratings'];
  dynamicTendencies: SimulationPlayer['tendencies'];
  dynamicHeight: number;
  dynamicEvidence: HavocEvidence;
  dynamicPlayer: SimulationPlayer;
}

export interface FullCourtCloneResult {
  readonly recorderIndex: number;
  readonly playerId: string;
  readonly displayName: string;
  readonly ownerPlayerId: string;
  readonly startedGame: boolean;
  readonly energy: number;
  readonly foulsOut: boolean;
  readonly chargedFouls: number;
}

interface CoverageState {
  possessionId: number;
  assignment: Map<string, string>;
  help: RouletteParticipant[];
  rng: Rng;
  valid: boolean;
}

function makeEvidence(channels: ReadonlySet<HavocAuthoritativeChannel>): HavocEvidence {
  return { isAuthoritative: (channel) => channels.has(channel) };
}

function clonePlayerId(ownerId: string, used: Set<string>): SimulationPlayer['playerId'] {
  const suffix = ':clone';
  const base =
    ownerId.length + suffix.length <= 64
      ? `${ownerId}${suffix}`
      : `${ownerId.slice(0, 64 - suffix.length)}${suffix}`;
  if (!used.has(base)) {
    used.add(base);
    return base as SimulationPlayer['playerId'];
  }
  for (let attempt = 2; ; attempt += 1) {
    const tag = `:clone-${String(attempt)}`;
    const candidate = `${ownerId.slice(0, Math.max(1, 64 - tag.length))}${tag}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate as SimulationPlayer['playerId'];
    }
  }
}

function derivedStream(
  rngFactory: (seed: string) => Rng,
  ...parts: readonly (string | number)[]
): Rng {
  const material = parts.map((part) => String(part)).join('\u0000');
  return rngFactory(seasonDigestHex(material));
}

function defaultPhysicalOf(
  player: SimulationPlayer,
  attachment: ResolvedFullCourtRouletteAttachment | undefined,
): HavocEffectiveProfile['physical'] {
  if (attachment !== undefined) return attachment.physical;
  const slot = player.positions[0] ?? 'SF';
  const baseline = havocBaselineHeightInches(
    { heightInches: player.heightInches, weightLbs: player.weightLbs },
    slot,
  );
  return {
    baselineHeightInches: baseline.baselineHeightInches,
    baselineHeightSource: baseline.baselineHeightSource,
    heightInches: player.heightInches ?? baseline.baselineHeightInches,
    weightLbs: player.weightLbs,
    wingspanDeltaInches: 0,
    reachUnits: 0,
  };
}

function rankByOverallDesc(participants: readonly RouletteParticipant[]): RouletteParticipant[] {
  return [...participants].sort((left, right) => {
    if (left.originalOverall !== right.originalOverall) {
      return right.originalOverall - left.originalOverall;
    }
    const leftId = left.basePlayer.playerVersionId ?? left.playerId;
    const rightId = right.basePlayer.playerVersionId ?? right.playerId;
    if (leftId !== rightId) return leftId < rightId ? -1 : 1;
    return left.participantKey < right.participantKey
      ? -1
      : left.participantKey > right.participantKey
        ? 1
        : 0;
  });
}

function rankByOverallAsc(participants: readonly RouletteParticipant[]): RouletteParticipant[] {
  return [...participants].sort((left, right) => {
    if (left.originalOverall !== right.originalOverall) {
      return left.originalOverall - right.originalOverall;
    }
    const leftId = left.basePlayer.playerVersionId ?? left.playerId;
    const rightId = right.basePlayer.playerVersionId ?? right.playerId;
    if (leftId !== rightId) return leftId < rightId ? -1 : 1;
    return left.participantKey < right.participantKey
      ? -1
      : left.participantKey > right.participantKey
        ? 1
        : 0;
  });
}

function zoneDefenseSkill(participant: RouletteParticipant, zone: ShotZone): number {
  const r = participant.dynamicRatings;
  if (zone === 'rim' || zone === 'shortMid') return r.interiorDefense;
  if (zone === 'longMid') return (r.interiorDefense + r.perimeterDefense) / 2;
  return r.perimeterDefense;
}

function zoneDefenseWeight(participant: RouletteParticipant, zone: ShotZone): number {
  return Math.max(0.25, (zoneDefenseSkill(participant, zone) - 45) / 35);
}

/**
 * Owns per-game Full Court Roulette mutation state, clone lifecycle, dynamic
 * Tier-3 profile transforms, scoring deltas, and `HavocRuntimeHooks` for one
 * rotating game.
 */
export class FullCourtRouletteRuntime {
  private readonly seed: Seed;
  private readonly rngFactory: (seed: string) => Rng;
  private readonly plans: readonly [FullCourtRotationPlan, FullCourtRotationPlan];
  private readonly participants: [RouletteParticipant[], RouletteParticipant[]] = [[], []];
  private readonly clonesByOwnerIndex: readonly [
    Map<number, RouletteParticipant>,
    Map<number, RouletteParticipant>,
  ] = [new Map<number, RouletteParticipant>(), new Map<number, RouletteParticipant>()];
  private readonly bySimulationPlayer = new WeakMap<SimulationPlayer, RouletteParticipant>();
  private readonly byKey: readonly [
    Map<string, RouletteParticipant>,
    Map<string, RouletteParticipant>,
  ] = [new Map<string, RouletteParticipant>(), new Map<string, RouletteParticipant>()];
  private readonly extraQueue: [number[], number[]] = [[], []];
  private readonly pointAdjustments: [number, number] = [0, 0];
  private readonly teamBonusPoints: [number, number] = [0, 0];
  private readonly profileEpochs: [number, number] = [0, 0];
  private readonly bountyTarget: [number, number] = [-1, -1];
  private readonly takeoverPair: [
    { ownerIndex: number; fromIndex: number; toIndex: number; active: boolean } | null,
    { ownerIndex: number; fromIndex: number; toIndex: number; active: boolean } | null,
  ] = [null, null];

  private recorder: GameRecorder | null = null;
  private readShotClock: () => number | null = () => null;
  private currentPeriod = 0;
  private possessionId = 0;
  private shotKindOrdinal = 0;
  private rushedExtraSide: SideIndex | -1 = -1;
  private darwinismDirty = false;
  private coverage: CoverageState | null = null;

  readonly hooks: HavocRuntimeHooks;

  static hasMutations(home: FullCourtTeamGameInput, away: FullCourtTeamGameInput): boolean {
    return (
      (home.roulette?.attachments.length ?? 0) > 0 || (away.roulette?.attachments.length ?? 0) > 0
    );
  }

  constructor(input: {
    readonly seed: Seed;
    readonly rngFactory: (seed: string) => Rng;
    readonly homeTeam: FullCourtTeamGameInput;
    readonly awayTeam: FullCourtTeamGameInput;
    readonly homePlan: FullCourtRotationPlan;
    readonly awayPlan: FullCourtRotationPlan;
  }) {
    this.seed = input.seed;
    this.rngFactory = input.rngFactory;
    this.plans = [input.homePlan, input.awayPlan];
    const resolvedTeams = [
      resolveFullCourtRouletteTeam(input.homeTeam),
      resolveFullCourtRouletteTeam(input.awayTeam),
    ] as const;

    for (const side of [0, 1] as const) {
      const plan = this.plans[side];
      const resolved = resolvedTeams[side];
      const usedIds = new Set(plan.roster.map((player) => player.playerId));
      const slotMap = new Map<number, number>();
      plan.startingSlots.forEach((rosterIndex, slot) => slotMap.set(rosterIndex, slot));

      plan.roster.forEach((rosterPlayer, rosterIndex) => {
        const attachment = resolved.attachmentsByPlayerId.get(rosterPlayer.playerId);
        const basePlayer = attachment?.basePlayer ?? rosterPlayer;
        const sourcePlayer = attachment?.sourcePlayer ?? rosterPlayer;
        const participantKey =
          attachment?.participantKey ?? rosterPlayer.playerVersionId ?? rosterPlayer.playerId;
        const physical = defaultPhysicalOf(basePlayer, attachment);
        const channels = attachment?.authoritativeChannels ?? new Set<HavocAuthoritativeChannel>();
        const mutations = attachment?.mutations ?? new Set<HavocMutationId>();
        const mutationOrder = attachment?.mutationOrder ?? [];
        const stamina = plan.stamina[rosterIndex];
        if (stamina === undefined) {
          throw new Error(
            `full court roulette missing stamina profile at roster index ${String(rosterIndex)}`,
          );
        }
        const participant = this.createParticipant({
          side,
          recorderIndex: rosterIndex,
          rosterIndex,
          kind: 'roster',
          ownerIndex: -1,
          playerId: rosterPlayer.playerId,
          ownerPlayerId: null,
          participantKey,
          slotIndex:
            slotMap.get(rosterIndex) ??
            (attachment !== undefined ? POSITIONS.indexOf(attachment.slot) : rosterIndex % 5),
          sourcePlayer,
          basePlayer,
          effectivePhysical: physical,
          authoritativeChannels: channels,
          mutations,
          mutationOrder,
          stamina,
          energy: plan.startingEnergy[rosterIndex] ?? 1,
        });
        this.participants[side].push(participant);
        this.byKey[side].set(participant.participantKey, participant);
        this.byKey[side].set(participant.playerId, participant);
      });

      const rosterCount = plan.roster.length;
      let cloneOffset = 0;
      for (let rosterIndex = 0; rosterIndex < rosterCount; rosterIndex += 1) {
        const owner = this.participants[side][rosterIndex];
        if (owner === undefined || !owner.mutations.has('clone-army')) continue;
        const recorderIndex = rosterCount + cloneOffset;
        cloneOffset += 1;
        const id = clonePlayerId(owner.playerId, usedIds);
        const cloneBasePlayer: SimulationPlayer = {
          ...owner.basePlayer,
          playerId: id,
          displayName: `${owner.basePlayer.displayName} (Clone)`,
        };
        const cloneSourcePlayer: SimulationPlayer = {
          ...owner.sourcePlayer,
          playerId: id,
          displayName: `${owner.sourcePlayer.displayName} (Clone)`,
        };
        const clone = this.createParticipant({
          side,
          recorderIndex,
          rosterIndex: -1,
          kind: 'clone',
          ownerIndex: rosterIndex,
          playerId: id,
          ownerPlayerId: owner.playerId,
          participantKey: `${owner.participantKey}:clone`,
          slotIndex: owner.slotIndex,
          sourcePlayer: cloneSourcePlayer,
          basePlayer: cloneBasePlayer,
          effectivePhysical: { ...owner.effectivePhysical },
          authoritativeChannels: new Set(owner.authoritativeChannels),
          mutations: new Set(),
          mutationOrder: [],
          stamina: owner.stamina,
          energy: owner.energy,
        });
        this.participants[side].push(clone);
        this.clonesByOwnerIndex[side].set(rosterIndex, clone);
        this.byKey[side].set(clone.participantKey, clone);
        this.byKey[side].set(clone.playerId, clone);
      }
    }

    this.hooks = this.createHooks();
  }

  private createParticipant(input: {
    side: SideIndex;
    recorderIndex: number;
    rosterIndex: number;
    kind: 'roster' | 'clone';
    ownerIndex: number;
    playerId: string;
    ownerPlayerId: string | null;
    participantKey: string;
    slotIndex: number;
    sourcePlayer: SimulationPlayer;
    basePlayer: SimulationPlayer;
    effectivePhysical: HavocEffectiveProfile['physical'];
    authoritativeChannels: ReadonlySet<HavocAuthoritativeChannel>;
    mutations: ReadonlySet<HavocMutationId>;
    mutationOrder: readonly HavocMutationId[];
    stamina: FullCourtStaminaProfile;
    energy: number;
  }): RouletteParticipant {
    const rollups = new Map<HavocMutationId, RollupCounters>();
    for (const id of input.mutationOrder) {
      rollups.set(id, {
        triggers: 0,
        pointsDelta: 0,
        freeThrowsGranted: 0,
        turnoversCancelled: 0,
        extraPossessionsEarned: 0,
        extraPossessionsUsed: 0,
        extraPossessionsExpired: 0,
      });
    }
    const evidence = makeEvidence(input.authoritativeChannels);
    const participant: RouletteParticipant = {
      ...input,
      originalOverall:
        input.sourcePlayer.overall ?? input.sourcePlayer.ratingProfile?.canonicalOverall ?? 75,
      rollups,
      active: false,
      started: false,
      spawned: false,
      cloneExited: false,
      permanentlyExited: false,
      foulsOut: false,
      committedFouls: 0,
      foulReliefCount: 0,
      shootingFoulsDrawn: 0,
      fgStreak: 0,
      heatArmed: false,
      heatArmedAt: -1,
      fgaCount: 0,
      assistCount: 0,
      refundUsedPeriods: new Set(),
      reboundLoopCount: 0,
      putbackArmedAt: -1,
      bountyArmed: false,
      bountyArmedAt: -1,
      coldBloodStreak: 0,
      tripleThreatPeriod: 0,
      tripleThreatZones: 0,
      darwinismDecay: 0,
      swapWith: -1,
      swappedBy: -1,
      fusionDonor: -1,
      fusionOwner: -1,
      takeoverWith: -1,
      takeoverBy: -1,
      dynamicRatings: { ...input.basePlayer.ratings },
      dynamicTendencies: { ...input.basePlayer.tendencies },
      dynamicHeight: input.effectivePhysical.heightInches,
      dynamicEvidence: evidence,
      dynamicPlayer: input.basePlayer,
    };
    this.bySimulationPlayer.set(input.basePlayer, participant);
    return participant;
  }

  recorderSize(side: SideIndex): number {
    return this.participants[side].length;
  }

  bindRecorder(recorder: GameRecorder): void {
    this.recorder = recorder;
  }

  bindShotClock(reader: () => number | null): void {
    this.readShotClock = reader;
  }

  profileEpoch(side: SideIndex): number {
    return this.profileEpochs[side];
  }

  activeCloneRecorderIndices(side: SideIndex): number[] {
    return this.participants[side]
      .filter((participant) => participant.kind === 'clone' && participant.active)
      .map((participant) => participant.recorderIndex);
  }

  activeCloneIds(side: SideIndex): string[] {
    return this.participants[side]
      .filter((participant) => participant.kind === 'clone' && participant.active)
      .map((participant) => participant.playerId);
  }

  playerKeyForRecorderIndex(side: SideIndex, recorderIndex: number): string {
    const participant = this.participants[side][recorderIndex];
    if (participant === undefined) {
      throw new Error(
        `full court roulette: missing participant at ${String(side)}:${String(recorderIndex)}`,
      );
    }
    return participant.participantKey;
  }

  spawnedClones(side: SideIndex): FullCourtCloneResult[] {
    return this.participants[side]
      .filter((participant) => participant.kind === 'clone' && participant.spawned)
      .map((clone) => ({
        recorderIndex: clone.recorderIndex,
        playerId: clone.playerId,
        displayName: clone.basePlayer.displayName,
        ownerPlayerId: clone.ownerPlayerId ?? '',
        startedGame: clone.started,
        energy: clone.energy,
        foulsOut: clone.foulsOut,
        chargedFouls: clone.committedFouls,
      }));
  }

  chargedFoulsFor(side: SideIndex, rosterIndex: number): number {
    const participant = this.participants[side][rosterIndex];
    if (participant === undefined) return 0;
    return Math.max(0, participant.committedFouls - participant.foulReliefCount);
  }

  /**
   * Initializes active starters, clones, tipoff pairings (`fusion-dance`,
   * `body-snatcher`, `hostile-takeover`, `the-bounty`), and initial dynamic
   * profiles before the opening period starts.
   */
  onTipoff(startingSlots: readonly [readonly number[], readonly number[]]): void {
    for (const side of [0, 1] as const) {
      for (const [slot, rosterIndex] of startingSlots[side].entries()) {
        const participant = this.participants[side][rosterIndex];
        if (participant === undefined) continue;
        participant.active = true;
        participant.started = true;
        participant.spawned = true;
        const clone = this.clonesByOwnerIndex[side].get(rosterIndex);
        if (clone !== undefined) {
          clone.active = true;
          clone.started = true;
          clone.spawned = true;
          this.bumpTrigger(participant, 'clone-army');
        }
        // Keep starter slot aligned with starting five.
        void slot;
      }
    }

    for (const side of [0, 1] as const) {
      const other = (1 - side) as SideIndex;
      const ownStarters = startingSlots[side]
        .map((index) => this.participants[side][index])
        .filter((value): value is RouletteParticipant => value !== undefined);
      const oppStarters = startingSlots[other]
        .map((index) => this.participants[other][index])
        .filter((value): value is RouletteParticipant => value !== undefined);
      const rankedOppStarters = rankByOverallDesc(oppStarters);
      if (rankedOppStarters[0] !== undefined) {
        this.bountyTarget[side] = rankedOppStarters[0].recorderIndex;
      }

      // Fusion Dance: starters first, then available bench reserves.
      const ownEligible = this.orderedAvailableParticipants(side, startingSlots[side]);
      const fusionOwner = ownEligible.find((participant) =>
        participant.mutations.has('fusion-dance'),
      );
      if (fusionOwner !== undefined) {
        const candidates = ownEligible.filter(
          (participant) => participant.recorderIndex !== fusionOwner.recorderIndex,
        );
        candidates.sort((left, right) => {
          if (left.originalOverall !== right.originalOverall) {
            return right.originalOverall - left.originalOverall;
          }
          return left.rosterIndex - right.rosterIndex;
        });
        const donor = candidates[0];
        if (donor !== undefined) {
          fusionOwner.fusionDonor = donor.recorderIndex;
          donor.fusionOwner = fusionOwner.recorderIndex;
          this.bumpTrigger(fusionOwner, 'fusion-dance');
        }
      }

      // Body Snatcher: starters first, then available bench reserves.
      const snatcherOwners = ownEligible.filter((participant) =>
        participant.mutations.has('body-snatcher'),
      );
      snatcherOwners.forEach((owner, ordinal) => {
        const target = rankedOppStarters[ordinal];
        if (target === undefined) return;
        owner.swapWith = target.recorderIndex;
        target.swappedBy = owner.recorderIndex;
        this.bumpTrigger(owner, 'body-snatcher');
      });

      // Hostile Takeover: starters activate at tipoff; bench-only owners wait until first entry.
      const takeoverOwner = ownEligible.find((participant) =>
        participant.mutations.has('hostile-takeover'),
      );
      if (takeoverOwner !== undefined) {
        const lowestOwn = rankByOverallAsc(ownStarters)[0];
        const highestOpp = rankedOppStarters[0];
        if (lowestOwn !== undefined && highestOpp !== undefined) {
          const activeAtTipoff = takeoverOwner.started;
          this.takeoverPair[side] = {
            ownerIndex: takeoverOwner.recorderIndex,
            fromIndex: lowestOwn.recorderIndex,
            toIndex: highestOpp.recorderIndex,
            active: activeAtTipoff,
          };
          if (activeAtTipoff) {
            lowestOwn.takeoverWith = highestOpp.recorderIndex;
            highestOpp.takeoverBy = lowestOwn.recorderIndex;
            this.bumpTrigger(takeoverOwner, 'hostile-takeover');
          }
        }
      }
    }

    this.rebuildAllProfiles();
  }

  private orderedAvailableParticipants(
    side: SideIndex,
    startingSlots: readonly number[],
  ): RouletteParticipant[] {
    const plan = this.plans[side];
    const starterSet = new Set(startingSlots);
    const starters = startingSlots
      .map((index) => this.participants[side][index])
      .filter(
        (participant): participant is RouletteParticipant =>
          participant !== undefined && plan.available[participant.rosterIndex] === true,
      );
    const bench = this.participants[side].filter(
      (participant) =>
        participant.kind === 'roster' &&
        !starterSet.has(participant.rosterIndex) &&
        plan.available[participant.rosterIndex] === true,
    );
    return [...starters, ...bench];
  }

  effectiveSimulationPlayer(
    side: SideIndex,
    recorderIndex: number,
    fatigueLevel: number,
    cache?: Map<number, SimulationPlayer>,
  ): SimulationPlayer {
    const participant = this.participants[side][recorderIndex];
    if (participant === undefined) {
      throw new Error(
        `full court roulette: unknown participant ${String(side)}:${String(recorderIndex)}`,
      );
    }
    const base = participant.dynamicPlayer;
    const fatigued = fatiguedPlayer(base, fatigueLevel, cache);
    this.bySimulationPlayer.set(fatigued, participant);
    this.bySimulationPlayer.set(base, participant);
    return fatigued;
  }

  drainClones(side: SideIndex, exertionSeconds: number): void {
    for (const participant of this.participants[side]) {
      if (participant.kind !== 'clone' || !participant.active) continue;
      participant.energy = drainedEnergy(participant.energy, participant.stamina, exertionSeconds);
    }
  }

  recoverClones(side: SideIndex, recovery: number): void {
    for (const participant of this.participants[side]) {
      if (participant.kind !== 'clone' || !participant.active) continue;
      participant.energy = Math.min(1, participant.energy + recovery);
    }
  }

  /** Updates clone and player active states on substitution or foul-out. */
  onPlayerExited(side: SideIndex, rosterIndex: number, permanent: boolean): void {
    const participant = this.participants[side][rosterIndex];
    if (participant === undefined) return;
    participant.active = false;
    if (permanent) {
      participant.permanentlyExited = true;
      this.endPermanentPowers(participant);
    }
    const clone = this.clonesByOwnerIndex[side].get(rosterIndex);
    if (clone !== undefined && clone.active) {
      clone.active = false;
      clone.cloneExited = true;
    }
    this.rebuildAllProfiles();
  }

  onPlayerEntered(side: SideIndex, rosterIndex: number): void {
    const participant = this.participants[side][rosterIndex];
    if (participant === undefined) return;
    participant.active = true;
    const clone = this.clonesByOwnerIndex[side].get(rosterIndex);
    if (clone !== undefined && !clone.spawned && !clone.cloneExited) {
      clone.active = true;
      clone.spawned = true;
      clone.energy = participant.energy;
      this.bumpTrigger(participant, 'clone-army');
    }
    const pair = this.takeoverPair[side];
    if (pair !== null && !pair.active && pair.ownerIndex === participant.recorderIndex) {
      pair.active = true;
      const from = this.participants[side][pair.fromIndex];
      const to = this.participants[(1 - side) as SideIndex][pair.toIndex];
      if (from !== undefined && to !== undefined) {
        from.takeoverWith = to.recorderIndex;
        to.takeoverBy = from.recorderIndex;
        this.bumpTrigger(participant, 'hostile-takeover');
      }
    }
    this.rebuildAllProfiles();
  }

  private endPermanentPowers(participant: RouletteParticipant): void {
    participant.heatArmed = false;
    participant.heatArmedAt = -1;
    participant.fgStreak = 0;
    participant.bountyArmed = false;
    participant.bountyArmedAt = -1;
    participant.putbackArmedAt = -1;
    participant.coldBloodStreak = 0;
    participant.tripleThreatZones = 0;
    const side = participant.side;
    const other = (1 - side) as SideIndex;
    if (participant.fusionDonor >= 0) {
      const donor = this.participants[side][participant.fusionDonor];
      if (donor !== undefined) donor.fusionOwner = -1;
      participant.fusionDonor = -1;
    }
    if (participant.swapWith >= 0) {
      const target = this.participants[other][participant.swapWith];
      if (target !== undefined) target.swappedBy = -1;
      participant.swapWith = -1;
    }
  }

  checkCloneFoulOuts(
    side: SideIndex,
    personalFouls: ReadonlyMap<string, number>,
  ): RouletteParticipant[] {
    const fouledOut: RouletteParticipant[] = [];
    for (const participant of this.participants[side]) {
      if (participant.kind !== 'clone' || !participant.active) continue;
      const fouls = personalFouls.get(participant.participantKey) ?? 0;
      participant.committedFouls = fouls;
      if (fouls >= FULL_COURT_FOUL_LIMIT) {
        participant.active = false;
        participant.cloneExited = true;
        participant.foulsOut = true;
        fouledOut.push(participant);
      }
    }
    if (fouledOut.length > 0) this.rebuildAllProfiles();
    return fouledOut;
  }

  beginPossession(offense: SideIndex, period: number, periodStart: boolean): void {
    this.currentPeriod = period;
    this.possessionId += 1;
    this.shotKindOrdinal = 0;
    this.coverage = null;
    if (periodStart) {
      this.consumeExtraPossession(offense);
    }
    for (const side of [0, 1] as const) {
      for (const participant of this.participants[side]) {
        if (
          participant.heatArmed &&
          participant.heatArmedAt >= 0 &&
          this.possessionId - participant.heatArmedAt >= HAVOC_HEAT_EXPIRY_POSSESSIONS
        ) {
          participant.heatArmed = false;
          participant.heatArmedAt = -1;
          participant.fgStreak = 0;
        }
        if (
          participant.bountyArmed &&
          participant.bountyArmedAt >= 0 &&
          this.possessionId - participant.bountyArmedAt >= HAVOC_BOUNTY_EXPIRY_POSSESSIONS
        ) {
          participant.bountyArmed = false;
          participant.bountyArmedAt = -1;
        }
      }
    }
  }

  afterTrip(
    offense: SideIndex,
    tripEnded: boolean,
    secondsRemaining: number,
    personalFouls: [Map<string, number>, Map<string, number>],
    playerKeys: readonly [readonly string[], readonly string[]],
  ): boolean {
    for (const participant of this.participants[offense]) {
      participant.putbackArmedAt = -1;
    }
    this.rushedExtraSide = -1;
    this.coverage = null;

    // Sync `foul-thief` relief into `ctx.personalFouls` so foul-outs and foul
    // avoidance see charged fouls while `recorder` keeps committed fouls.
    for (const side of [0, 1] as const) {
      const map = personalFouls[side];
      const keys = playerKeys[side];
      for (let rosterIndex = 0; rosterIndex < keys.length; rosterIndex += 1) {
        const participant = this.participants[side][rosterIndex];
        const key = keys[rosterIndex];
        if (participant === undefined || key === undefined) continue;
        const raw = map.get(key) ?? 0;
        if (raw > participant.committedFouls) {
          participant.committedFouls = raw;
        }
        if (participant.foulReliefCount > 0) {
          map.set(key, Math.max(0, participant.committedFouls - participant.foulReliefCount));
        }
      }
      for (const participant of this.participants[side]) {
        if (participant.kind === 'clone' && participant.active) {
          participant.committedFouls = map.get(participant.participantKey) ?? 0;
        }
      }
    }

    if (this.darwinismDirty) {
      this.darwinismDirty = false;
      this.rebuildAllProfiles();
    }

    if (tripEnded && secondsRemaining > 0 && this.consumeExtraPossession(offense)) {
      return true;
    }
    return false;
  }

  private consumeExtraPossession(side: SideIndex): boolean {
    const queue = this.extraQueue[side];
    const ownerIndex = queue.shift();
    if (ownerIndex === undefined) return false;
    const owner = this.participants[side][ownerIndex];
    if (owner !== undefined) {
      const counters = owner.rollups.get('rebound-loop');
      if (counters !== undefined) counters.extraPossessionsUsed += 1;
    }
    this.rushedExtraSide = side;
    return true;
  }

  onGameEnd(): void {
    for (const side of [0, 1] as const) {
      while (this.extraQueue[side].length > 0) {
        const ownerIndex = this.extraQueue[side].shift();
        if (ownerIndex === undefined) continue;
        const owner = this.participants[side][ownerIndex];
        const counters = owner?.rollups.get('rebound-loop');
        if (counters !== undefined) counters.extraPossessionsExpired += 1;
      }
    }
  }

  teamMetadata(side: SideIndex): {
    readonly teamBonusPoints: number;
    readonly pointAdjustments: number;
    readonly mutationRollups: readonly FullCourtMutationRollup[];
  } {
    const rollups: FullCourtMutationRollup[] = [];
    for (const participant of this.participants[side]) {
      for (const mutationId of participant.mutationOrder) {
        const counters = participant.rollups.get(mutationId);
        if (counters === undefined) continue;
        rollups.push({
          playerId: participant.playerId,
          mutationId,
          ...counters,
        });
      }
    }
    return {
      teamBonusPoints: this.teamBonusPoints[side],
      pointAdjustments: this.pointAdjustments[side],
      mutationRollups: rollups,
    };
  }

  cloneFatigueLevel(side: SideIndex, recorderIndex: number): number {
    const participant = this.participants[side][recorderIndex];
    return participant === undefined ? 0 : fatigueLevelOf(participant.energy);
  }

  private rebuildAllProfiles(): void {
    for (const side of [0, 1] as const) {
      const other = (1 - side) as SideIndex;
      const oppEqualizer = this.activeOwners(other, 'the-great-equalizer').length > 0;
      const ownCenters = this.activeOwners(side, 'oops-all-centers').length > 0;
      let changed = false;

      for (const participant of this.participants[side]) {
        const ratings: SimulationPlayer['ratings'] = { ...participant.basePlayer.ratings };
        let tendencies: SimulationPlayer['tendencies'] = { ...participant.basePlayer.tendencies };
        let height = participant.effectivePhysical.heightInches;
        const channels = new Set<HavocAuthoritativeChannel>(participant.authoritativeChannels);

        if (participant.fusionDonor >= 0) {
          const donor = this.participants[side][participant.fusionDonor];
          if (donor !== undefined && donor.active) {
            for (const key of REQUIRED_RATING_KEYS) {
              ratings[key] = Math.max(ratings[key], donor.basePlayer.ratings[key]);
            }
            tendencies = { ...tendencies, usageRate: FUSION_OWNER_USAGE };
            for (const channel of ALL_AUTHORITATIVE_CHANNELS) channels.add(channel);
          }
        } else if (participant.fusionOwner >= 0) {
          const owner = this.participants[side][participant.fusionOwner];
          if (owner !== undefined && owner.active) {
            for (const key of REQUIRED_RATING_KEYS) {
              ratings[key] = FUSION_DONOR_RATING;
            }
            for (const channel of ALL_AUTHORITATIVE_CHANNELS) channels.add(channel);
          }
        }

        if (participant.swapWith >= 0) {
          const target = this.participants[other][participant.swapWith];
          const ownerActive = participant.active && !participant.permanentlyExited;
          if (target !== undefined && ownerActive) {
            for (const key of REQUIRED_RATING_KEYS) {
              ratings[key] = target.sourcePlayer.ratings[key];
            }
            tendencies = { ...target.sourcePlayer.tendencies };
            for (const channel of ALL_AUTHORITATIVE_CHANNELS) channels.add(channel);
          }
        } else if (participant.swappedBy >= 0) {
          const owner = this.participants[other][participant.swappedBy];
          if (owner !== undefined && owner.active && !owner.permanentlyExited) {
            for (const key of REQUIRED_RATING_KEYS) {
              ratings[key] = owner.sourcePlayer.ratings[key];
            }
            tendencies = { ...owner.sourcePlayer.tendencies };
            for (const channel of ALL_AUTHORITATIVE_CHANNELS) channels.add(channel);
          }
        }

        if (participant.takeoverWith >= 0) {
          const target = this.participants[other][participant.takeoverWith];
          if (target !== undefined) {
            for (const key of REQUIRED_RATING_KEYS) {
              ratings[key] = target.basePlayer.ratings[key];
            }
            tendencies = { ...target.basePlayer.tendencies };
          }
        } else if (participant.takeoverBy >= 0) {
          const owner = this.participants[other][participant.takeoverBy];
          if (owner !== undefined) {
            for (const key of REQUIRED_RATING_KEYS) {
              ratings[key] = owner.basePlayer.ratings[key];
            }
            tendencies = { ...owner.basePlayer.tendencies };
          }
        }

        if (ownCenters && participant.kind !== 'clone') {
          height = OOPS_ALL_CENTERS_HEIGHT_INCHES;
          ratings.strength = Math.max(ratings.strength, OOPS_ALL_CENTERS_FLOOR);
          ratings.interiorDefense = Math.max(ratings.interiorDefense, OOPS_ALL_CENTERS_FLOOR);
          ratings.offensiveRebound = Math.max(ratings.offensiveRebound, OOPS_ALL_CENTERS_FLOOR);
          ratings.defensiveRebound = Math.max(ratings.defensiveRebound, OOPS_ALL_CENTERS_FLOOR);
          ratings.speed = Math.min(ratings.speed, OOPS_ALL_CENTERS_SPEED_HANDLING_CAP);
          ratings.ballHandling = Math.min(
            ratings.ballHandling,
            OOPS_ALL_CENTERS_SPEED_HANDLING_CAP,
          );
          ratings.threePoint = Math.min(ratings.threePoint, OOPS_ALL_CENTERS_THREE_CAP);
        }

        if (participant.darwinismDecay > 0) {
          for (const field of HAVOC_SCORING_RATING_FIELDS) {
            ratings[field] = Math.max(0, ratings[field] - participant.darwinismDecay);
          }
          for (const channel of DARWINISM_CHANNELS) channels.add(channel);
        }

        if (oppEqualizer) {
          for (const key of REQUIRED_RATING_KEYS) {
            ratings[key] = Math.min(ratings[key], EQUALIZER_RATING_CAP);
          }
        }

        if (
          !ratingsEqual(participant.dynamicRatings, ratings) ||
          !tendenciesEqual(participant.dynamicTendencies, tendencies) ||
          participant.dynamicHeight !== height ||
          !setsEqual(participant.dynamicEvidence, channels)
        ) {
          changed = true;
          participant.dynamicRatings = ratings;
          participant.dynamicTendencies = tendencies;
          participant.dynamicHeight = height;
          participant.dynamicEvidence = makeEvidence(channels);
          participant.dynamicPlayer = {
            ...participant.basePlayer,
            heightInches: height,
            ratings,
            tendencies,
          };
          this.bySimulationPlayer.set(participant.dynamicPlayer, participant);
        }
      }

      if (changed) {
        this.profileEpochs[side] += 1;
      }
    }
  }

  private activeParticipants(side: SideIndex): RouletteParticipant[] {
    return this.participants[side].filter((participant) => participant.active);
  }

  private activeOwners(side: SideIndex, mutationId: HavocMutationId): RouletteParticipant[] {
    return this.participants[side].filter(
      (participant) => participant.active && participant.mutations.has(mutationId),
    );
  }

  private participantOf(
    player: SimulationPlayer,
    side?: SideIndex,
  ): RouletteParticipant | undefined {
    const direct = this.bySimulationPlayer.get(player);
    if (direct !== undefined) return direct;
    if (side !== undefined) {
      return this.byKey[side].get(player.playerId);
    }
    return this.byKey[0].get(player.playerId) ?? this.byKey[1].get(player.playerId);
  }

  private bumpTrigger(participant: RouletteParticipant, mutationId: HavocMutationId): void {
    const counters = participant.rollups.get(mutationId);
    if (counters !== undefined) counters.triggers += 1;
  }

  private addPlayerPoints(
    participant: RouletteParticipant,
    points: number,
    mutationId: HavocMutationId,
  ): void {
    const recorder = this.recorder;
    if (recorder === null || points === 0) return;
    const player = recorder.players[participant.side][participant.recorderIndex];
    const team = recorder.sides[participant.side];
    if (player === undefined) return;
    player.points += points;
    team.points += points;
    const last = team.periodPoints.length - 1;
    team.periodPoints[last] = (team.periodPoints[last] ?? 0) + points;
    this.pointAdjustments[participant.side] += points;
    const counters = participant.rollups.get(mutationId);
    if (counters !== undefined) counters.pointsDelta += points;
  }

  private addTeamBonusPoints(
    beneficiarySide: SideIndex,
    owner: RouletteParticipant,
    points: number,
    mutationId: HavocMutationId,
  ): void {
    const recorder = this.recorder;
    if (recorder === null || points === 0) return;
    const team = recorder.sides[beneficiarySide];
    team.points += points;
    const last = team.periodPoints.length - 1;
    team.periodPoints[last] = (team.periodPoints[last] ?? 0) + points;
    this.teamBonusPoints[beneficiarySide] += points;
    const counters = owner.rollups.get(mutationId);
    if (counters !== undefined) counters.pointsDelta -= points;
  }

  private fullShotClockFor(side: SideIndex): number {
    let limit =
      this.activeOwners(side, 'time-lord').length > 0
        ? 30
        : this.activeOwners((1 - side) as SideIndex, 'time-lord').length > 0
          ? 12
          : 24;
    if (this.rushedExtraSide === side) {
      limit = Math.min(limit, HAVOC_EXTRA_POSSESSION_RUSH_SECONDS);
    }
    return limit;
  }

  private ensureCoverage(offense: SideIndex, defense: SideIndex): void {
    const offenseActive = this.activeParticipants(offense);
    const defenseActive = this.activeParticipants(defense);
    if (offenseActive.length === 5 && defenseActive.length === 5) {
      this.coverage = null;
      return;
    }
    if (
      this.coverage !== null &&
      this.coverage.valid &&
      this.coverage.possessionId === this.possessionId
    ) {
      return;
    }
    const rng = derivedStream(
      this.rngFactory,
      'havoc-runtime-v1',
      this.seed,
      'coverage',
      this.possessionId,
      offense,
    );
    const offByKey = new Map(offenseActive.map((p) => [p.participantKey, p]));
    const defByKey = new Map(defenseActive.map((p) => [p.participantKey, p]));
    const result = havocCoverageAssignment(
      offenseActive.map((p) => p.participantKey),
      defenseActive.map((p) => p.participantKey),
      (defenderKey, shooterKey) => {
        const def = defByKey.get(defenderKey);
        const off = offByKey.get(shooterKey);
        return def !== undefined && off !== undefined && def.slotIndex === off.slotIndex ? 1.35 : 1;
      },
      rng,
    );
    const assignment = new Map(
      result.assignment.map((pair) => [pair.shooterInstanceId, pair.defenderInstanceId]),
    );
    const help = result.helpInstanceIds
      .map((key) => defByKey.get(key))
      .filter((value): value is RouletteParticipant => value !== undefined);
    this.coverage = {
      possessionId: this.possessionId,
      assignment,
      help,
      rng,
      valid: true,
    };
  }

  private pickHelper(defense: SideIndex, zone: ShotZone): RouletteParticipant | null {
    const cov = this.coverage;
    if (cov === null) return null;
    const assignedDefs = new Set(cov.assignment.values());
    const defenseActive = this.activeParticipants(defense);
    const unassigned = defenseActive.filter((p) => !assignedDefs.has(p.participantKey));
    const pool = unassigned.length > 0 ? unassigned : defenseActive;
    if (pool.length === 0) return null;
    return cov.rng.weightedPick(
      pool,
      pool.map((p) => zoneDefenseWeight(p, zone)),
    );
  }

  private createHooks(): HavocRuntimeHooks {
    return {
      keyOf: (player) => this.participantOf(player)?.participantKey ?? player.playerId,
      responsibilitySlotOf: (player) => this.participantOf(player)?.slotIndex ?? 0,
      evidenceOf: (player) => this.participantOf(player)?.dynamicEvidence,
      changesEvidence: () => false,
      reboundWeightScale: (player) => {
        const wingspan = this.participantOf(player)?.effectivePhysical.wingspanDeltaInches ?? 0;
        return 1 + (HAVOC_WINGSPAN_REBOUND_WEIGHT * Math.max(0, wingspan)) / 24;
      },
      reboundMeanReach: (player) =>
        4 * (this.participantOf(player)?.effectivePhysical.reachUnits ?? 0),
      aggregateDivisor: () => 5,

      fullShotClock: (side) => this.fullShotClockFor(side),
      reboundShotClock: (side) => Math.min(14, this.fullShotClockFor(side)),
      onShotClockViolation: () => {},

      cancelTurnover: (offense, handler) => {
        const participant = this.participantOf(handler, offense);
        if (participant === undefined || !participant.mutations.has('possession-refund')) {
          return false;
        }
        if (participant.refundUsedPeriods.has(this.currentPeriod)) return false;
        participant.refundUsedPeriods.add(this.currentPeriod);
        const counters = participant.rollups.get('possession-refund');
        if (counters !== undefined) {
          counters.triggers += 1;
          counters.turnoversCancelled += 1;
        }
        return true;
      },
      onTurnover: (offense, handler) => {
        const participant = this.participantOf(handler, offense);
        if (participant !== undefined) participant.putbackArmedAt = -1;
      },
      onSteal: () => {},

      shotReach: (defender, zone) => {
        const interior = zone === 'rim' || zone === 'shortMid';
        if (!interior) return { contestPointDelta: 0, blockPointDelta: 0 };
        const reach = this.participantOf(defender)?.effectivePhysical.reachUnits ?? 0;
        return {
          contestPointDelta: -HAVOC_CONTEST_REACH_POINTS * reach,
          blockPointDelta: HAVOC_BLOCK_REACH_POINTS * reach,
        };
      },

      planShot: ({ offense, defense, shooter: shooterSim, zone, passed }) => {
        const shooter = this.participantOf(shooterSim, offense);
        if (shooter === undefined) {
          return {
            defender: null,
            coverage: {
              contestScale: 1,
              contestPointDelta: 0,
              makePointDelta: 0,
              blockPointDelta: 0,
            },
            shotKind: zone === 'rim' ? 'layup' : 'jumper',
            putback: false,
          };
        }
        const putback = shooter.putbackArmedAt >= 0 && !passed;
        this.ensureCoverage(offense, defense);
        let defenderParticipant: RouletteParticipant | null = null;
        let contestScale = 1;
        let helpPressure = 0;

        if (this.coverage !== null && this.coverage.valid) {
          const assignedKey = this.coverage.assignment.get(shooter.participantKey);
          if (assignedKey !== undefined) {
            defenderParticipant = this.byKey[defense].get(assignedKey) ?? null;
          } else {
            const helper = this.pickHelper(defense, zone);
            if (helper !== null) {
              defenderParticipant = helper;
              contestScale = HAVOC_UNCOVERED_CONTEST_SCALE;
            }
          }
          let totalHelp = 0;
          for (const helper of this.coverage.help) {
            const skill = zoneDefenseSkill(helper, zone);
            totalHelp += 0.01 * Math.floor(Math.max(0, skill) / 100);
          }
          helpPressure = Math.min(HAVOC_HELP_PRESSURE_CAP, totalHelp);
        }

        const interior = zone === 'rim' || zone === 'shortMid';
        const defenderReach = defenderParticipant?.effectivePhysical.reachUnits ?? 0;
        const contestPointDelta = interior ? -HAVOC_CONTEST_REACH_POINTS * defenderReach : 0;
        const blockPointDelta = interior ? HAVOC_BLOCK_REACH_POINTS * defenderReach : 0;
        const heightFeet = Math.max(
          -2,
          Math.min(
            2,
            (shooter.effectivePhysical.heightInches -
              shooter.effectivePhysical.baselineHeightInches) /
              12,
          ),
        );
        const finishDelta = zone === 'rim' ? HAVOC_FINISH_HEIGHT_POINTS * heightFeet : 0;

        let shotKind: 'layup' | 'dunk' | 'jumper';
        if (zone !== 'rim') {
          shotKind = 'jumper';
        } else if (putback) {
          shotKind = 'layup';
        } else {
          this.shotKindOrdinal += 1;
          const rng = derivedStream(
            this.rngFactory,
            'havoc-runtime-v1',
            this.seed,
            'shot-kind',
            this.possessionId,
            this.shotKindOrdinal,
            shooter.participantKey,
          );
          const probability = Math.max(
            0.05,
            Math.min(
              0.95,
              HAVOC_DUNK_BASE +
                HAVOC_DUNK_VERTICAL_WEIGHT * (shooter.dynamicRatings.vertical / 100) +
                HAVOC_DUNK_INSIDE_WEIGHT * (shooter.dynamicRatings.insideScoring / 100) +
                HAVOC_DUNK_HEIGHT_WEIGHT * (shooter.effectivePhysical.heightInches - 78),
            ),
          );
          shotKind = rng.next() < probability ? 'dunk' : 'layup';
        }

        return {
          defender: defenderParticipant === null ? null : defenderParticipant.dynamicPlayer,
          coverage: {
            contestScale,
            contestPointDelta,
            makePointDelta: finishDelta - helpPressure,
            blockPointDelta,
          },
          shotKind,
          putback,
        };
      },

      onFoul: ({ foulerSide, offenseSide, shooter: shooterSim, shooting, madeShot }) => {
        const doubleOwners = this.activeOwners(foulerSide, 'double-or-nothing');
        const doubleOrNothingFreeThrows =
          doubleOwners.length > 0 ? HAVOC_DOUBLE_OR_NOTHING_FOUL_FREE_THROWS : 0;
        let freeThrowsAwarded = 0;
        let bonusAttempts = 0;
        if (shooting && madeShot) {
          freeThrowsAwarded = 1;
          const shooter =
            shooterSim === null ? undefined : this.participantOf(shooterSim, offenseSide);
          if (shooter !== undefined && shooter.mutations.has('and-one-machine')) {
            freeThrowsAwarded = 2;
            bonusAttempts = 1;
            const counters = shooter.rollups.get('and-one-machine');
            if (counters !== undefined) {
              counters.triggers += 1;
              counters.freeThrowsGranted += 1;
            }
          }
        }
        if (doubleOrNothingFreeThrows > 0 && doubleOwners[0] !== undefined) {
          const counters = doubleOwners[0].rollups.get('double-or-nothing');
          if (counters !== undefined) {
            counters.triggers += 1;
            counters.freeThrowsGranted += doubleOrNothingFreeThrows;
          }
        }
        if (shooting && shooterSim !== null) {
          const shooter = this.participantOf(shooterSim, offenseSide);
          if (shooter !== undefined && shooter.mutations.has('foul-thief')) {
            shooter.shootingFoulsDrawn += 1;
            if (
              shooter.shootingFoulsDrawn % 2 === 0 &&
              shooter.committedFouls - shooter.foulReliefCount > 0
            ) {
              shooter.foulReliefCount += 1;
              this.bumpTrigger(shooter, 'foul-thief');
            }
          }
        }
        return {
          freeThrowsAwarded,
          bonusAttempts,
          technicalFreeThrows: 0,
          technicalForDefense: false,
          doubleOrNothingFreeThrows,
        };
      },

      onFieldGoal: ({
        offense,
        shooter: shooterSim,
        made,
        three,
        passed,
        shotKind,
        putback,
        zone,
      }) => {
        const shooter = this.participantOf(shooterSim, offense);
        if (shooter === undefined) return;
        const putbackValid = putback && !passed;
        if (shooter.putbackArmedAt >= 0) {
          shooter.putbackArmedAt = -1;
          this.bumpTrigger(shooter, 'second-chance-jackpot');
        }
        for (const mate of this.activeParticipants(offense)) {
          if (mate.recorderIndex !== shooter.recorderIndex && mate.putbackArmedAt >= 0) {
            mate.putbackArmedAt = -1;
          }
        }

        const nominal: 2 | 3 = three ? 3 : 2;
        const hasHeat = shooter.mutations.has('heat-check');
        const hasBounty = shooter.mutations.has('the-bounty');
        const hasFour = shooter.mutations.has('four-point-dunk');
        const hasCold = shooter.mutations.has('cold-blooded');
        const hasRoulette = shooter.mutations.has('basketball-roulette');
        const hasTriple = shooter.mutations.has('triple-threat');
        const heatBefore = hasHeat && shooter.heatArmed;
        const bountyBefore = hasBounty && shooter.bountyArmed;
        const fourPointDunk = made && shotKind === 'dunk' && hasFour;
        const reverseOwners = this.activeOwners(offense, 'reverse-basketball');
        const doubleOwners = this.activeOwners(offense, 'double-or-nothing');
        const coldBloodBonus =
          made && hasCold ? Math.min(HAVOC_COLD_BLOOD_MAX_BONUS, shooter.coldBloodStreak) : 0;

        const shotClass = three
          ? 2
          : zone === 'rim'
            ? 0
            : zone === 'shortMid' || zone === 'longMid'
              ? 1
              : -1;
        const tripleThreatCompletes =
          made &&
          shotClass >= 0 &&
          hasTriple &&
          shooter.tripleThreatPeriod === this.currentPeriod + 1 &&
          (shooter.tripleThreatZones & (1 << shotClass)) === 0 &&
          popcount(shooter.tripleThreatZones) === 2;
        const tripleThreatBonus = tripleThreatCompletes ? HAVOC_TRIPLE_THREAT_BONUS : 0;

        const clockSeconds = this.readShotClock();
        const shotClockTenths = clockSeconds === null ? -1 : Math.round(clockSeconds * 10);
        const buzzerQualifies =
          shooter.active &&
          shooter.mutations.has('buzzer-bandit') &&
          shotClockTenths >= 0 &&
          shotClockTenths <= HAVOC_BUZZER_WINDOW_TENTHS;

        let rolled: number | null = null;
        if (hasRoulette) {
          shooter.fgaCount += 1;
          if (shooter.fgaCount % HAVOC_ROULETTE_EVERY_ATTEMPTS === 0) {
            const rng = derivedStream(
              this.rngFactory,
              'havoc-runtime-v1',
              this.seed,
              'roulette',
              shooter.participantKey,
              shooter.fgaCount,
            );
            rolled = rng.nextInt(1, 4);
            this.bumpTrigger(shooter, 'basketball-roulette');
          }
        }

        if (made) {
          const fgValue = havocFieldGoalValue({
            nominal,
            three,
            roulette: rolled,
            fourPointDunk,
            reverseBasketball: reverseOwners.length > 0,
            heatCheck: heatBefore,
            putback: putbackValid,
            bounty: bountyBefore,
            doubleOrNothing: doubleOwners.length > 0,
            buzzerBandit: buzzerQualifies,
            coldBloodBonus,
            tripleThreatBonus,
          });
          const delta = fgValue.points - nominal;
          if (delta !== 0) {
            // Credit player box score points to the shooter and attribute rollups per contribution.
            const recorder = this.recorder;
            if (recorder !== null) {
              const player = recorder.players[shooter.side][shooter.recorderIndex];
              const team = recorder.sides[shooter.side];
              if (player !== undefined) {
                player.points += delta;
                team.points += delta;
                const last = team.periodPoints.length - 1;
                team.periodPoints[last] = (team.periodPoints[last] ?? 0) + delta;
                this.pointAdjustments[shooter.side] += delta;
              }
            }
          }
          for (const contribution of fgValue.contributions) {
            if (contribution.source === 'reverse-basketball') {
              const owner = reverseOwners[0];
              if (owner !== undefined) {
                this.bumpTrigger(owner, 'reverse-basketball');
                const counters = owner.rollups.get('reverse-basketball');
                if (counters !== undefined) counters.pointsDelta += contribution.points;
              }
            } else if (contribution.source === 'double-or-nothing') {
              const owner = doubleOwners[0];
              if (owner !== undefined) {
                this.bumpTrigger(owner, 'double-or-nothing');
                const counters = owner.rollups.get('double-or-nothing');
                if (counters !== undefined) counters.pointsDelta += contribution.points;
              }
            } else {
              const mutationMap: Partial<Record<typeof contribution.source, HavocMutationId>> = {
                roulette: 'basketball-roulette',
                'four-point-dunk': 'four-point-dunk',
                'heat-check': 'heat-check',
                'second-chance-jackpot': 'second-chance-jackpot',
                'the-bounty': 'the-bounty',
                'buzzer-bandit': 'buzzer-bandit',
                'cold-blooded': 'cold-blooded',
                'triple-threat': 'triple-threat',
              };
              const mut = mutationMap[contribution.source];
              if (mut !== undefined) {
                const counters = shooter.rollups.get(mut);
                if (counters !== undefined) counters.pointsDelta += contribution.points;
              }
            }
          }
          if (buzzerQualifies) this.bumpTrigger(shooter, 'buzzer-bandit');
          if (fourPointDunk) this.bumpTrigger(shooter, 'four-point-dunk');

          const darwinismOwners = [
            ...this.activeOwners(0, 'basketball-darwinism'),
            ...this.activeOwners(1, 'basketball-darwinism'),
          ];
          if (darwinismOwners.length > 0) {
            const sameTeam = darwinismOwners.some((owner) => owner.side === offense);
            const reduction = sameTeam
              ? HAVOC_DARWINISM_OWN_TEAM_REDUCTION
              : HAVOC_DARWINISM_OPPONENT_REDUCTION;
            shooter.darwinismDecay += reduction;
            for (const owner of darwinismOwners) this.bumpTrigger(owner, 'basketball-darwinism');
            this.darwinismDirty = true;
          }
        } else {
          if (doubleOwners[0] !== undefined) {
            this.addTeamBonusPoints(
              (1 - offense) as SideIndex,
              doubleOwners[0],
              HAVOC_DOUBLE_MISS_GIFT,
              'double-or-nothing',
            );
          }
          if (buzzerQualifies) {
            this.bumpTrigger(shooter, 'buzzer-bandit');
            this.addPlayerPoints(shooter, HAVOC_BUZZER_MISS_PENALTY, 'buzzer-bandit');
          }
        }

        if (hasHeat) {
          if (made) {
            if (heatBefore) {
              shooter.heatArmed = false;
              shooter.heatArmedAt = -1;
              shooter.fgStreak = 0;
              this.bumpTrigger(shooter, 'heat-check');
            } else {
              shooter.fgStreak += 1;
              if (shooter.fgStreak >= HAVOC_HEAT_STREAK_ARMS_AT) {
                shooter.heatArmed = true;
                shooter.heatArmedAt = this.possessionId;
                this.bumpTrigger(shooter, 'heat-check');
              }
            }
          } else {
            shooter.fgStreak = 0;
            shooter.heatArmed = false;
            shooter.heatArmedAt = -1;
          }
        }

        if (made && bountyBefore) {
          shooter.bountyArmed = false;
          shooter.bountyArmedAt = -1;
          this.bumpTrigger(shooter, 'the-bounty');
        }

        if (hasCold) {
          if (made) {
            shooter.coldBloodStreak = 0;
            this.bumpTrigger(shooter, 'cold-blooded');
          } else {
            shooter.coldBloodStreak += 1;
            this.bumpTrigger(shooter, 'cold-blooded');
            if (shooter.coldBloodStreak % 2 === 0) {
              this.addTeamBonusPoints(
                (1 - offense) as SideIndex,
                shooter,
                HAVOC_COLD_BLOOD_OPPONENT_GIFT,
                'cold-blooded',
              );
            }
          }
        }

        if (hasTriple) {
          const periodOneBased = this.currentPeriod + 1;
          if (shooter.tripleThreatPeriod !== periodOneBased) {
            shooter.tripleThreatPeriod = periodOneBased;
            shooter.tripleThreatZones = 0;
          }
          if (!made) {
            shooter.tripleThreatZones = 0;
          } else if (shotClass >= 0 && (shooter.tripleThreatZones & (1 << shotClass)) === 0) {
            if (tripleThreatCompletes) {
              shooter.tripleThreatZones = 0;
              this.bumpTrigger(shooter, 'triple-threat');
            } else {
              shooter.tripleThreatZones |= 1 << shotClass;
            }
          }
        }
      },

      onFreeThrow: ({ side, shooter: shooterSim, made }) => {
        const shooter = this.participantOf(shooterSim, side);
        if (shooter === undefined) return;
        const charity = shooter.active && shooter.mutations.has('charity-casino');
        const doubleOwners = this.activeOwners(side, 'double-or-nothing');
        if (made) {
          if (charity) {
            this.bumpTrigger(shooter, 'charity-casino');
            this.addPlayerPoints(shooter, 2, 'charity-casino');
          }
        } else {
          if (doubleOwners[0] !== undefined) {
            this.addTeamBonusPoints(
              (1 - side) as SideIndex,
              doubleOwners[0],
              HAVOC_DOUBLE_MISS_GIFT,
              'double-or-nothing',
            );
          }
          if (charity) {
            this.bumpTrigger(shooter, 'charity-casino');
            this.addTeamBonusPoints((1 - side) as SideIndex, shooter, 2, 'charity-casino');
          }
        }
      },

      onAssist: (offense, assisterSim) => {
        const assister = this.participantOf(assisterSim, offense);
        if (assister === undefined || !assister.mutations.has('golden-assist')) return;
        assister.assistCount += 1;
        if (assister.assistCount % HAVOC_GOLDEN_ASSIST_EVERY !== 0) return;
        this.bumpTrigger(assister, 'golden-assist');
        this.addPlayerPoints(assister, 1, 'golden-assist');
      },

      onRebound: (side, rebounderSim, offensive) => {
        if (!offensive) return;
        const rebounder = this.participantOf(rebounderSim, side);
        if (rebounder === undefined) return;
        if (rebounder.mutations.has('rebound-loop')) {
          rebounder.reboundLoopCount += 1;
          if (rebounder.reboundLoopCount % HAVOC_REBOUND_LOOP_EVERY === 0) {
            const counters = rebounder.rollups.get('rebound-loop');
            if (counters !== undefined) {
              counters.triggers += 1;
              counters.extraPossessionsEarned += 1;
            }
            this.extraQueue[side].push(rebounder.recorderIndex);
          }
        }
        if (rebounder.mutations.has('second-chance-jackpot')) {
          rebounder.putbackArmedAt = this.possessionId;
        }
      },

      onBlock: (defense, blockerSim, shooterSim) => {
        const blocker = this.participantOf(blockerSim, defense);
        const shooter = this.participantOf(shooterSim, (1 - defense) as SideIndex);
        if (
          blocker === undefined ||
          shooter === undefined ||
          !blocker.mutations.has('the-bounty') ||
          blocker.bountyArmed
        ) {
          return;
        }
        if (shooter.recorderIndex === this.bountyTarget[defense]) {
          blocker.bountyArmed = true;
          blocker.bountyArmedAt = this.possessionId;
          this.bumpTrigger(blocker, 'the-bounty');
        }
      },
    };
  }
}

function popcount(mask: number): number {
  let count = 0;
  let value = mask;
  while (value > 0) {
    count += value & 1;
    value >>= 1;
  }
  return count;
}

function ratingsEqual(
  left: SimulationPlayer['ratings'],
  right: SimulationPlayer['ratings'],
): boolean {
  for (const key of REQUIRED_RATING_KEYS) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

function tendenciesEqual(
  left: SimulationPlayer['tendencies'],
  right: SimulationPlayer['tendencies'],
): boolean {
  for (const key of HAVOC_TENDENCY_FIELDS) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

function setsEqual(
  evidence: HavocEvidence,
  channels: ReadonlySet<HavocAuthoritativeChannel>,
): boolean {
  for (const channel of ALL_AUTHORITATIVE_CHANNELS) {
    if (evidence.isAuthoritative(channel) !== channels.has(channel)) return false;
  }
  return true;
}
