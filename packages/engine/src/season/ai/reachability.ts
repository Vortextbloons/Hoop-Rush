import type { SeasonAiIdentity, SeasonRosterRole } from '@hoop-rush/data-contracts';
import { POSITIONS } from '@hoop-rush/data-contracts';
import { ROLE_COVERAGE_THRESHOLD } from '../ai-scoring.ts';
import { FIVE_COVERAGE_TARGETS } from './constants.ts';
import { identityScoreOf } from './state.ts';
import type { GenerationState } from './types.ts';

function stateSize(targets: readonly number[]): number {
  let size = 1;
  for (const target of targets) size *= target + 1;
  return size;
}
function countIndex(counts: readonly number[], targets: readonly number[]): number {
  let index = 0;
  for (let p = 0; p < targets.length; p += 1) {
    index = index * ((targets[p] ?? 0) + 1) + Math.min(targets[p] ?? 0, counts[p] ?? 0);
  }
  return index;
}
function decodeIndex(index: number, targets: readonly number[]): number[] {
  const counts = new Array<number>(targets.length).fill(0);
  let rest = index;
  for (let p = targets.length - 1; p >= 0; p -= 1) {
    const base = (targets[p] ?? 0) + 1;
    counts[p] = rest % base;
    rest = Math.floor(rest / base);
  }
  return counts;
}
function isComplete(counts: readonly number[], targets: readonly number[]): boolean {
  for (let p = 0; p < targets.length; p += 1) {
    if ((counts[p] ?? 0) < (targets[p] ?? 0)) return false;
  }
  return true;
}
function fullStateIndex(targets: readonly number[]): number {
  let index = 0;
  for (const target of targets) index = index * (target + 1) + target;
  return index;
}
function applyMask(counts: number[], mask: number, targets: readonly number[]): void {
  for (let p = 0; p < targets.length; p += 1) {
    if ((mask & (1 << p)) !== 0) {
      counts[p] = Math.min(targets[p] ?? 0, (counts[p] ?? 0) + 1);
    }
  }
}
function reachableAtAnyUsed(
  reachable: Uint8Array,
  states: number,
  maxPicks: number,
  full: number,
): boolean {
  for (let used = 0; used <= maxPicks; used += 1) {
    if (reachable[used * states + full] === 1) return true;
  }
  return false;
}
function boundedKnapsack(
  startCounts: readonly number[],
  maskGroups: ReadonlyMap<number, number>,
  maxPicks: number,
  targets: readonly number[],
): boolean {
  if (maxPicks < 0) return false;
  const states = stateSize(targets);
  const full = fullStateIndex(targets);
  const reachable = new Uint8Array(states * (maxPicks + 1));
  reachable[countIndex(startCounts, targets)] = 1;
  if (reachable[full] === 1) return true;
  for (const [mask, count] of maskGroups) {
    if (count <= 0) continue;
    for (let used = maxPicks - 1; used >= 0; used -= 1) {
      const maxAdd = Math.min(count, maxPicks - used);
      for (let state = 0; state < states; state += 1) {
        if (reachable[used * states + state] === 0) continue;
        const base = decodeIndex(state, targets);
        for (let add = 1; add <= maxAdd; add += 1) {
          const counts = [...base];
          for (let repeat = 0; repeat < add; repeat += 1) applyMask(counts, mask, targets);
          reachable[(used + add) * states + countIndex(counts, targets)] = 1;
        }
      }
    }
    if (reachableAtAnyUsed(reachable, states, maxPicks, full)) return true;
  }
  return reachableAtAnyUsed(reachable, states, maxPicks, full);
}
export function fiveReachableFromCounts(
  ownedCounts: readonly number[],
  availableMaskCounts: readonly number[],
  remainingPicks: number,
): boolean {
  if (!Number.isInteger(remainingPicks) || remainingPicks < 0) {
    throw new Error(`remainingPicks must be a nonnegative integer (got ${String(remainingPicks)})`);
  }
  const targets = FIVE_COVERAGE_TARGETS;
  const startCounts = targets.map((target, p) => Math.min(target, ownedCounts[p] ?? 0));
  if (isComplete(startCounts, targets)) return true;
  const maskGroups = new Map<number, number>();
  for (let mask = 1; mask < 1 << POSITIONS.length; mask += 1) {
    const count = availableMaskCounts[mask] ?? 0;
    if (count > 0) maskGroups.set(mask, count);
  }
  return boundedKnapsack(startCounts, maskGroups, remainingPicks, targets);
}
export function reachableAfterFixedAndFills(
  targets: readonly number[],
  startCounts: readonly number[],
  fixedMasks: readonly number[],
  unassignedMasks: readonly number[],
  slotsToFill: number,
  maxUnassignedPicks: number,
): boolean {
  const states = stateSize(targets);
  const full = fullStateIndex(targets);
  let reachable = new Uint8Array(states);
  reachable[countIndex(startCounts, targets)] = 1;
  if (reachable[full] === 1) return true;
  for (const mask of fixedMasks) {
    if (mask === 0) continue;
    const next = new Uint8Array(states);
    for (let state = 0; state < states; state += 1) {
      if (reachable[state] === 0) continue;
      const counts = decodeIndex(state, targets);
      applyMask(counts, mask, targets);
      next[countIndex(counts, targets)] = 1;
    }
    reachable = next;
    if (reachable[full] === 1) return true;
  }
  const maxPicks = Math.min(slotsToFill, maxUnassignedPicks);
  if (maxPicks <= 0) return reachable[full] === 1;
  const maskGroups = new Map<number, number>();
  for (let mask = 1; mask < 1 << POSITIONS.length; mask += 1) {
    const count = unassignedMasks[mask] ?? 0;
    if (count > 0) maskGroups.set(mask, count);
  }
  const withPicks = new Uint8Array(states * (maxPicks + 1));
  for (let state = 0; state < states; state += 1) {
    if (reachable[state] === 1) withPicks[state] = 1;
  }
  for (;;) {
    const before = new Uint8Array(withPicks);
    for (const [mask, count] of maskGroups) {
      for (let used = maxPicks - 1; used >= 0; used -= 1) {
        const maxAdd = Math.min(count, maxPicks - used);
        if (maxAdd <= 0) continue;
        for (let state = 0; state < states; state += 1) {
          if (before[used * states + state] === 0) continue;
          const base = decodeIndex(state, targets);
          for (let add = 1; add <= maxAdd; add += 1) {
            const counts = [...base];
            for (let repeat = 0; repeat < add; repeat += 1) applyMask(counts, mask, targets);
            withPicks[(used + add) * states + countIndex(counts, targets)] = 1;
          }
        }
      }
    }
    for (let used = 0; used <= maxPicks; used += 1) {
      if (withPicks[used * states + full] === 1) return true;
    }
    let unchanged = true;
    for (let i = 0; i < withPicks.length; i += 1) {
      if (withPicks[i] !== before[i]) {
        unchanged = false;
        break;
      }
    }
    if (unchanged) break;
  }
  for (let used = 0; used <= maxPicks; used += 1) {
    if (withPicks[used * states + full] === 1) return true;
  }
  return false;
}
export interface MemberReachOutlierBudget {
  identity: SeasonAiIdentity;
  capValue: number;
  startOutliers: number;
  maxOutliers: number;
}
export function memberReachCapped(
  state: GenerationState,
  targets: readonly number[],
  startCounts: readonly number[],
  memberIds: readonly string[],
  maxPicks: number,
  outlierBudget?: MemberReachOutlierBudget,
): boolean {
  if (maxPicks < 0) return false;
  const outlierBudgetExceeded =
    outlierBudget !== undefined && outlierBudget.startOutliers > outlierBudget.maxOutliers;
  if (outlierBudgetExceeded) return false;
  const start = targets.map((target, p) => Math.min(target, startCounts[p] ?? 0));
  if (isComplete(start, targets)) return true;
  if (outlierBudget === undefined) {
    const maskGroups = new Map<number, number>();
    for (const id of memberIds) {
      const mask = state.maskByVersion.get(id) ?? 0;
      if (mask === 0) continue;
      maskGroups.set(mask, (maskGroups.get(mask) ?? 0) + 1);
    }
    return boundedKnapsack(start, maskGroups, maxPicks, targets);
  }
  const { identity, capValue, startOutliers, maxOutliers } = outlierBudget;
  const states = stateSize(targets);
  const full = fullStateIndex(targets);
  const strideO = states;
  const usedBase = strideO * (maxOutliers + 1);
  const reachable = new Uint8Array(usedBase * (maxPicks + 1));
  reachable[countIndex(start, targets) + startOutliers * strideO] = 1;
  for (const id of memberIds) {
    const mask = state.maskByVersion.get(id) ?? 0;
    if (mask === 0) continue;
    const isOutlier = identityScoreOf(state, id, identity) > capValue ? 1 : 0;
    for (let used = maxPicks - 1; used >= 0; used -= 1) {
      for (let state = 0; state < states; state += 1) {
        const base = used * usedBase;
        for (let o = maxOutliers; o >= 0; o -= 1) {
          if (reachable[base + state + o * strideO] === 0) continue;
          if (o + isOutlier > maxOutliers) continue;
          const counts = decodeIndex(state, targets);
          applyMask(counts, mask, targets);
          reachable[
            (used + 1) * usedBase + countIndex(counts, targets) + (o + isOutlier) * strideO
          ] = 1;
        }
      }
    }
  }
  for (let used = 0; used <= maxPicks; used += 1) {
    for (let o = 0; o <= maxOutliers; o += 1) {
      if (reachable[used * usedBase + full + o * strideO] === 1) return true;
    }
  }
  return false;
}
export function coverageFeasibleFromPool(
  state: GenerationState,
  uncovered: readonly SeasonRosterRole[],
  memberIds: readonly string[],
  slots: number,
): boolean {
  if (uncovered.length === 0) return true;
  if (slots <= 0) return false;
  const full = (1 << uncovered.length) - 1;
  const minimumPicks = new Array<number>(full + 1).fill(Infinity);
  minimumPicks[0] = 0;
  for (const id of memberIds) {
    const scores = state.roleScores.get(id);
    if (scores === undefined) continue;
    let mask = 0;
    uncovered.forEach((role, roleIndex) => {
      if (scores[role] >= ROLE_COVERAGE_THRESHOLD) mask |= 1 << roleIndex;
    });
    if (mask === 0) continue;
    for (let covered = full; covered >= 0; covered -= 1) {
      const picks = (minimumPicks[covered] ?? Infinity) + 1;
      if (picks > slots) continue;
      const combined = covered | mask;
      minimumPicks[combined] = Math.min(minimumPicks[combined] ?? Infinity, picks);
    }
    if ((minimumPicks[full] ?? Infinity) <= slots) return true;
  }
  return false;
}
