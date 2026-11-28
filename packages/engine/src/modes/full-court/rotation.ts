import type { FullCourtCoachingRule, SimulationPlayer } from '@hoop-rush/data-contracts';
import { LINEUP_STRUCTURE } from '@hoop-rush/data-contracts';
import { clamp } from '../../domain/math.ts';
import { canPlay } from '../../domain/positions.ts';
import { slotRequirement } from '../../domain/lineup.ts';

export const FULL_COURT_ROTATION_VERSION = 'full-court-rotation-v2';

export const FULL_COURT_MIN_ROSTER = 5;
export const FULL_COURT_MAX_ROSTER = 12;
export const FULL_COURT_FOUL_LIMIT = 6;

/** Live game seconds in regulation; five players make 240 player-minutes. */
export const FULL_COURT_REGULATION_SECONDS = 48 * 60;
export const FULL_COURT_REGULATION_TEAM_SECONDS = 240 * 60;
export const FULL_COURT_MAX_PLAYER_MINUTES = 48;
export const FULL_COURT_MAX_PLAYER_SECONDS = FULL_COURT_MAX_PLAYER_MINUTES * 60;
export const FULL_COURT_OVERTIME_PLAYER_SECONDS = 5 * 60;

/** Rating penalty reaches its full value at this many fatigue steps. */
export const FULL_COURT_FATIGUE_STEPS = 6;
export const FULL_COURT_PERIOD_BREAK_RECOVERY = 0.02;
export const FULL_COURT_HALFTIME_RECOVERY = 0.08;

/** Seconds of neutral live play that spend a full energy bar at capacity 1. */
export const FULL_COURT_STAMINA_SECONDS = 48 * 60;
/** Seconds of bench time that restore a full energy bar. */
export const FULL_COURT_BENCH_RECOVERY_SECONDS = 30 * 60;

/** A player below this energy must come off when a replacement exists. */
export const FULL_COURT_SEVERE_FATIGUE_ENERGY = 0.18;
/** A player below this energy is swapped for a materially fresher reserve. */
export const FULL_COURT_TIRED_ENERGY = 0.32;
export const FULL_COURT_FATIGUE_SWAP_GAIN = 0.25;

export const FULL_COURT_CLOSING_WINDOW_SECONDS = 180;
export const FULL_COURT_CLOSING_MARGIN = 8;
export const FULL_COURT_CLOSING_MIN_ENERGY = FULL_COURT_TIRED_ENERGY;

export const FULL_COURT_PACE_DEVIATION_SECONDS = 150;
export const FULL_COURT_PACE_REPLACEMENT_SECONDS = 60;
export const FULL_COURT_PACE_MIN_RESERVE_ENERGY = 0.35;
export const FULL_COURT_MIN_STINT_SECONDS = 90;
/** A foul-trouble rule waits this long before it may replace the same player again. */
export const FULL_COURT_RULE_COOLDOWN_SECONDS = 180;

const NEUTRAL_MINUTES_PER_GAME = 24;
const MIN_CAPACITY_SCALE = 0.55;
const MAX_CAPACITY_SCALE = 1.25;
const CAPACITY_MINUTES_FLOOR = 12;
const CAPACITY_MINUTES_SPAN = 26;
const WORKLOAD_REFERENCE_MINUTES = 36;
const WORKLOAD_EVIDENCE_GAMES = 30;
/** Catalog stamina ratings are validated into 45..95. */
const CATALOG_STAMINA_FLOOR = 45;
const CATALOG_STAMINA_SPAN = 50;

export type FullCourtSetupErrorCode =
  | 'roster-size'
  | 'duplicate-player'
  | 'unknown-player'
  | 'insufficient-available'
  | 'invalid-target'
  | 'invalid-lineup';

export class FullCourtSetupError extends Error {
  readonly code: FullCourtSetupErrorCode;

  constructor(code: FullCourtSetupErrorCode, message: string) {
    super(message);
    this.name = 'FullCourtSetupError';
    this.code = code;
  }
}

export type FullCourtAvailabilityReason = 'injury' | 'rest' | 'suspension' | 'other';

/** Pregame availability, starting energy, and stamina supplied by health systems. */
export interface FullCourtAvailabilityEntry {
  readonly playerId: string;
  readonly available: boolean;
  readonly reason?: FullCourtAvailabilityReason;
  /** Starting energy in 0..1; defaults to 1. */
  readonly energy?: number;
  /** Catalog stamina rating in 45..95, from the derived health profile. */
  readonly staminaRating?: number;
  /** Direct 0..1 stamina index; overrides `staminaRating`. */
  readonly stamina?: number;
}

export interface FullCourtRotationUnitInput {
  readonly name: string;
  readonly playerIds: readonly string[];
}

export interface FullCourtRotationPlanInput {
  readonly startingFive?: readonly string[];
  /** Regulation minute targets by player id; omitted players default to zero. */
  readonly minuteTargets?: Readonly<Record<string, number>>;
  readonly substitutionPriority?: Readonly<Record<string, number>>;
  readonly closingFive?: readonly string[];
  readonly units?: readonly FullCourtRotationUnitInput[];
  readonly rules?: readonly FullCourtCoachingRule[];
  /** Keep one assigned primary or secondary scorer on the floor when viable. */
  readonly staggerStars?: boolean;
}

/** Optional scorer coverage derived from the user's saved offensive hierarchy. */
export interface FullCourtStaggeringInput {
  /** Primary and secondary option player ids, in that order. */
  readonly scorerPlayerIds: readonly string[];
}

export type FullCourtRulePlan =
  | {
      readonly ruleId: string;
      readonly kind: 'closing-lineup';
      readonly secondsRemainingMax: number;
      readonly scoreMarginMax: number;
      readonly lineup: readonly number[];
    }
  | {
      readonly ruleId: string;
      readonly kind: 'foul-trouble';
      readonly playerIndex: number;
      readonly foulLimit: number;
      readonly replacementIndex: number | null;
    };

/**
 * Per-game rule memory. Closing rules activate once; foul-trouble rules cool
 * down after firing. `boundarySeconds` keeps lower-priority rules from reacting
 * to the same decision window the winning rule already handled.
 */
export interface FullCourtRuleRuntimeState {
  readonly activated: boolean[];
  readonly cooldownsUntil: number[];
  boundarySeconds: number;
  boundaryRuleIndex: number;
}

export type FullCourtPlanNoteCode =
  | 'auto-rotation'
  | 'auto-starters'
  | 'targets-scaled'
  | 'starter-unavailable'
  | 'closing-unavailable';

export interface FullCourtPlanNote {
  readonly code: FullCourtPlanNoteCode;
  readonly playerId: string | null;
}

export interface FullCourtRotationUnit {
  readonly name: string;
  /** Roster indices in tactical slot order. */
  readonly rosterIndices: readonly number[];
}

export type FullCourtStaminaSource =
  'override' | 'historical-workload' | 'catalog-rating' | 'prior';

/**
 * Stamina can arrive as the catalog's 45..95 rating (Phase 1 health data), a 0..1
 * index, or nothing at all. The catalog rating is preferred because it was derived
 * offline from historical workloads and shrunk for sample size.
 */
export interface FullCourtStaminaInput {
  /** Catalog stamina rating in 45..95. */
  readonly rating?: number;
  /** Direct 0..1 stamina index; takes precedence over `rating`. */
  readonly stamina?: number;
}

export interface FullCourtStaminaProfile {
  /** Multiplier on the neutral stamina bar; a higher value lasts longer. */
  readonly capacityScale: number;
  readonly exertionPerSecond: number;
  readonly source: FullCourtStaminaSource;
}

export interface FullCourtRotationPlan {
  readonly roster: readonly SimulationPlayer[];
  /** Keys the possession kernel uses for per-player foul tracking. */
  readonly playerKeys: readonly string[];
  readonly available: readonly boolean[];
  readonly startingEnergy: readonly number[];
  readonly stamina: readonly FullCourtStaminaProfile[];
  /** Seconds requested by the caller before normalization to 240 team minutes. */
  readonly requestedSeconds: readonly number[];
  /** Seconds allocated so the plan sums to 240 regulation team minutes. */
  readonly targetSeconds: readonly number[];
  readonly priorities: readonly number[];
  readonly startingSlots: readonly number[];
  readonly closingSlots: readonly number[];
  readonly units: readonly FullCourtRotationUnit[];
  readonly rules: readonly FullCourtRulePlan[];
  /** Whether automatic decisions must preserve one assigned scorer on the floor. */
  readonly staggerStars: boolean;
  /** Roster indices for the primary and secondary hierarchy scorers. */
  readonly scorerIndices: readonly number[];
  readonly notes: readonly FullCourtPlanNote[];
}

function capacityScaleOf(minutesPerGame: number): number {
  const perMinute = (MAX_CAPACITY_SCALE - MIN_CAPACITY_SCALE) / CAPACITY_MINUTES_SPAN;
  return clamp(
    MIN_CAPACITY_SCALE + (minutesPerGame - CAPACITY_MINUTES_FLOOR) * perMinute,
    MIN_CAPACITY_SCALE,
    MAX_CAPACITY_SCALE,
  );
}

/**
 * Stamina comes from the catalog's derived 45..95 rating when available, otherwise
 * from historical minutes per game shrunk toward a neutral prior. A player with
 * neither uses the prior.
 */
export function staminaProfileOf(
  player: SimulationPlayer,
  input?: FullCourtStaminaInput | number,
): FullCourtStaminaProfile {
  const usage = Math.min(40, Math.max(0, player.tendencies.usageRate));
  const exertionPerSecond = 0.9 + (usage / 40) * 0.3;
  const options: FullCourtStaminaInput | undefined =
    typeof input === 'number' ? { stamina: input } : input;
  const direct = options?.stamina;
  if (direct !== undefined) {
    return {
      capacityScale:
        MIN_CAPACITY_SCALE + clamp(direct, 0, 1) * (MAX_CAPACITY_SCALE - MIN_CAPACITY_SCALE),
      exertionPerSecond,
      source: 'override',
    };
  }
  const rating = options?.rating;
  if (rating !== undefined && Number.isFinite(rating)) {
    const index = clamp((rating - CATALOG_STAMINA_FLOOR) / CATALOG_STAMINA_SPAN, 0, 1);
    return {
      capacityScale: MIN_CAPACITY_SCALE + index * (MAX_CAPACITY_SCALE - MIN_CAPACITY_SCALE),
      exertionPerSecond,
      source: 'catalog-rating',
    };
  }
  const anchors = player.anchors;
  if (anchors === undefined) {
    return {
      capacityScale: capacityScaleOf(NEUTRAL_MINUTES_PER_GAME),
      exertionPerSecond,
      source: 'prior',
    };
  }
  const confidence = clamp(anchors.gamesPlayed / WORKLOAD_EVIDENCE_GAMES, 0, 1);
  const minutes = anchors.minutesPerGame * confidence + NEUTRAL_MINUTES_PER_GAME * (1 - confidence);
  return {
    capacityScale: capacityScaleOf(minutes),
    exertionPerSecond,
    source: 'historical-workload',
  };
}

export function drainedEnergy(
  energy: number,
  profile: FullCourtStaminaProfile,
  liveSeconds: number,
): number {
  const bar = FULL_COURT_STAMINA_SECONDS * profile.capacityScale;
  const cost = (liveSeconds * profile.exertionPerSecond) / bar;
  return clamp(energy - cost, 0, 1);
}

export function recoveredEnergy(energy: number, benchSeconds: number): number {
  return clamp(energy + benchSeconds / FULL_COURT_BENCH_RECOVERY_SECONDS, 0, 1);
}

export function fatigueLevelOf(energy: number): number {
  return Math.min(
    FULL_COURT_FATIGUE_STEPS,
    Math.max(0, Math.floor((1 - clamp(energy, 0, 1)) * FULL_COURT_FATIGUE_STEPS + 1e-9)),
  );
}

/** Quadratic so early minutes barely register and long stints bite. */
export function fatiguePenaltyOf(level: number): number {
  const fraction = clamp(level, 0, FULL_COURT_FATIGUE_STEPS) / FULL_COURT_FATIGUE_STEPS;
  return fraction * fraction;
}

type RatingKey = keyof SimulationPlayer['ratings'];

/**
 * Rating loss at full fatigue, applied to the same ratings the shared possession
 * equations read. Bounded so a tired player is clearly worse, never useless.
 */
const FATIGUE_RATING_DROP: Readonly<Record<string, number>> = {
  insideScoring: 18,
  closeShot: 18,
  midrange: 17,
  threePoint: 16,
  freeThrow: 10,
  ballHandling: 20,
  passing: 16,
  offensiveIq: 8,
  defensiveIq: 16,
  perimeterDefense: 18,
  interiorDefense: 16,
  steal: 14,
  block: 14,
  offensiveRebound: 10,
  defensiveRebound: 10,
  speed: 13,
};

/**
 * Within-game fatigue expressed through ratings the shared possession equations
 * already read. Identity is preserved so foul tracking and recorder slots stay
 * stable while the lineup changes.
 */
export function fatiguedPlayer(
  player: SimulationPlayer,
  level: number,
  cache?: Map<number, SimulationPlayer>,
): SimulationPlayer {
  const clamped = Math.min(FULL_COURT_FATIGUE_STEPS, Math.max(0, Math.round(level)));
  if (clamped === 0) return player;
  const cached = cache?.get(clamped);
  if (cached !== undefined) return cached;
  const penalty = fatiguePenaltyOf(clamped);
  const ratings = { ...player.ratings };
  for (const key of Object.keys(ratings) as RatingKey[]) {
    const drop = FATIGUE_RATING_DROP[key];
    if (drop === undefined) continue;
    ratings[key] = clamp(Math.round(player.ratings[key] - drop * penalty), 0, 100);
  }
  const result: SimulationPlayer = { ...player, ratings };
  cache?.set(clamped, result);
  return result;
}

function playerValue(player: SimulationPlayer): number {
  const overall = player.overall ?? player.ratingProfile?.canonicalOverall;
  if (overall !== undefined) return clamp(overall / 100, 0, 1);
  const r = player.ratings;
  const blend =
    r.insideScoring * 0.2 +
    r.threePoint * 0.15 +
    r.ballHandling * 0.1 +
    r.passing * 0.1 +
    r.perimeterDefense * 0.15 +
    r.interiorDefense * 0.1 +
    r.defensiveIq * 0.05 +
    r.offensiveRebound * 0.075 +
    r.defensiveRebound * 0.075;
  return clamp(blend / 100, 0, 1);
}

function workloadOf(player: SimulationPlayer): number {
  if (player.anchors === undefined) return NEUTRAL_MINUTES_PER_GAME / WORKLOAD_REFERENCE_MINUTES;
  const confidence = clamp(player.anchors.gamesPlayed / WORKLOAD_EVIDENCE_GAMES, 0, 1);
  const minutes =
    player.anchors.minutesPerGame * confidence + NEUTRAL_MINUTES_PER_GAME * (1 - confidence);
  return clamp(minutes / WORKLOAD_REFERENCE_MINUTES, 0, 1);
}

/** Deterministic proportional allocation with a per-player cap that sums exactly. */
export function allocateSeconds(weights: readonly number[], total: number, cap: number): number[] {
  const result: number[] = weights.map(() => 0);
  const active = weights
    .map((weight, index) => (weight > 0 ? index : -1))
    .filter((index) => index >= 0);
  if (total > cap * active.length) {
    throw new FullCourtSetupError(
      'invalid-target',
      'minute targets exceed the active players’ capacity',
    );
  }
  let remaining = total;
  for (let pass = 0; pass < 8 && remaining > 0; pass += 1) {
    const pool = active.filter((index) => (result[index] ?? 0) < cap);
    if (pool.length === 0) break;
    const weightTotal = pool.reduce((sum, index) => sum + (weights[index] ?? 0), 0);
    let assigned = 0;
    for (const index of pool) {
      const share = Math.floor((remaining * (weights[index] ?? 0)) / weightTotal);
      const give = Math.min(share, cap - (result[index] ?? 0));
      if (give <= 0) continue;
      result[index] = (result[index] ?? 0) + give;
      assigned += give;
    }
    remaining -= assigned;
    if (assigned === 0) break;
  }
  while (remaining > 0) {
    let best = -1;
    for (const index of active) {
      if ((result[index] ?? 0) >= cap) continue;
      if (best === -1 || (weights[index] ?? 0) > (weights[best] ?? 0)) best = index;
    }
    if (best === -1) break;
    result[best] = (result[best] ?? 0) + 1;
    remaining -= 1;
  }
  return result;
}

function isBetterCandidate(
  weights: readonly number[],
  current: number,
  candidate: number,
): boolean {
  const a = weights[current] ?? 0;
  const b = weights[candidate] ?? 0;
  if (b !== a) return b > a;
  return candidate < current;
}

function pickForSlot(
  roster: readonly SimulationPlayer[],
  weights: readonly number[],
  available: readonly boolean[],
  used: ReadonlySet<number>,
  slot: number,
  reserved: ReadonlySet<number> = new Set<number>(),
): number | null {
  const requirement = slotRequirement(slot);
  const eligible: number[] = [];
  const fallback: number[] = [];
  for (let index = 0; index < roster.length; index += 1) {
    const player = roster[index];
    if (player === undefined || available[index] !== true) continue;
    if (used.has(index) || reserved.has(index)) continue;
    fallback.push(index);
    if (canPlay(player.positions, requirement)) eligible.push(index);
  }
  const candidates = eligible.length > 0 ? eligible : fallback;
  if (candidates.length === 0) return null;
  return candidates.reduce((current, index) =>
    isBetterCandidate(weights, current, index) ? index : current,
  );
}

function autoFive(
  roster: readonly SimulationPlayer[],
  weights: readonly number[],
  available: readonly boolean[],
): number[] {
  type Assignment = { slots: number[]; fits: number; value: number };
  const complete = (1 << LINEUP_STRUCTURE.length) - 1;
  const assignments: (Assignment | undefined)[] = [{ slots: [], fits: 0, value: 0 }];
  for (const [index, player] of roster.entries()) {
    if (available[index] !== true) continue;
    for (let mask = complete - 1; mask >= 0; mask -= 1) {
      const current = assignments[mask];
      if (current === undefined) continue;
      for (const [slot, position] of LINEUP_STRUCTURE.entries()) {
        const bit = 1 << slot;
        if ((mask & bit) !== 0) continue;
        const next = mask | bit;
        const fits = current.fits + Number(canPlay(player.positions, position));
        const value = current.value + (weights[index] ?? 0);
        const previous = assignments[next];
        if (
          previous !== undefined &&
          (previous.fits > fits || (previous.fits === fits && previous.value >= value))
        )
          continue;
        const slots = [...current.slots];
        slots[slot] = index;
        assignments[next] = { slots, fits, value };
      }
    }
  }
  const best = assignments[complete];
  if (best === undefined) return [];
  const greedy: number[] = [];
  const used = new Set<number>();
  for (const slot of LINEUP_STRUCTURE.keys()) {
    const index = pickForSlot(roster, weights, available, used, slot);
    if (index === null) return best.slots;
    greedy.push(index);
    used.add(index);
  }
  const greedyFits = greedy.filter((index, slot) => {
    const player = roster[index];
    return player !== undefined && canPlay(player.positions, slotRequirement(slot));
  }).length;
  const greedyValue = greedy.reduce((sum, index) => sum + (weights[index] ?? 0), 0);
  return greedyFits === best.fits && greedyValue >= best.value - 1e-10 ? greedy : best.slots;
}

function topByPriority(available: readonly boolean[], priorities: readonly number[]): number[] {
  const candidates: number[] = [];
  for (let index = 0; index < priorities.length; index += 1) {
    if (available[index] === true) candidates.push(index);
  }
  candidates.sort((a, b) => {
    const pa = priorities[a] ?? 0;
    const pb = priorities[b] ?? 0;
    if (pa !== pb) return pb - pa;
    return a - b;
  });
  return candidates.slice(0, FULL_COURT_MIN_ROSTER);
}

function requireRoster(roster: readonly SimulationPlayer[]): ReadonlyMap<string, number> {
  if (roster.length < FULL_COURT_MIN_ROSTER || roster.length > FULL_COURT_MAX_ROSTER) {
    throw new FullCourtSetupError(
      'roster-size',
      `full court roster must hold ${String(FULL_COURT_MIN_ROSTER)}..${String(FULL_COURT_MAX_ROSTER)} players, got ${String(roster.length)}`,
    );
  }
  const indexById = new Map<string, number>();
  roster.forEach((player, index) => {
    if (indexById.has(player.playerId)) {
      throw new FullCourtSetupError(
        'duplicate-player',
        `full court roster repeats player ${player.playerId}`,
      );
    }
    indexById.set(player.playerId, index);
  });
  return indexById;
}

export function resolveRotationPlan(
  roster: readonly SimulationPlayer[],
  input: FullCourtRotationPlanInput = {},
  availability: readonly FullCourtAvailabilityEntry[] = [],
  staggering?: FullCourtStaggeringInput,
): FullCourtRotationPlan {
  const indexById = requireRoster(roster);
  const availabilityById = new Map<string, FullCourtAvailabilityEntry>();
  for (const entry of availability) {
    if (!indexById.has(entry.playerId)) {
      throw new FullCourtSetupError(
        'unknown-player',
        `availability names ${entry.playerId}, which is not on the roster`,
      );
    }
    availabilityById.set(entry.playerId, entry);
  }
  const available = roster.map(
    (player) => availabilityById.get(player.playerId)?.available ?? true,
  );
  const availableCount = available.filter((value) => value).length;
  if (availableCount < FULL_COURT_MIN_ROSTER) {
    throw new FullCourtSetupError(
      'insufficient-available',
      `full court needs ${String(FULL_COURT_MIN_ROSTER)} available players, got ${String(availableCount)}`,
    );
  }

  const scorerIndices: number[] = [];
  const seenScorers = new Set<number>();
  for (const playerId of staggering?.scorerPlayerIds ?? []) {
    const index = indexById.get(playerId);
    if (index === undefined || seenScorers.has(index)) continue;
    seenScorers.add(index);
    scorerIndices.push(index);
  }
  const staggerStars = input.staggerStars === true;

  const notes: FullCourtPlanNote[] = [];
  const startingEnergy = roster.map((player) =>
    clamp(availabilityById.get(player.playerId)?.energy ?? 1, 0, 1),
  );
  const stamina = roster.map((player) => {
    const entry = availabilityById.get(player.playerId);
    return staminaProfileOf(player, {
      ...(entry?.staminaRating === undefined ? {} : { rating: entry.staminaRating }),
      ...(entry?.stamina === undefined ? {} : { stamina: entry.stamina }),
    });
  });
  const weights = roster.map((player, index) =>
    available[index] === true
      ? Math.max(0.6 * playerValue(player) + 0.4 * workloadOf(player), 1e-6)
      : 0,
  );
  const priorities =
    input.substitutionPriority === undefined
      ? weights.map((weight) => weight)
      : roster.map((player) => {
          const value = input.substitutionPriority?.[player.playerId] ?? 0;
          if (!Number.isFinite(value)) {
            throw new FullCourtSetupError(
              'invalid-lineup',
              `substitution priority for ${player.playerId} must be finite`,
            );
          }
          return value;
        });

  const readyWeights = weights.map((weight, index) => {
    const profile = stamina[index];
    if (profile?.source !== 'catalog-rating' && profile?.source !== 'override') return weight;
    const fatigue = 1 - (startingEnergy[index] ?? 1);
    return weight * (1 - (0.5 * fatigue) / profile.capacityScale);
  });
  const minuteWeights = roster.map((player, index) => {
    const role = clamp(
      (workloadOf(player) * WORKLOAD_REFERENCE_MINUTES) / NEUTRAL_MINUTES_PER_GAME,
      1e-6,
      1,
    );
    return (readyWeights[index] ?? 0) * role;
  });
  let requestedSeconds: number[];
  let targetSeconds: number[];
  if (input.minuteTargets === undefined) {
    notes.push({ code: 'auto-rotation', playerId: null });
    requestedSeconds = weights.map(() => 0);
    targetSeconds = allocateSeconds(
      minuteWeights,
      FULL_COURT_REGULATION_TEAM_SECONDS,
      FULL_COURT_MAX_PLAYER_SECONDS,
    );
  } else {
    requestedSeconds = roster.map((player) => {
      const minutes = input.minuteTargets?.[player.playerId] ?? 0;
      if (!Number.isFinite(minutes) || minutes < 0 || minutes > FULL_COURT_MAX_PLAYER_MINUTES) {
        throw new FullCourtSetupError(
          'invalid-target',
          `minute target for ${player.playerId} must be in 0..${String(FULL_COURT_MAX_PLAYER_MINUTES)}, got ${String(minutes)}`,
        );
      }
      return Math.round(minutes * 60);
    });
    const availableRequested = requestedSeconds.reduce(
      (sum, value, index) => sum + (available[index] === true ? value : 0),
      0,
    );
    const unavailableRequested = requestedSeconds.some(
      (value, index) => available[index] !== true && value > 0,
    );
    if (availableRequested <= 0) {
      notes.push({ code: 'auto-rotation', playerId: null });
      targetSeconds = allocateSeconds(
        minuteWeights,
        FULL_COURT_REGULATION_TEAM_SECONDS,
        FULL_COURT_MAX_PLAYER_SECONDS,
      );
    } else if (availableRequested !== FULL_COURT_REGULATION_TEAM_SECONDS || unavailableRequested) {
      const availableTargets = requestedSeconds.map((value, index) =>
        available[index] === true ? value : 0,
      );
      const requestedCapacity =
        availableTargets.filter((seconds) => seconds > 0).length * FULL_COURT_MAX_PLAYER_SECONDS;
      const allocated = Math.min(requestedCapacity, FULL_COURT_REGULATION_TEAM_SECONDS);
      targetSeconds = allocateSeconds(availableTargets, allocated, FULL_COURT_MAX_PLAYER_SECONDS);
      const reserveSeconds = allocateSeconds(
        minuteWeights.map((weight, index) => (availableTargets[index] === 0 ? weight : 0)),
        FULL_COURT_REGULATION_TEAM_SECONDS - allocated,
        FULL_COURT_MAX_PLAYER_SECONDS,
      );
      targetSeconds = targetSeconds.map((seconds, index) => seconds + (reserveSeconds[index] ?? 0));
      notes.push({ code: 'targets-scaled', playerId: null });
    } else {
      targetSeconds = requestedSeconds;
    }
  }

  let startingSlots: number[];
  const requestedFive = input.startingFive;
  if (requestedFive === undefined) {
    startingSlots = autoFive(roster, readyWeights, available);
    if (startingSlots.length < FULL_COURT_MIN_ROSTER) {
      throw new FullCourtSetupError(
        'insufficient-available',
        'full court cannot field a legal starting five',
      );
    }
    notes.push({ code: 'auto-starters', playerId: null });
  } else {
    if (requestedFive.length !== FULL_COURT_MIN_ROSTER) {
      throw new FullCourtSetupError(
        'invalid-lineup',
        `starting five must name ${String(FULL_COURT_MIN_ROSTER)} players, got ${String(requestedFive.length)}`,
      );
    }
    if (new Set(requestedFive).size !== requestedFive.length) {
      throw new FullCourtSetupError('invalid-lineup', 'starting five repeats a player');
    }
    const reserved = new Set<number>();
    for (const id of requestedFive) {
      const index = indexById.get(id);
      if (index === undefined) {
        throw new FullCourtSetupError(
          'unknown-player',
          `starting five names ${id}, which is not on the roster`,
        );
      }
      if (available[index] === true) reserved.add(index);
    }
    const used = new Set<number>();
    const slots: number[] = [];
    for (const [slot, id] of requestedFive.entries()) {
      const index = indexById.get(id);
      if (index === undefined) {
        throw new FullCourtSetupError(
          'unknown-player',
          `starting five names ${id}, which is not on the roster`,
        );
      }
      if (available[index] === true && !used.has(index)) {
        slots.push(index);
        used.add(index);
        continue;
      }
      notes.push({ code: 'starter-unavailable', playerId: id });
      const filler = pickForSlot(roster, readyWeights, available, used, slot, reserved);
      if (filler === null) {
        throw new FullCourtSetupError(
          'insufficient-available',
          'starting five cannot be filled from available players',
        );
      }
      slots.push(filler);
      used.add(filler);
    }
    startingSlots = slots;
  }

  let closingSlots: number[];
  const requestedClosing = input.closingFive;
  if (requestedClosing === undefined || requestedClosing.length === 0) {
    closingSlots = topByPriority(available, priorities);
  } else {
    closingSlots = [];
    for (const id of requestedClosing.slice(0, FULL_COURT_MIN_ROSTER)) {
      const index = indexById.get(id);
      if (index === undefined) {
        throw new FullCourtSetupError(
          'unknown-player',
          `closing five names ${id}, which is not on the roster`,
        );
      }
      if (available[index] !== true || closingSlots.includes(index)) {
        notes.push({ code: 'closing-unavailable', playerId: id });
        continue;
      }
      closingSlots.push(index);
    }
    for (const candidate of topByPriority(available, priorities)) {
      if (closingSlots.length >= FULL_COURT_MIN_ROSTER) break;
      if (!closingSlots.includes(candidate)) closingSlots.push(candidate);
    }
  }

  const units: FullCourtRotationUnit[] = [];
  const unitNames = new Set<string>();
  for (const unit of input.units ?? []) {
    if (unit.playerIds.length !== FULL_COURT_MIN_ROSTER) {
      throw new FullCourtSetupError(
        'invalid-lineup',
        `unit ${unit.name} must name ${String(FULL_COURT_MIN_ROSTER)} players`,
      );
    }
    const unitName = unit.name.trim().normalize();
    const unitNameKey = unitName.toLowerCase();
    if (unitName.length === 0) {
      throw new FullCourtSetupError('invalid-lineup', 'named unit needs a name');
    }
    if (unitNames.has(unitNameKey)) {
      throw new FullCourtSetupError('invalid-lineup', `named unit ${unitName} is repeated`);
    }
    unitNames.add(unitNameKey);
    const rosterIndices = unit.playerIds.map((id) => {
      const index = indexById.get(id);
      if (index === undefined) {
        throw new FullCourtSetupError(
          'unknown-player',
          `unit ${unit.name} names ${id}, which is not on the roster`,
        );
      }
      return index;
    });
    if (new Set(rosterIndices).size !== rosterIndices.length) {
      throw new FullCourtSetupError('invalid-lineup', `unit ${unit.name} repeats a player`);
    }
    units.push({ name: unitName, rosterIndices });
  }

  const rules: FullCourtRulePlan[] = [];
  const ruleIds = new Set<string>();
  for (const rule of input.rules ?? []) {
    if (ruleIds.has(rule.ruleId)) {
      throw new FullCourtSetupError('invalid-lineup', `coaching rule ${rule.ruleId} is repeated`);
    }
    ruleIds.add(rule.ruleId);
    if (rule.kind === 'closing-lineup') {
      if (new Set(rule.lineup).size !== rule.lineup.length) {
        throw new FullCourtSetupError(
          'invalid-lineup',
          `coaching rule ${rule.ruleId} repeats a player`,
        );
      }
      rules.push({
        ruleId: rule.ruleId,
        kind: rule.kind,
        secondsRemainingMax: rule.secondsRemainingMax,
        scoreMarginMax: rule.scoreMarginMax,
        lineup: rule.lineup.map((id) => requireRulePlayer(indexById, rule.ruleId, id)),
      });
      continue;
    }
    const playerIndex = requireRulePlayer(indexById, rule.ruleId, rule.playerId);
    const replacementIndex =
      rule.replacementPlayerId === undefined
        ? null
        : requireRulePlayer(indexById, rule.ruleId, rule.replacementPlayerId);
    if (replacementIndex === playerIndex) {
      throw new FullCourtSetupError(
        'invalid-lineup',
        `coaching rule ${rule.ruleId} names the same replacement as its player`,
      );
    }
    rules.push({
      ruleId: rule.ruleId,
      kind: rule.kind,
      playerIndex,
      foulLimit: rule.foulLimit,
      replacementIndex,
    });
  }

  return {
    roster,
    playerKeys: roster.map((player) => player.playerVersionId ?? player.playerId),
    available,
    startingEnergy,
    stamina,
    requestedSeconds,
    targetSeconds,
    priorities,
    startingSlots,
    closingSlots,
    units,
    rules,
    staggerStars,
    scorerIndices,
    notes,
  };
}

function requireRulePlayer(
  indexById: ReadonlyMap<string, number>,
  ruleId: string,
  playerId: string,
): number {
  const index = indexById.get(playerId);
  if (index === undefined) {
    throw new FullCourtSetupError(
      'unknown-player',
      `coaching rule ${ruleId} names ${playerId}, which is not on the roster`,
    );
  }
  return index;
}

function unitNameForSlots(
  units: readonly FullCourtRotationUnit[],
  slots: readonly number[],
): string | null {
  for (const unit of units) {
    const unitSet = new Set(unit.rosterIndices);
    if (slots.length !== unitSet.size) continue;
    if (slots.every((index) => unitSet.has(index))) return unit.name;
  }
  return null;
}

export function unitNameFor(plan: FullCourtRotationPlan, slots: readonly number[]): string | null {
  return unitNameForSlots(plan.units, slots);
}

/**
 * Presentation helper for recorded fives: maps player ids back to roster order
 * and reuses the same membership rule as the resolved plan.
 */
export function unitNameForPlayerIds(
  units: readonly FullCourtRotationUnit[],
  rosterPlayerIds: readonly string[],
  playerIds: readonly string[],
): string | null {
  const indexById = new Map(rosterPlayerIds.map((playerId, index) => [playerId, index]));
  const slots: number[] = [];
  const seen = new Set<number>();
  for (const playerId of playerIds) {
    const index = indexById.get(playerId);
    if (index === undefined || seen.has(index)) return null;
    seen.add(index);
    slots.push(index);
  }
  return unitNameForSlots(units, slots);
}

export type FullCourtSubstitutionReason =
  | 'foul-out'
  | 'fatigue'
  | 'minute-target'
  | 'closing-five'
  | 'coach-rule'
  | 'emergency-continuation';

export interface FullCourtRotationSnapshot {
  readonly plan: FullCourtRotationPlan;
  /** Roster indices currently on the floor, in tactical slot order. */
  readonly slots: readonly number[];
  readonly energies: readonly number[];
  readonly fouls: readonly number[];
  /** Players already re-entered after disqualification. */
  readonly emergency: readonly boolean[];
  readonly playedSeconds: readonly number[];
  /** Seconds the current occupant of each slot has been on the floor. */
  readonly stintSeconds: readonly number[];
}

export interface FullCourtRotationContext {
  /** Live seconds played so far in the game. */
  readonly globalSeconds: number;
  /** Zero-based period index; 4 and above are overtime. */
  readonly period: number;
  readonly periodSecondsRemaining: number;
  /** Absolute score difference at the moment of evaluation. */
  readonly scoreMargin: number;
  /** Conditional rules only run at dead-ball or period-break windows. */
  readonly legalWindow?: boolean;
}

export type FullCourtSubstitutionDecision =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'swap';
      readonly slot: number;
      readonly outIndex: number;
      readonly inIndex: number;
      readonly reason: FullCourtSubstitutionReason;
    }
  | { readonly kind: 'emergency'; readonly playerIndex: number };

export function isClosingWindow(context: FullCourtRotationContext): boolean {
  if (context.period >= 4) return true;
  return (
    context.period === 3 &&
    context.periodSecondsRemaining <= FULL_COURT_CLOSING_WINDOW_SECONDS &&
    context.scoreMargin <= FULL_COURT_CLOSING_MARGIN
  );
}

function benchCandidates(snapshot: FullCourtRotationSnapshot): number[] {
  const onCourt = new Set(snapshot.slots);
  const result: number[] = [];
  for (let index = 0; index < snapshot.plan.roster.length; index += 1) {
    if (onCourt.has(index)) continue;
    if (snapshot.plan.available[index] !== true) continue;
    if ((snapshot.fouls[index] ?? 0) >= FULL_COURT_FOUL_LIMIT) continue;
    result.push(index);
  }
  return result;
}

/** An emergency continuation player cannot leave; nobody can replace them. */
function mayLeave(snapshot: FullCourtRotationSnapshot, index: number): boolean {
  return snapshot.emergency[index] !== true;
}

function needSeconds(snapshot: FullCourtRotationSnapshot, index: number): number {
  return (snapshot.plan.targetSeconds[index] ?? 0) - (snapshot.playedSeconds[index] ?? 0);
}

function priorityOf(snapshot: FullCourtRotationSnapshot, index: number): number {
  return snapshot.plan.priorities[index] ?? 0;
}

function pickHighestNeed(
  snapshot: FullCourtRotationSnapshot,
  candidates: readonly number[],
): number | null {
  let best: number | null = null;
  for (const index of candidates) {
    if (best === null) {
      best = index;
      continue;
    }
    const need = needSeconds(snapshot, index);
    const bestNeed = needSeconds(snapshot, best);
    if (need > bestNeed) {
      best = index;
    } else if (need === bestNeed && priorityOf(snapshot, index) > priorityOf(snapshot, best)) {
      best = index;
    }
  }
  return best;
}

function pickByPriority(
  snapshot: FullCourtRotationSnapshot,
  candidates: readonly number[],
): number | null {
  let best: number | null = null;
  for (const index of candidates) {
    if (best === null) {
      best = index;
      continue;
    }
    if (priorityOf(snapshot, index) > priorityOf(snapshot, best)) best = index;
  }
  return best;
}

function pickFreshest(
  snapshot: FullCourtRotationSnapshot,
  candidates: readonly number[],
  minEnergy: number,
): number | null {
  let best: number | null = null;
  for (const index of candidates) {
    const energy = snapshot.energies[index] ?? 0;
    if (energy < minEnergy) continue;
    if (best === null) {
      best = index;
      continue;
    }
    const bestEnergy = snapshot.energies[best] ?? 0;
    if (energy > bestEnergy) {
      best = index;
    } else if (energy === bestEnergy && priorityOf(snapshot, index) > priorityOf(snapshot, best)) {
      best = index;
    }
  }
  return best;
}

/**
 * True when this swap would bench the last assigned scorer while bringing back
 * a non-scorer. A healthy scorer whose replacement is not a scorer is worse for
 * the user's staggering preference than leaving the rotation alone.
 */
function benchesLastScorer(
  snapshot: FullCourtRotationSnapshot,
  outIndex: number,
  inIndex: number,
): boolean {
  const { staggerStars, scorerIndices } = snapshot.plan;
  if (!staggerStars || scorerIndices.length === 0) return false;
  if (!scorerIndices.includes(outIndex) || scorerIndices.includes(inIndex)) return false;
  return !scorerIndices.some((index) => index !== outIndex && snapshot.slots.includes(index));
}

/**
 * Applies the star-staggering preference to an automatic swap. The outgoing
 * scorer is replaced by another available assigned scorer when one is viable;
 * otherwise a healthy last scorer stays on the floor. Exhausted scorers are
 * allowed to leave because fatigue already outranks the preference.
 */
function withScorerCoverage(
  snapshot: FullCourtRotationSnapshot,
  decision: Extract<FullCourtSubstitutionDecision, { kind: 'swap' }>,
  allowedIncoming?: ReadonlySet<number>,
): FullCourtSubstitutionDecision | null {
  if (!benchesLastScorer(snapshot, decision.outIndex, decision.inIndex)) return decision;
  const candidates = benchCandidates(snapshot).filter(
    (index) =>
      snapshot.plan.scorerIndices.includes(index) &&
      (allowedIncoming === undefined || allowedIncoming.has(index)),
  );
  const replacement = pickFreshest(snapshot, candidates, FULL_COURT_SEVERE_FATIGUE_ENERGY);
  if (replacement !== null) return { ...decision, inIndex: replacement };
  if ((snapshot.energies[decision.outIndex] ?? 0) <= FULL_COURT_SEVERE_FATIGUE_ENERGY) {
    return decision;
  }
  return null;
}

function closingRuleSwap(
  snapshot: FullCourtRotationSnapshot,
  rule: Extract<FullCourtRulePlan, { kind: 'closing-lineup' }>,
  bench: readonly number[],
): FullCourtSubstitutionDecision | null {
  const onCourt = new Set(snapshot.slots);
  const benchSet = new Set(bench);
  for (const target of rule.lineup) {
    if (onCourt.has(target)) continue;
    // An unavailable or spent target invalidates the whole rule rather than
    // leaving a partial lineup on the floor.
    if (!benchSet.has(target)) return null;
    if ((snapshot.energies[target] ?? 0) <= FULL_COURT_CLOSING_MIN_ENERGY) return null;
  }
  const incoming = rule.lineup.find((target) => !onCourt.has(target));
  if (incoming === undefined) return null;
  let outSlot = -1;
  let outIndex = -1;
  for (const [slot, index] of snapshot.slots.entries()) {
    if (rule.lineup.includes(index)) continue;
    if (!mayLeave(snapshot, index)) continue;
    if (outIndex === -1 || priorityOf(snapshot, index) < priorityOf(snapshot, outIndex)) {
      outSlot = slot;
      outIndex = index;
    }
  }
  if (outSlot === -1) return null;
  return { kind: 'swap', slot: outSlot, outIndex, inIndex: incoming, reason: 'coach-rule' };
}

function foulTroubleRuleSwap(
  snapshot: FullCourtRotationSnapshot,
  rule: Extract<FullCourtRulePlan, { kind: 'foul-trouble' }>,
  bench: readonly number[],
): FullCourtSubstitutionDecision | null {
  const slot = snapshot.slots.indexOf(rule.playerIndex);
  if (slot === -1) return null;
  const fouls = snapshot.fouls[rule.playerIndex] ?? 0;
  if (fouls < rule.foulLimit || fouls >= FULL_COURT_FOUL_LIMIT) return null;
  if (!mayLeave(snapshot, rule.playerIndex)) return null;
  if (bench.length === 0) return null;
  let incoming: number | null;
  if (rule.replacementIndex === null) {
    const byNeed = pickHighestNeed(snapshot, bench);
    incoming =
      byNeed !== null && needSeconds(snapshot, byNeed) > 0
        ? byNeed
        : pickByPriority(snapshot, bench);
  } else {
    // A named reserve who is unavailable, spent, or already on the floor leaves
    // the rule inactive so the staff rotation can handle the possession.
    if (!bench.includes(rule.replacementIndex)) return null;
    incoming = rule.replacementIndex;
  }
  if (incoming === null) return null;
  return {
    kind: 'swap',
    slot,
    outIndex: rule.playerIndex,
    inIndex: incoming,
    reason: 'coach-rule',
  };
}

/**
 * Marks a closing rule spent. Lower closing rules that are also live in this
 * window (time and score margin both satisfied) lose the same conflict and are
 * spent too; rules whose own condition does not hold right now stay available
 * for a later window. Closing rules are one-shot by design, so a spent rule
 * never re-triggers after the staff changes the lineup again. Foul-trouble rules
 * use a cooldown instead because the same player can return to foul trouble.
 */
function activateClosingRule(
  rules: readonly FullCourtRulePlan[],
  index: number,
  state: FullCourtRuleRuntimeState,
  regulationSecondsRemaining: number,
  scoreMargin: number,
): void {
  state.activated[index] = true;
  for (const [later, candidate] of rules.entries()) {
    if (later <= index || candidate.kind !== 'closing-lineup') continue;
    if (
      regulationSecondsRemaining <= candidate.secondsRemainingMax &&
      scoreMargin <= candidate.scoreMarginMax
    ) {
      state.activated[later] = true;
    }
  }
}

/**
 * Evaluates the ordered coaching rules. Forced exits and severe fatigue run
 * before this, and the first applicable rule wins a decision window.
 */
function evaluateCoachingRules(
  snapshot: FullCourtRotationSnapshot,
  context: FullCourtRotationContext,
  state: FullCourtRuleRuntimeState,
): FullCourtSubstitutionDecision {
  if (context.legalWindow === false || snapshot.plan.rules.length === 0) return { kind: 'none' };
  const regulationSecondsRemaining = Math.max(
    0,
    FULL_COURT_REGULATION_SECONDS - context.globalSeconds,
  );
  const bench = benchCandidates(snapshot);
  for (const [index, rule] of snapshot.plan.rules.entries()) {
    if (state.activated[index] === true) continue;
    if ((state.cooldownsUntil[index] ?? 0) > context.globalSeconds) continue;
    if (state.boundarySeconds === context.globalSeconds && state.boundaryRuleIndex !== index) {
      continue;
    }
    if (rule.kind === 'closing-lineup') {
      if (
        regulationSecondsRemaining > rule.secondsRemainingMax ||
        context.scoreMargin > rule.scoreMarginMax
      ) {
        continue;
      }
      const onCourt = new Set(snapshot.slots);
      if (rule.lineup.every((target) => onCourt.has(target))) {
        // The higher-priority lineup is already on the floor. Claim this window
        // so a lower rule cannot change it, without spending the rule.
        state.boundarySeconds = context.globalSeconds;
        state.boundaryRuleIndex = index;
        return { kind: 'none' };
      }
      const decision = closingRuleSwap(snapshot, rule, bench);
      if (decision === null || decision.kind !== 'swap') continue;
      state.boundarySeconds = context.globalSeconds;
      state.boundaryRuleIndex = index;
      const nextSlots = snapshot.slots.map((slot, position) =>
        position === decision.slot ? decision.inIndex : slot,
      );
      const nextOnCourt = new Set(nextSlots);
      if (rule.lineup.every((target) => nextOnCourt.has(target))) {
        // One-shot activation: a later staff substitution does not re-trigger it.
        activateClosingRule(
          snapshot.plan.rules,
          index,
          state,
          regulationSecondsRemaining,
          context.scoreMargin,
        );
      }
      return decision;
    }
    const decision = foulTroubleRuleSwap(snapshot, rule, bench);
    if (decision === null) continue;
    state.boundarySeconds = context.globalSeconds;
    state.boundaryRuleIndex = index;
    state.cooldownsUntil[index] = context.globalSeconds + FULL_COURT_RULE_COOLDOWN_SECONDS;
    return decision;
  }
  return { kind: 'none' };
}

/**
 * Chooses at most one change per call. Forced disqualification exits come first,
 * then severe fatigue, then ordered coaching rules, then the closing five or
 * minute-target pace, then ordinary fatigue. Equal candidates resolve by
 * priority and then roster order.
 *
 * When the plan staggers stars, an automatic swap may not bench the last
 * primary/secondary scorer for a non-scorer. Forced exits, explicit coaching
 * rules, exhausted or unavailable scorers, and emergency continuations all
 * outrank that guard, and the saved starting five is never rewritten. The guard
 * never adds a substitution on its own, so a healthy dead ball is left alone.
 */
export function planSubstitution(
  snapshot: FullCourtRotationSnapshot,
  context: FullCourtRotationContext,
  ruleState?: FullCourtRuleRuntimeState,
): FullCourtSubstitutionDecision {
  const bench = benchCandidates(snapshot);
  const rules: FullCourtRuleRuntimeState = ruleState ?? {
    activated: snapshot.plan.rules.map(() => false),
    cooldownsUntil: snapshot.plan.rules.map(() => 0),
    boundarySeconds: -1,
    boundaryRuleIndex: -1,
  };

  for (const [slot, outIndex] of snapshot.slots.entries()) {
    if ((snapshot.fouls[outIndex] ?? 0) < FULL_COURT_FOUL_LIMIT) continue;
    if (!mayLeave(snapshot, outIndex)) continue;
    if (bench.length === 0) return { kind: 'emergency', playerIndex: outIndex };
    const byNeed = pickHighestNeed(snapshot, bench);
    const replacement =
      byNeed !== null && needSeconds(snapshot, byNeed) > 0
        ? byNeed
        : pickByPriority(snapshot, bench);
    if (replacement === null) return { kind: 'emergency', playerIndex: outIndex };
    return { kind: 'swap', slot, outIndex, inIndex: replacement, reason: 'foul-out' };
  }

  for (const [slot, outIndex] of snapshot.slots.entries()) {
    const energy = snapshot.energies[outIndex] ?? 0;
    if (energy > FULL_COURT_SEVERE_FATIGUE_ENERGY) continue;
    if (!mayLeave(snapshot, outIndex)) continue;
    const replacement = pickFreshest(snapshot, bench, energy + FULL_COURT_FATIGUE_SWAP_GAIN);
    if (replacement === null) continue;
    return { kind: 'swap', slot, outIndex, inIndex: replacement, reason: 'fatigue' };
  }

  const ruleDecision = evaluateCoachingRules(snapshot, context, rules);
  if (ruleDecision.kind !== 'none') return ruleDecision;
  // A rule already handled this window; do not let the staff closing five or
  // pace logic immediately undo it at the same dead ball.
  if (rules.boundarySeconds === context.globalSeconds) return { kind: 'none' };

  if (isClosingWindow(context)) {
    const closing = snapshot.plan.closingSlots;
    const onCourt = new Set(snapshot.slots);
    for (const incoming of closing) {
      if (onCourt.has(incoming)) continue;
      if (snapshot.plan.available[incoming] !== true) continue;
      if ((snapshot.fouls[incoming] ?? 0) >= FULL_COURT_FOUL_LIMIT) continue;
      if ((snapshot.energies[incoming] ?? 0) <= FULL_COURT_CLOSING_MIN_ENERGY) continue;
      if (!bench.includes(incoming)) continue;
      let outSlot = -1;
      let outIndex = -1;
      for (const [slot, index] of snapshot.slots.entries()) {
        if (closing.includes(index)) continue;
        if (!mayLeave(snapshot, index)) continue;
        if (outIndex === -1 || priorityOf(snapshot, index) < priorityOf(snapshot, outIndex)) {
          outSlot = slot;
          outIndex = index;
        }
      }
      if (outIndex === -1 || outSlot === -1) break;
      const covered = withScorerCoverage(
        snapshot,
        { kind: 'swap', slot: outSlot, outIndex, inIndex: incoming, reason: 'closing-five' },
        new Set(closing),
      );
      if (covered === null) break;
      return covered;
    }
  } else {
    const progress = clamp(context.globalSeconds / FULL_COURT_REGULATION_SECONDS, 0, 1);
    let outSlot = -1;
    let outIndex = -1;
    let outDeviation = FULL_COURT_PACE_DEVIATION_SECONDS;
    for (const [slot, index] of snapshot.slots.entries()) {
      if ((snapshot.stintSeconds[slot] ?? 0) < FULL_COURT_MIN_STINT_SECONDS) continue;
      if (!mayLeave(snapshot, index)) continue;
      const expected = (snapshot.plan.targetSeconds[index] ?? 0) * progress;
      const deviation = (snapshot.playedSeconds[index] ?? 0) - expected;
      if (deviation <= outDeviation) continue;
      if (outIndex !== -1 && priorityOf(snapshot, index) <= priorityOf(snapshot, outIndex)) {
        continue;
      }
      outSlot = slot;
      outIndex = index;
      outDeviation = deviation;
    }
    if (outIndex !== -1) {
      let incoming: number | null = null;
      let incomingDeviation = -FULL_COURT_PACE_REPLACEMENT_SECONDS;
      for (const index of bench) {
        if ((snapshot.energies[index] ?? 0) < FULL_COURT_PACE_MIN_RESERVE_ENERGY) continue;
        const expected = (snapshot.plan.targetSeconds[index] ?? 0) * progress;
        const deviation = (snapshot.playedSeconds[index] ?? 0) - expected;
        if (deviation > incomingDeviation) continue;
        if (incoming !== null && priorityOf(snapshot, index) <= priorityOf(snapshot, incoming)) {
          continue;
        }
        incoming = index;
        incomingDeviation = deviation;
      }
      if (incoming !== null) {
        const covered = withScorerCoverage(snapshot, {
          kind: 'swap',
          slot: outSlot,
          outIndex,
          inIndex: incoming,
          reason: 'minute-target',
        });
        if (covered !== null) return covered;
      }
    }
  }

  let tiredSlot = -1;
  let tiredIndex = -1;
  for (const [slot, index] of snapshot.slots.entries()) {
    const energy = snapshot.energies[index] ?? 0;
    if (energy > FULL_COURT_TIRED_ENERGY) continue;
    if ((snapshot.stintSeconds[slot] ?? 0) < FULL_COURT_MIN_STINT_SECONDS) continue;
    if (!mayLeave(snapshot, index)) continue;
    if (tiredIndex !== -1 && energy >= (snapshot.energies[tiredIndex] ?? 0)) continue;
    tiredSlot = slot;
    tiredIndex = index;
  }
  if (tiredIndex === -1) return { kind: 'none' };
  const fresh = pickFreshest(
    snapshot,
    bench,
    (snapshot.energies[tiredIndex] ?? 0) + FULL_COURT_FATIGUE_SWAP_GAIN,
  );
  if (fresh === null) return { kind: 'none' };
  const covered = withScorerCoverage(snapshot, {
    kind: 'swap',
    slot: tiredSlot,
    outIndex: tiredIndex,
    inIndex: fresh,
    reason: 'fatigue',
  });
  return covered ?? { kind: 'none' };
}
