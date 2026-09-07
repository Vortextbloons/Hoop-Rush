import type { Position } from '@hoop-rush/data-contracts';
import { slotGroupOf } from '../domain/positions.ts';
import { SEASON_ROSTER_RULES_VERSION } from '@hoop-rush/data-contracts';
export const SEASON_ROSTER_RULES = {
  version: SEASON_ROSTER_RULES_VERSION,
  size: 10,
} as const;
export const SEASON_ROSTER_SIZE = SEASON_ROSTER_RULES.size;
export interface SeasonRosterMemberInput {
  playerVersionId: string;
  playable: readonly Position[];
}
export function groupMaskOf(playable: readonly Position[]): number {
  let mask = 0;
  for (const position of playable) {
    const group = slotGroupOf(position);
    if (group === 'G') mask |= 1;
    else if (group === 'F') mask |= 2;
    else mask |= 4;
  }
  return mask;
}
export function rosterGroupCounts(members: readonly SeasonRosterMemberInput[]): {
  guards: number;
  forwards: number;
  centers: number;
} {
  let guards = 0;
  let forwards = 0;
  let centers = 0;
  for (const member of members) {
    const mask = groupMaskOf(member.playable);
    if ((mask & 1) !== 0) guards += 1;
    if ((mask & 2) !== 0) forwards += 1;
    if ((mask & 4) !== 0) centers += 1;
  }
  return { guards, forwards, centers };
}
export function legalFiveExists(members: readonly SeasonRosterMemberInput[]): boolean {
  let reachable = 1;
  for (const member of members) {
    const mask = groupMaskOf(member.playable);
    const next = new Set<number>();
    for (let state = 0; state < 18; state += 1) {
      if ((reachable & (1 << state)) === 0) continue;
      const g = Math.floor(state / 6);
      const f = Math.floor((state % 6) / 2);
      const c = state % 2;
      next.add(state);
      if ((mask & 1) !== 0 && g < 2) next.add((g + 1) * 6 + f * 2 + c);
      if ((mask & 2) !== 0 && f < 2) next.add(g * 6 + (f + 1) * 2 + c);
      if ((mask & 4) !== 0 && c < 1) next.add(g * 6 + f * 2 + 1);
    }
    reachable = 0;
    for (const state of next) reachable |= 1 << state;
  }
  return (reachable & (1 << 17)) !== 0;
}
export function legalFiveAfterAnyRemoval(members: readonly SeasonRosterMemberInput[]): boolean {
  for (let remove = 0; remove < members.length; remove += 1) {
    const remaining: SeasonRosterMemberInput[] = [];
    for (let i = 0; i < members.length; i += 1) {
      const member = members[i];
      if (member === undefined) continue;
      if (i !== remove) remaining.push(member);
    }
    if (!legalFiveExists(remaining)) return false;
  }
  return true;
}
export function validateSeasonRoster(members: readonly SeasonRosterMemberInput[]): string[] {
  const failures: string[] = [];
  const ids = members.map((member) => member.playerVersionId);
  if (ids.length !== SEASON_ROSTER_RULES.size) {
    failures.push(
      `roster must have exactly ${String(SEASON_ROSTER_RULES.size)} players (got ${String(ids.length)})`,
    );
  }
  if (new Set(ids).size !== ids.length) {
    failures.push('roster must contain ten distinct playerVersionIds');
  }
  if (!legalFiveExists(members)) {
    failures.push('roster has no legal G,G,F,F,C starting five');
  }
  return failures;
}
export function rosterFeasibleFromCounts(
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
  const startG = Math.min(2, ownedCounts.guards);
  const startF = Math.min(2, ownedCounts.forwards);
  const startC = Math.min(1, ownedCounts.centers);
  if (startG >= 2 && startF >= 2 && startC >= 1) return true;
  const usedBase = 18;
  const stateCount = usedBase * (remainingPicks + 1);
  const reachable = new Uint8Array(stateCount);
  const targetUsed = remainingPicks;
  const targetG = 2;
  const targetF = 2;
  const targetC = 1;
  reachable[startG * 6 + startF * 2 + startC] = 1;
  for (let mask = 1; mask <= 7; mask += 1) {
    const count = availableMaskCounts[mask] ?? 0;
    if (count === 0) continue;
    for (let used = targetUsed - 1; used >= 0; used -= 1) {
      const maxAdd = Math.min(count, targetUsed - used);
      for (let g = targetG; g >= 0; g -= 1) {
        for (let f = targetF; f >= 0; f -= 1) {
          for (let c = targetC; c >= 0; c -= 1) {
            const idx = used * usedBase + g * 6 + f * 2 + c;
            if (reachable[idx] === 0) continue;
            for (let add = 1; add <= maxAdd; add += 1) {
              const ng = Math.min(targetG, g + ((mask & 1) !== 0 ? add : 0));
              const nf = Math.min(targetF, f + ((mask & 2) !== 0 ? add : 0));
              const nc = Math.min(targetC, c + ((mask & 4) !== 0 ? add : 0));
              const nidx = (used + add) * usedBase + ng * 6 + nf * 2 + nc;
              reachable[nidx] = 1;
            }
          }
        }
      }
    }
    if (reachable[targetUsed * usedBase + targetG * 6 + targetF * 2 + targetC] === 1) {
      return true;
    }
  }
  return reachable[targetUsed * usedBase + targetG * 6 + targetF * 2 + targetC] === 1;
}
export function rosterFeasible(
  owned: readonly SeasonRosterMemberInput[],
  available: readonly SeasonRosterMemberInput[],
  remainingPicks: number,
): boolean {
  const ownedCounts = rosterGroupCounts(owned);
  const maskCounts = new Array<number>(8).fill(0);
  for (const member of available) {
    const mask = groupMaskOf(member.playable);
    if (mask !== 0) maskCounts[mask] = (maskCounts[mask] ?? 0) + 1;
  }
  return rosterFeasibleFromCounts(ownedCounts, maskCounts, remainingPicks);
}
export function fiveCompletable(
  owned: readonly SeasonRosterMemberInput[],
  available: readonly SeasonRosterMemberInput[],
  remainingPicks: number,
  scarcityMargin = 0,
): boolean {
  if (!Number.isInteger(remainingPicks) || remainingPicks < 0) return false;
  if (!Number.isInteger(scarcityMargin) || scarcityMargin < 0) return false;
  if (owned.length + remainingPicks !== SEASON_ROSTER_RULES.size) return false;
  if (available.length - scarcityMargin < remainingPicks) return false;
  const targetG = 2;
  const targetF = 2;
  const targetC = 1;
  const capU = Math.min(remainingPicks, 5);
  const index = (g: number, f: number, c: number, u: number): number =>
    ((u * (targetC + 1) + c) * (targetF + 1) + f) * (targetG + 1) + g;
  let reachable = new Uint8Array((targetG + 1) * (targetF + 1) * (targetC + 1) * (capU + 1));
  reachable[index(0, 0, 0, 0)] = 1;
  for (const member of owned) {
    const mask = groupMaskOf(member.playable);
    if (mask === 0) continue;
    for (let u = 0; u <= capU; u += 1) {
      for (let g = targetG; g >= 0; g -= 1) {
        for (let f = targetF; f >= 0; f -= 1) {
          for (let c = targetC; c >= 0; c -= 1) {
            if (reachable[index(g, f, c, u)] === 0) continue;
            if ((mask & 1) !== 0) {
              reachable[index(Math.min(targetG, g + 1), f, c, u)] = 1;
            }
            if ((mask & 2) !== 0) {
              reachable[index(g, Math.min(targetF, f + 1), c, u)] = 1;
            }
            if ((mask & 4) !== 0) {
              reachable[index(g, f, Math.min(targetC, c + 1), u)] = 1;
            }
          }
        }
      }
    }
  }
  const maskCounts = new Array<number>(8).fill(0);
  for (const member of available) {
    const mask = groupMaskOf(member.playable);
    if (mask !== 0) maskCounts[mask] = (maskCounts[mask] ?? 0) + 1;
  }
  for (let mask = 1; mask <= 7; mask += 1) {
    const takes = Math.min(Math.max(0, (maskCounts[mask] ?? 0) - scarcityMargin), 5, capU);
    for (let t = 0; t < takes; t += 1) {
      for (let u = capU - 1; u >= 0; u -= 1) {
        for (let g = targetG; g >= 0; g -= 1) {
          for (let f = targetF; f >= 0; f -= 1) {
            for (let c = targetC; c >= 0; c -= 1) {
              if (reachable[index(g, f, c, u)] === 0) continue;
              if ((mask & 1) !== 0) {
                reachable[index(Math.min(targetG, g + 1), f, c, u + 1)] = 1;
              }
              if ((mask & 2) !== 0) {
                reachable[index(g, Math.min(targetF, f + 1), c, u + 1)] = 1;
              }
              if ((mask & 4) !== 0) {
                reachable[index(g, f, Math.min(targetC, c + 1), u + 1)] = 1;
              }
            }
          }
        }
      }
    }
  }
  for (let u = 0; u <= capU; u += 1) {
    if (reachable[index(targetG, targetF, targetC, u)] === 1) return true;
  }
  return false;
}
