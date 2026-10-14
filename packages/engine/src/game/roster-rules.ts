import type { Position } from '@hoop-rush/data-contracts';
import { POSITIONS, SEASON_ROSTER_RULES_VERSION } from '@hoop-rush/data-contracts';
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
    switch (position) {
      case 'PG':
      case 'SG':
        mask |= 1;
        break;
      case 'SF':
      case 'PF':
        mask |= 2;
        break;
      case 'C':
        mask |= 4;
        break;
      default:
        break;
    }
  }
  return mask;
}
export function positionMaskOf(playable: readonly Position[]): number {
  let mask = 0;
  for (const position of playable) {
    const index = POSITIONS.indexOf(position);
    if (index >= 0) mask |= 1 << index;
  }
  return mask;
}
export function positionCountsOf(members: readonly SeasonRosterMemberInput[]): number[] {
  const counts = new Array<number>(POSITIONS.length).fill(0);
  for (const member of members) {
    const mask = positionMaskOf(member.playable);
    for (let p = 0; p < POSITIONS.length; p += 1) {
      if ((mask & (1 << p)) !== 0) counts[p] = (counts[p] ?? 0) + 1;
    }
  }
  return counts;
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
    const mask = positionMaskOf(member.playable);
    if (mask === 0) continue;
    let next = reachable;
    for (let state = 0; state < 32; state += 1) {
      if ((reachable & (1 << state)) === 0) continue;
      for (let slot = 0; slot < POSITIONS.length; slot += 1) {
        const bit = 1 << slot;
        if ((mask & bit) === 0 || (state & bit) !== 0) continue;
        next |= 1 << (state | bit);
      }
    }
    reachable = next;
  }
  return (reachable & (1 << 31)) !== 0;
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
    failures.push('roster has no legal PG,SG,SF,PF,C starting five');
  }
  return failures;
}
function popcount(mask: number): number {
  let count = 0;
  while (mask !== 0) {
    mask &= mask - 1;
    count += 1;
  }
  return count;
}
function coverCount(members: readonly SeasonRosterMemberInput[], subset: number): number {
  let cover = 0;
  for (const member of members) {
    if ((positionMaskOf(member.playable) & subset) !== 0) cover += 1;
  }
  return cover;
}
export function rosterFeasibleFromCounts(
  ownedCounts: readonly number[],
  availableMaskCounts: readonly number[],
  remainingPicks: number,
): boolean {
  if (!Number.isInteger(remainingPicks) || remainingPicks < 0) {
    throw new Error(`remainingPicks must be a nonnegative integer (got ${String(remainingPicks)})`);
  }
  const slots = POSITIONS.length;
  for (let subset = 1; subset < 1 << slots; subset += 1) {
    const size = popcount(subset);
    let ownedCover = 0;
    for (let p = 0; p < slots; p += 1) {
      if ((subset & (1 << p)) === 0) continue;
      ownedCover += Math.min(ownedCounts[p] ?? 0, size);
    }
    let availableCover = 0;
    for (let mask = 1; mask < 1 << slots; mask += 1) {
      if ((mask & subset) === 0) continue;
      availableCover += availableMaskCounts[mask] ?? 0;
    }
    if (ownedCover + Math.min(availableCover, remainingPicks) < size) return false;
  }
  return true;
}
export function rosterFeasible(
  owned: readonly SeasonRosterMemberInput[],
  available: readonly SeasonRosterMemberInput[],
  remainingPicks: number,
): boolean {
  return rosterFeasibleFromCounts(
    positionCountsOf(owned),
    maskCountsOfMembers(available),
    remainingPicks,
  );
}
export function fiveAliveFromCounts(
  ownedMaskCounts: readonly number[],
  availableMaskCounts: readonly number[],
  remainingPicks: number,
): boolean {
  if (!Number.isInteger(remainingPicks) || remainingPicks < 0) {
    throw new Error(`remainingPicks must be a nonnegative integer (got ${String(remainingPicks)})`);
  }
  const slots = POSITIONS.length;
  for (let subset = 1; subset < 1 << slots; subset += 1) {
    let ownCover = 0;
    let availableCover = 0;
    for (let mask = 1; mask < 1 << slots; mask += 1) {
      if ((mask & subset) === 0) continue;
      ownCover += ownedMaskCounts[mask] ?? 0;
      availableCover += availableMaskCounts[mask] ?? 0;
    }
    const futureCover = Math.max(0, availableCover - ownCover);
    if (ownCover + Math.min(futureCover, remainingPicks) < popcount(subset)) {
      return false;
    }
  }
  return true;
}
export function fiveAlive(
  owned: readonly SeasonRosterMemberInput[],
  available: readonly SeasonRosterMemberInput[],
  remainingPicks: number,
): boolean {
  const ownedMaskCounts = maskCountsOfMembers(owned);
  return fiveAliveFromCounts(ownedMaskCounts, maskCountsOfMembers(available), remainingPicks);
}
function maskCountsOfMembers(members: readonly SeasonRosterMemberInput[]): number[] {
  const counts = new Array<number>(1 << POSITIONS.length).fill(0);
  for (const member of members) {
    const mask = positionMaskOf(member.playable);
    if (mask !== 0) counts[mask] = (counts[mask] ?? 0) + 1;
  }
  return counts;
}
export function fiveCompletable(
  owned: readonly SeasonRosterMemberInput[],
  available: readonly SeasonRosterMemberInput[],
  remainingPicks: number,
  scarcityMargin = 0,
): boolean {
  if (!Number.isInteger(remainingPicks) || remainingPicks < 0) return false;
  if (!Number.isInteger(scarcityMargin) || scarcityMargin < 0) return false;
  if (owned.length + remainingPicks !== SEASON_ROSTER_SIZE) return false;
  if (available.length - scarcityMargin < remainingPicks) return false;
  const slots = POSITIONS.length;
  for (let subset = 1; subset < 1 << slots; subset += 1) {
    const size = popcount(subset);
    const ownedCover = coverCount(owned, subset);
    const availableCover = coverCount(available, subset);
    const effective = Math.max(0, Math.min(availableCover - scarcityMargin, remainingPicks));
    if (ownedCover + effective < size) return false;
  }
  return true;
}
