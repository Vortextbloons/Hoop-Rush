import type { SeasonAiIdentity, SeasonRosterRole } from '@hoop-rush/data-contracts';
import { ROSTER_ROLES, ROLE_COVERAGE_THRESHOLD } from '../ai-scoring.ts';
import { identityScoreOf } from './state.ts';
import type { GenerationState } from './types.ts';

export function fiveReachableFromCounts(
  ownedCounts: {
    guards: number;
    forwards: number;
    centers: number;
  },
  availableMaskCounts: readonly number[],
  remainingPicks: number,
): boolean {
  if (!Number.isInteger(remainingPicks) || remainingPicks < 0) {
    throw new Error(`remainingPicks must be a nonnegative integer (got ${String(remainingPicks)})`);
  }
  const targetG = 2;
  const targetF = 2;
  const targetC = 1;
  const startG = Math.min(targetG, ownedCounts.guards);
  const startF = Math.min(targetF, ownedCounts.forwards);
  const startC = Math.min(targetC, ownedCounts.centers);
  if (startG >= targetG && startF >= targetF && startC >= targetC) return true;
  const usedBase = 18;
  const stateCount = usedBase * (remainingPicks + 1);
  const reachable = new Uint8Array(stateCount);
  reachable[startG * 6 + startF * 2 + startC] = 1;
  for (let mask = 1; mask <= 7; mask += 1) {
    const count = availableMaskCounts[mask] ?? 0;
    if (count === 0) continue;
    for (let used = remainingPicks - 1; used >= 0; used -= 1) {
      const maxAdd = Math.min(count, remainingPicks - used);
      for (let g = targetG; g >= 0; g -= 1) {
        for (let f = targetF; f >= 0; f -= 1) {
          for (let c = targetC; c >= 0; c -= 1) {
            const idx = used * usedBase + g * 6 + f * 2 + c;
            if (reachable[idx] === 0) continue;
            for (let add = 1; add <= maxAdd; add += 1) {
              const ng = Math.min(targetG, g + ((mask & 1) !== 0 ? add : 0));
              const nf = Math.min(targetF, f + ((mask & 2) !== 0 ? add : 0));
              const nc = Math.min(targetC, c + ((mask & 4) !== 0 ? add : 0));
              reachable[(used + add) * usedBase + ng * 6 + nf * 2 + nc] = 1;
            }
          }
        }
      }
    }
    if (reachable[remainingPicks * usedBase + targetG * 6 + targetF * 2 + targetC] === 1) {
      return true;
    }
  }
  return reachable[remainingPicks * usedBase + targetG * 6 + targetF * 2 + targetC] === 1;
}
export function reachableAfterFixedAndFills(
  targets: {
    guards: number;
    forwards: number;
    centers: number;
  },
  startCounts: {
    guards: number;
    forwards: number;
    centers: number;
  },
  fixedMasks: readonly number[],
  unassignedMasks: readonly number[],
  slotsToFill: number,
  maxUnassignedPicks: number,
): boolean {
  const targetG = targets.guards;
  const targetF = targets.forwards;
  const targetC = targets.centers;
  const usedBase = (targetG + 1) * (targetF + 1) * (targetC + 1);
  const capG = (g: number): number => Math.min(targetG, g);
  const capF = (f: number): number => Math.min(targetF, f);
  const capC = (c: number): number => Math.min(targetC, c);
  const stateIndex = (g: number, f: number, c: number): number =>
    g * (targetF + 1) * (targetC + 1) + f * (targetC + 1) + c;
  if (
    capG(startCounts.guards) >= targetG &&
    capF(startCounts.forwards) >= targetF &&
    capC(startCounts.centers) >= targetC
  ) {
    return true;
  }
  let reachable = new Uint8Array(usedBase);
  reachable[
    stateIndex(capG(startCounts.guards), capF(startCounts.forwards), capC(startCounts.centers))
  ] = 1;
  for (const mask of fixedMasks) {
    if (mask === 0) continue;
    const next = new Uint8Array(usedBase);
    for (let g = targetG; g >= 0; g -= 1) {
      for (let f = targetF; f >= 0; f -= 1) {
        for (let c = targetC; c >= 0; c -= 1) {
          const idx = stateIndex(g, f, c);
          if (reachable[idx] === 0) continue;
          next[idx] = 1;
          next[
            stateIndex(
              capG(g + ((mask & 1) !== 0 ? 1 : 0)),
              capF(f + ((mask & 2) !== 0 ? 1 : 0)),
              capC(c + ((mask & 4) !== 0 ? 1 : 0)),
            )
          ] = 1;
        }
      }
    }
    reachable = next;
  }
  const maxPicks = Math.min(slotsToFill, maxUnassignedPicks);
  if (maxPicks <= 0) {
    return reachable[stateIndex(targetG, targetF, targetC)] === 1;
  }
  const withPicks = new Uint8Array(usedBase * (maxPicks + 1));
  for (let g = targetG; g >= 0; g -= 1) {
    for (let f = targetF; f >= 0; f -= 1) {
      for (let c = targetC; c >= 0; c -= 1) {
        const idx = stateIndex(g, f, c);
        if (reachable[idx] === 0) continue;
        withPicks[stateIndex(g, f, c)] = 1;
      }
    }
  }
  for (let pass = 0; pass <= maxPicks; pass += 1) {
    const before = new Uint8Array(withPicks);
    for (let mask = 1; mask <= 7; mask += 1) {
      const count = unassignedMasks[mask] ?? 0;
      if (count === 0) continue;
      for (let used = maxPicks - 1; used >= 0; used -= 1) {
        const maxAdd = Math.min(count, maxPicks - used);
        if (maxAdd <= 0) continue;
        for (let g = targetG; g >= 0; g -= 1) {
          for (let f = targetF; f >= 0; f -= 1) {
            for (let c = targetC; c >= 0; c -= 1) {
              const base = used * usedBase + stateIndex(g, f, c);
              if (before[base] === 0) continue;
              for (let add = 1; add <= maxAdd; add += 1) {
                const ng = capG(g + ((mask & 1) !== 0 ? add : 0));
                const nf = capF(f + ((mask & 2) !== 0 ? add : 0));
                const nc = capC(c + ((mask & 4) !== 0 ? add : 0));
                withPicks[(used + add) * usedBase + stateIndex(ng, nf, nc)] = 1;
              }
            }
          }
        }
      }
    }
    for (let used = 0; used <= maxPicks; used += 1) {
      if (withPicks[used * usedBase + stateIndex(targetG, targetF, targetC)] === 1) return true;
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
    if (withPicks[used * usedBase + stateIndex(targetG, targetF, targetC)] === 1) return true;
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
  targets: {
    guards: number;
    forwards: number;
    centers: number;
  },
  startCounts: {
    guards: number;
    forwards: number;
    centers: number;
  },
  memberIds: readonly string[],
  maxPicks: number,
  outlierBudget?: MemberReachOutlierBudget,
): boolean {
  const targetG = targets.guards;
  const targetF = targets.forwards;
  const targetC = targets.centers;
  const strideF = targetC + 1;
  const strideG = strideF * (targetF + 1);
  const cap = (value: number, max: number): number => Math.min(max, value);
  if (outlierBudget === undefined) {
    const usedBase = strideG * (targetG + 1);
    const index = (g: number, f: number, c: number): number => g * strideG + f * strideF + c;
    if (maxPicks < 0) return false;
    if (
      cap(startCounts.guards, targetG) >= targetG &&
      cap(startCounts.forwards, targetF) >= targetF &&
      cap(startCounts.centers, targetC) >= targetC
    ) {
      return true;
    }
    const reachable = new Uint8Array(usedBase * (maxPicks + 1));
    reachable[
      index(
        cap(startCounts.guards, targetG),
        cap(startCounts.forwards, targetF),
        cap(startCounts.centers, targetC),
      )
    ] = 1;
    for (const id of memberIds) {
      const mask = state.maskByVersion.get(id) ?? 0;
      if (mask === 0) continue;
      for (let used = maxPicks - 1; used >= 0; used -= 1) {
        for (let g = targetG; g >= 0; g -= 1) {
          for (let f = targetF; f >= 0; f -= 1) {
            for (let c = targetC; c >= 0; c -= 1) {
              const idx = used * usedBase + index(g, f, c);
              if (reachable[idx] === 0) continue;
              reachable[
                (used + 1) * usedBase +
                  index(
                    cap(g + ((mask & 1) !== 0 ? 1 : 0), targetG),
                    cap(f + ((mask & 2) !== 0 ? 1 : 0), targetF),
                    cap(c + ((mask & 4) !== 0 ? 1 : 0), targetC),
                  )
              ] = 1;
            }
          }
        }
      }
    }
    for (let used = 0; used <= maxPicks; used += 1) {
      if (reachable[used * usedBase + index(targetG, targetF, targetC)] === 1) return true;
    }
    return false;
  }
  const { identity, capValue, startOutliers, maxOutliers } = outlierBudget;
  const strideO = strideG * (targetG + 1);
  const usedBase = strideO * (maxOutliers + 1);
  const index = (g: number, f: number, c: number, o: number): number =>
    g * strideG + f * strideF + c + o * strideO;
  if (maxPicks < 0 || startOutliers > maxOutliers) return false;
  if (
    cap(startCounts.guards, targetG) >= targetG &&
    cap(startCounts.forwards, targetF) >= targetF &&
    cap(startCounts.centers, targetC) >= targetC
  ) {
    return true;
  }
  const reachable = new Uint8Array(usedBase * (maxPicks + 1));
  reachable[
    index(
      cap(startCounts.guards, targetG),
      cap(startCounts.forwards, targetF),
      cap(startCounts.centers, targetC),
      startOutliers,
    )
  ] = 1;
  for (const id of memberIds) {
    const mask = state.maskByVersion.get(id) ?? 0;
    if (mask === 0) continue;
    const isOutlier = identityScoreOf(state, id, identity) > capValue ? 1 : 0;
    for (let used = maxPicks - 1; used >= 0; used -= 1) {
      for (let g = targetG; g >= 0; g -= 1) {
        for (let f = targetF; f >= 0; f -= 1) {
          for (let c = targetC; c >= 0; c -= 1) {
            for (let o = maxOutliers; o >= 0; o -= 1) {
              const idx = used * usedBase + index(g, f, c, o);
              if (reachable[idx] === 0) continue;
              if (o + isOutlier <= maxOutliers) {
                reachable[
                  (used + 1) * usedBase +
                    index(
                      cap(g + ((mask & 1) !== 0 ? 1 : 0), targetG),
                      cap(f + ((mask & 2) !== 0 ? 1 : 0), targetF),
                      cap(c + ((mask & 4) !== 0 ? 1 : 0), targetC),
                      o + isOutlier,
                    )
                ] = 1;
              }
            }
          }
        }
      }
    }
  }
  for (let used = 0; used <= maxPicks; used += 1) {
    for (let o = 0; o <= maxOutliers; o += 1) {
      if (reachable[used * usedBase + index(targetG, targetF, targetC, o)] === 1) return true;
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
  if (uncovered.length > slots) return false;
  let subsetMask = 0;
  for (const role of uncovered) {
    const index = ROSTER_ROLES.indexOf(role);
    if (index >= 0) subsetMask |= 1 << index;
  }
  const maskCounts = new Array<number>(1 << uncovered.length).fill(0);
  for (const id of memberIds) {
    const scores = state.roleScores.get(id);
    if (scores === undefined) continue;
    let coveredMask = 0;
    ROSTER_ROLES.forEach((role, roleIndex) => {
      if (scores[role] >= ROLE_COVERAGE_THRESHOLD) coveredMask |= 1 << roleIndex;
    });
    const masked = coveredMask & subsetMask;
    if (masked !== 0) maskCounts[masked] = (maskCounts[masked] ?? 0) + 1;
  }
  const full = (1 << uncovered.length) - 1;
  const reachable = new Uint8Array((slots + 1) * (full + 1));
  reachable[0] = 1;
  for (let pass = 0; pass <= slots; pass += 1) {
    const before = new Uint8Array(reachable);
    for (let mask = 1; mask <= full; mask += 1) {
      const count = maskCounts[mask] ?? 0;
      if (count === 0) continue;
      for (let used = slots - 1; used >= 0; used -= 1) {
        const maxAdd = Math.min(count, slots - used);
        for (let covered = full; covered >= 0; covered -= 1) {
          const idx = used * (full + 1) + covered;
          if (before[idx] === 0) continue;
          for (let add = 1; add <= maxAdd; add += 1) {
            reachable[(used + add) * (full + 1) + (covered | mask)] = 1;
          }
        }
      }
    }
    if (reachable[slots * (full + 1) + full] === 1) return true;
    let unchanged = true;
    for (let i = 0; i < reachable.length; i += 1) {
      if (reachable[i] !== before[i]) {
        unchanged = false;
        break;
      }
    }
    if (unchanged) break;
  }
  return reachable[slots * (full + 1) + full] === 1;
}
