import type { Position, SeasonRotation } from '@hoop-rush/data-contracts';
import { canPlay } from '../domain/positions.ts';

/**
 * M2.2 deterministic substitution planner (spec/2.0/04, rotation-planner-v1).
 * This file is the authoritative rotation-planner contract: presets belong to
 * season/rotation.ts (applySeasonRotationPreset), and legal-five enumeration,
 * initial-unit selection, and mid-game unit planning live here.
 *
 * The planner consumes NO RNG and produces identical results for identical
 * inputs, so calibration cohorts, worker counts, and execution order can
 * never change a Season game's decisions.
 *
 * ## Frozen planner rules (spec/2.0/04 M2.2)
 *
 * - Lineups are ordered G, G, F, F, C and must be legal five-player
 *   assignments of available, non-fouled-out players.
 * - `chooseInitialUnit`: the configured starters when they are all available
 *   and legal in their configured slot order; otherwise the first
 *   deterministic legal contingency.
 * - `planUnit` normal scoring (regulation, outside the closing window)
 *   minimizes the projected absolute target-minute deviation at the next
 *   checkpoint: for every candidate unit U,
 *     projected(i) = actualSeconds(i) + delta * onCourt(i)
 *     score(U)     = sum over the ten rostered versions of
 *                    | projected(i) - targetSeconds(i) |
 *   where delta is the seconds until the next whole-minute checkpoint of the
 *   current period (60 when the boundary was reached on a whole minute,
 *   otherwise secondsRemaining % 60), clamped to secondsRemaining.
 * - Tie-breaks, applied in order: retain more current players (higher
 *   current-unit overlap), then bench hierarchy, then canonical ascending
 *   playerVersionId order of the candidate unit.
 * - Closing window: the final five regulation minutes (period 4 with
 *   secondsRemaining <= 300) when the score margin is <= 12. Within the
 *   window, prefer the configured closing five; otherwise choose the closest
 *   legal contingency by (closing-five overlap desc, current-unit continuity
 *   desc, bench hierarchy, canonical ascending ids).
 * - Overtime (period > 4): the preferred closing unit starts every overtime
 *   period; planUnit never chases regulation targets in overtime. Foul-outs
 *   and removals still force contingency planning with the closing-preference
 *   ordering.
 * - Bench hierarchy comparator: for two units, compare the sorted ascending
 *   tuples of their players' benchOrder indices (players outside the bench
 *   count as index -1); the lexicographically smaller tuple wins. This
 *   prefers starters, then earlier bench roles.
 * - `planUnit` returns null when no legal five can be formed from the
 *   available players; the controller turns that into a typed forfeit.
 */

export interface PlannerMember {
  playerVersionId: string;
  playable: readonly Position[];
}

/** Rotation facts the planner reads: rotation, positions, regulation targets. */
export interface PlannerRotationContext {
  rotation: SeasonRotation;
  /** Playable positions per rostered playerVersionId. */
  members: ReadonlyMap<string, readonly Position[]>;
  /** Regulation target seconds per rostered playerVersionId (target minutes x 60). */
  targets: ReadonlyMap<string, number>;
}

/** Everything the planner needs for one mid-game unit decision. */
export interface PlannerUnitRequest {
  side: 'home' | 'away';
  /** Current ordered unit (G, G, F, F, C). */
  currentUnit: readonly string[];
  /** Players unavailable right now (fouled out, removed, pregame unavailable). */
  unavailable: ReadonlySet<string>;
  /** Regulation seconds played by each rostered version so far. */
  actualSeconds: ReadonlyMap<string, number>;
  /** 1-based period. */
  period: number;
  /** Game clock seconds remaining in the current period. */
  secondsRemaining: number;
  /** True when the closing window applies (period 4, <=300s, margin <= 12). */
  closingWindow: boolean;
  /** |home - away| score margin at the pause. */
  scoreMargin: number;
}

/**
 * All legal ordered G, G, F, F, C assignments over the available players,
 * in deterministic enumeration order: for each slot in order, candidates are
 * considered in bench hierarchy order (starters first via bench index -1,
 * then benchOrder ascending), then canonical ascending playerVersionId.
 *
 * The planner context does not carry the rotation here, so the bench
 * hierarchy arrives through the member order: `members` must be passed in
 * bench hierarchy order (starters in canonical ascending playerVersionId
 * order first, then the five bench players in benchOrder order). The internal
 * callers (chooseInitialUnit, planUnit) always build that order.
 */
export function enumerateLegalFives(
  members: readonly PlannerMember[],
  available: ReadonlySet<string>,
): string[][] {
  const results: string[][] = [];
  const used = new Set<string>();
  const unit: string[] = [];
  const solve = (slot: number): void => {
    if (slot >= STARTING_SLOTS.length) {
      results.push([...unit]);
      return;
    }
    const requirement = STARTING_SLOTS[slot];
    if (requirement === undefined) return;
    for (const member of members) {
      if (used.has(member.playerVersionId)) continue;
      if (!available.has(member.playerVersionId)) continue;
      if (!canPlay(member.playable, requirement)) continue;
      used.add(member.playerVersionId);
      unit.push(member.playerVersionId);
      solve(slot + 1);
      unit.pop();
      used.delete(member.playerVersionId);
    }
  };
  solve(0);
  return results;
}

/**
 * Per-context planner state memoized for the lifetime of one rotation
 * context: the bench-hierarchy-ordered members and the benchOrder index.
 * Both are pure functions of the immutable context, so the cache is exact.
 */
const plannerStateCache = new WeakMap<
  PlannerRotationContext,
  { members: PlannerMember[]; benchIndex: ReadonlyMap<string, number> }
>();

function plannerState(context: PlannerRotationContext): {
  members: PlannerMember[];
  benchIndex: ReadonlyMap<string, number>;
} {
  let state = plannerStateCache.get(context);
  if (state === undefined) {
    state = {
      members: orderedPlannerMembers(context),
      benchIndex: new Map(
        context.rotation.benchOrder.map((playerVersionId, index) => [playerVersionId, index]),
      ),
    };
    plannerStateCache.set(context, state);
  }
  return state;
}

/**
 * Tipoff unit: the configured starters when all are available and legal in
 * slot order; otherwise the first deterministic legal contingency from
 * enumerateLegalFives. Returns null when no legal five exists.
 */
export function chooseInitialUnit(
  context: PlannerRotationContext,
  unavailable: ReadonlySet<string>,
): string[] | null {
  const members = plannerState(context).members;
  const playableById = new Map(members.map((member) => [member.playerVersionId, member.playable]));

  const starters = context.rotation.starters;
  let startersLegal = starters.length === STARTING_SLOTS.length;
  if (startersLegal) {
    for (let slot = 0; slot < STARTING_SLOTS.length; slot += 1) {
      const starterId = starters[slot];
      const requirement = STARTING_SLOTS[slot];
      const playable = starterId === undefined ? undefined : playableById.get(starterId);
      if (
        starterId === undefined ||
        requirement === undefined ||
        playable === undefined ||
        unavailable.has(starterId) ||
        !canPlay(playable, requirement)
      ) {
        startersLegal = false;
        break;
      }
    }
  }
  if (startersLegal) return [...starters];

  const available = new Set(
    members.map((member) => member.playerVersionId).filter((id) => !unavailable.has(id)),
  );
  const contingencies = enumerateLegalFives(members, available);
  const first = contingencies[0];
  if (first === undefined) return null;
  return [...first];
}

/**
 * Best unit for the next interval under the frozen scoring and tie-break
 * rules above. Returns the current unit when it scores best (the controller
 * records a substitution only when the unit actually changes), and null when
 * no legal five exists. `options.candidates` supplies a precomputed candidate
 * list (see `plannerCandidates`) so long-running callers can cache the
 * availability-dependent enumeration; the scoring restructure below is an
 * exact integer rewrite of the frozen formula
 * (score = base + sum of per-player on-court adjustments), so results are
 * byte-identical whether or not candidates are supplied.
 */
export function planUnit(
  context: PlannerRotationContext,
  request: PlannerUnitRequest,
  options: { candidates?: readonly (readonly string[])[] } = {},
): string[] | null {
  const { members, benchIndex } = plannerState(context);
  const available = new Set(
    members.map((member) => member.playerVersionId).filter((id) => !request.unavailable.has(id)),
  );
  const candidates = options.candidates ?? enumerateLegalFives(members, available);
  const first = candidates[0];
  if (first === undefined) return null;

  const preferClosing = request.closingWindow || request.period > 4;

  if (preferClosing) {
    if (closingFiveIsLegal(context, request.unavailable)) return [...context.rotation.closingFive];
    let best = first;
    for (let i = 1; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      if (candidate === undefined) continue;
      if (closingPreferenceCompare(candidate, best, context, request, benchIndex) < 0) {
        best = candidate;
      }
    }
    return [...best];
  }

  const secondsRemaining = request.secondsRemaining;
  const rawDelta = secondsRemaining % 60 === 0 ? 60 : secondsRemaining % 60;
  const delta = Math.min(rawDelta, secondsRemaining);

  const { base, adjustment } = scoreParts(delta, context, request);
  const currentUnitSet = new Set(request.currentUnit);

  let best = first;
  let bestScore = scoreOf(best, base, adjustment);
  for (let i = 1; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (candidate === undefined) continue;
    const candidateScore = scoreOf(candidate, base, adjustment);
    const scoreCompare = candidateScore - bestScore;
    const retentionCompare =
      overlapWith(candidate, currentUnitSet) - overlapWith(best, currentUnitSet);
    if (
      scoreCompare < 0 ||
      (scoreCompare === 0 && retentionCompare > 0) ||
      (scoreCompare === 0 && retentionCompare === 0 && unitCompare(candidate, best, benchIndex) < 0)
    ) {
      best = candidate;
      bestScore = candidateScore;
    }
  }
  return [...best];
}

/**
 * The legal-five candidate list for one side at one availability state:
 * bench-hierarchy-ordered members filtered by `unavailable`, then the full
 * deterministic enumeration. Constant per availability state, so callers that
 * plan repeatedly (the Season game controller at every whole-minute
 * checkpoint) cache this instead of re-enumerating per call.
 */
export function plannerCandidates(
  context: PlannerRotationContext,
  unavailable: ReadonlySet<string>,
): readonly (readonly string[])[] {
  const members = plannerState(context).members;
  const available = new Set(
    members.map((member) => member.playerVersionId).filter((id) => !unavailable.has(id)),
  );
  return enumerateLegalFives(members, available);
}

/** Lineup slot requirements shared with season/rotation.ts. */
const STARTING_SLOTS = ['G', 'G', 'F', 'F', 'C'] as const;

/**
 * Members in bench hierarchy order: starters in canonical ascending
 * playerVersionId order, then the bench in benchOrder order. This is the
 * exact input contract of enumerateLegalFives.
 */
function orderedPlannerMembers(context: PlannerRotationContext): PlannerMember[] {
  const starters = [...context.rotation.starters].sort();
  const order = [...starters, ...context.rotation.benchOrder];
  const seen = new Set<string>();
  const members: PlannerMember[] = [];
  for (const playerVersionId of order) {
    if (seen.has(playerVersionId)) continue;
    seen.add(playerVersionId);
    const playable = context.members.get(playerVersionId) ?? [];
    members.push({ playerVersionId, playable });
  }
  return members;
}

/**
 * Exact integer rewrite of the frozen deviation score. For every rostered
 * version, score(U) = |actual(i) + delta * onCourt(i) - target(i)|. Splitting
 * the sum into the off-court baseline (identical for every candidate) plus a
 * per-player on-court adjustment keeps the comparison identical while
 * reducing per-candidate work from ten lookups to five additions. All values
 * are integer seconds, so the restructure never changes a comparison.
 */
function scoreParts(
  delta: number,
  context: PlannerRotationContext,
  request: PlannerUnitRequest,
): { base: number; adjustment: Map<string, number> } {
  let base = 0;
  const adjustment = new Map<string, number>();
  const add = (playerVersionId: string): void => {
    const targetSeconds = context.targets.get(playerVersionId) ?? 0;
    const actualSeconds = request.actualSeconds.get(playerVersionId) ?? 0;
    base += Math.abs(actualSeconds - targetSeconds);
    adjustment.set(
      playerVersionId,
      Math.abs(actualSeconds + delta - targetSeconds) - Math.abs(actualSeconds - targetSeconds),
    );
  };
  for (const playerVersionId of context.rotation.starters) {
    add(playerVersionId);
  }
  for (const playerVersionId of context.rotation.benchOrder) {
    add(playerVersionId);
  }
  return { base, adjustment };
}

/** score(U) = base + sum over the unit of the on-court adjustment. */
function scoreOf(
  unit: readonly string[],
  base: number,
  adjustment: ReadonlyMap<string, number>,
): number {
  let total = base;
  for (const playerVersionId of unit) {
    total += adjustment.get(playerVersionId) ?? 0;
  }
  return total;
}

function overlapWith(unit: readonly string[], currentUnit: ReadonlySet<string>): number {
  let overlap = 0;
  for (const playerVersionId of unit) {
    if (currentUnit.has(playerVersionId)) overlap += 1;
  }
  return overlap;
}

function currentOverlap(unit: readonly string[], currentUnit: readonly string[]): number {
  const current = new Set(currentUnit);
  let overlap = 0;
  for (const playerVersionId of unit) {
    if (current.has(playerVersionId)) overlap += 1;
  }
  return overlap;
}

/**
 * Bench hierarchy comparator: sorted ascending tuples of benchOrder indices
 * (non-bench players count as -1); the lexicographically smaller tuple wins.
 * Then canonical ascending playerVersionId of the unit compared in slot order
 * (equal sorted tuples imply identical player sets, so the slot sequence is
 * the meaningful final key).
 */
function unitCompare(
  a: readonly string[],
  b: readonly string[],
  benchIndex: ReadonlyMap<string, number>,
): number {
  const tupleA = benchTuple(a, benchIndex);
  const tupleB = benchTuple(b, benchIndex);
  for (let i = 0; i < tupleA.length && i < tupleB.length; i += 1) {
    const indexA = tupleA[i];
    const indexB = tupleB[i];
    if (indexA === undefined || indexB === undefined) continue;
    if (indexA !== indexB) return indexA < indexB ? -1 : 1;
  }
  for (let i = 0; i < a.length && i < b.length; i += 1) {
    const idA = a[i];
    const idB = b[i];
    if (idA === undefined || idB === undefined) continue;
    if (idA !== idB) return idA < idB ? -1 : 1;
  }
  return 0;
}

function benchTuple(unit: readonly string[], benchIndex: ReadonlyMap<string, number>): number[] {
  return unit.map((playerVersionId) => benchIndex.get(playerVersionId) ?? -1).sort((a, b) => a - b);
}

function closingFiveIsLegal(
  context: PlannerRotationContext,
  unavailable: ReadonlySet<string>,
): boolean {
  const closing = context.rotation.closingFive;
  if (closing.length !== STARTING_SLOTS.length || new Set(closing).size !== closing.length) {
    return false;
  }
  for (let slot = 0; slot < STARTING_SLOTS.length; slot += 1) {
    const playerVersionId = closing[slot];
    const requirement = STARTING_SLOTS[slot];
    const playable =
      playerVersionId === undefined ? undefined : context.members.get(playerVersionId);
    if (
      playerVersionId === undefined ||
      requirement === undefined ||
      playable === undefined ||
      unavailable.has(playerVersionId) ||
      !canPlay(playable, requirement)
    ) {
      return false;
    }
  }
  return true;
}

/** Closing-preference ordering: closing overlap desc, continuity desc, hierarchy, canonical ids. */
function closingPreferenceCompare(
  a: readonly string[],
  b: readonly string[],
  context: PlannerRotationContext,
  request: PlannerUnitRequest,
  benchIndex: ReadonlyMap<string, number>,
): number {
  const closingOverlapCompare =
    currentOverlap(a, context.rotation.closingFive) -
    currentOverlap(b, context.rotation.closingFive);
  if (closingOverlapCompare !== 0) return -closingOverlapCompare;
  const continuityCompare =
    currentOverlap(a, request.currentUnit) - currentOverlap(b, request.currentUnit);
  if (continuityCompare !== 0) return -continuityCompare;
  return unitCompare(a, b, benchIndex);
}
