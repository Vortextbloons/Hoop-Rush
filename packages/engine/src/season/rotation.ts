import { SEASON_ROTATION_VERSION, type SeasonRotation } from '@hoop-rush/data-contracts';
import type { Position } from '@hoop-rush/data-contracts';
import { legalFiveExists, type SeasonRosterMemberInput } from './roster-rules.js';
import { canPlay } from '../domain/positions.js';

/**
 * Minimal M2.1 rotation builder (spec/2.0/04, season-rotation-v1). Five
 * slot-assigned starters (G, G, F, F, C) play 32 minutes each and the five
 * bench players play 16 each, totals equal exactly 240, and the closing five
 * initially equals the starters. The legal-five matching is deterministic:
 * members are canonically sorted by playerVersionId and the first legal
 * slot assignment is found by backtracking in slot order. M2.2 adds presets,
 * editing, substitution execution, and contingency behavior without replacing
 * this persisted rotation contract.
 */

const STARTING_SLOTS: Array<'G' | 'F' | 'C'> = ['G', 'G', 'F', 'F', 'C'];

/**
 * Deterministic legal-five matching in canonical member order. Returns the
 * five starters in slot order 0..4, or null when no legal five exists.
 */
export function matchStartingFive(
  members: readonly SeasonRosterMemberInput[],
): SeasonRosterMemberInput[] | null {
  const ordered = [...members].sort((a, b) =>
    a.playerVersionId < b.playerVersionId ? -1 : a.playerVersionId > b.playerVersionId ? 1 : 0,
  );
  if (!legalFiveExists(ordered)) return null;
  const used = new Set<number>();
  const result: SeasonRosterMemberInput[] = [];
  const solve = (slot: number): boolean => {
    if (slot >= STARTING_SLOTS.length) return true;
    const requirement = STARTING_SLOTS[slot];
    if (requirement === undefined) return false;
    for (let i = 0; i < ordered.length; i += 1) {
      const member = ordered[i];
      if (member === undefined) continue;
      if (used.has(i)) continue;
      if (!canPlay(member.playable, requirement)) continue;
      used.add(i);
      result.push(member);
      if (solve(slot + 1)) return true;
      result.pop();
      used.delete(i);
    }
    return false;
  };
  if (!solve(0)) return null;
  return result;
}

/**
 * Builds the minimal M2.1 rotation for a ten-player roster. Throws when the
 * roster cannot field a legal starting five.
 */
export function buildMinimalRotation(input: {
  franchiseId: string;
  members: SeasonRosterMemberInput[];
}): SeasonRotation {
  if (input.members.length !== 10) {
    throw new Error(`rotation requires exactly ten members (got ${String(input.members.length)})`);
  }
  const starters = matchStartingFive(input.members);
  if (starters === null) {
    const detail = input.members
      .map((member) => `${member.playerVersionId}:${member.playable.join('|')}`)
      .join(' ');
    throw new Error(`roster has no legal G,G,F,F,C starting five: ${detail}`);
  }
  const starterIds = new Set(starters.map((member) => member.playerVersionId));
  const bench = [...input.members]
    .filter((member) => !starterIds.has(member.playerVersionId))
    .sort((a, b) => (a.playerVersionId < b.playerVersionId ? -1 : 1));
  const starterOrder = starters.map((member) => member.playerVersionId);
  const benchOrder = bench.map((member) => member.playerVersionId);
  return {
    franchiseId: input.franchiseId,
    starters: starterOrder,
    benchOrder,
    targetMinutes: [
      ...starterOrder.map((playerVersionId) => ({ playerVersionId, minutes: 32 })),
      ...benchOrder.map((playerVersionId) => ({ playerVersionId, minutes: 16 })),
    ],
    closingFive: starterOrder,
    rotationVersion: SEASON_ROTATION_VERSION,
  };
}

/** Total of the rotation's target minutes (must equal 240). */
export function rotationTargetMinutes(rotation: SeasonRotation): number {
  return rotation.targetMinutes.reduce((sum, entry) => sum + entry.minutes, 0);
}

/** Audits a rotation against the M2.1 contract; returns failure strings. */
export function auditSeasonRotation(
  rotation: SeasonRotation,
  memberPlayable: ReadonlyMap<string, readonly Position[]>,
): string[] {
  const failures: string[] = [];
  // rotationVersion is a schema literal; a stored value that differs is
  // rejected at the runtime boundary before this audit runs.
  const all = [...rotation.starters, ...rotation.benchOrder];
  if (all.length !== 10) {
    failures.push('rotation must reference exactly ten players');
  }
  if (new Set(all).size !== all.length) {
    failures.push('rotation references duplicate players');
  }
  const minutes = rotationTargetMinutes(rotation);
  if (minutes !== 240) {
    failures.push(`target minutes must total 240 (got ${String(minutes)})`);
  }
  for (const entry of rotation.targetMinutes) {
    if (!all.includes(entry.playerVersionId)) {
      failures.push(`target minutes reference an unrostered player ${entry.playerVersionId}`);
    }
  }
  const starterSet = new Set(rotation.starters);
  if (starterSet.size !== 5) failures.push('starters must be five distinct players');
  if (
    rotation.closingFive.length !== 5 ||
    !rotation.closingFive.every((id) => starterSet.has(id))
  ) {
    failures.push('M2.1 closing five must equal the starters');
  }
  const slotCounts = { G: 0, F: 0, C: 0 } as const;
  for (const starterId of rotation.starters) {
    const playable = memberPlayable.get(starterId);
    if (!playable) {
      failures.push(`no position data for starter ${starterId}`);
      continue;
    }
    const slotIndex = rotation.starters.indexOf(starterId);
    const requirement = STARTING_SLOTS[slotIndex];
    if (requirement === undefined || !canPlay(playable, requirement)) {
      failures.push(`starter ${starterId} cannot play slot ${String(slotIndex)}`);
    }
  }
  void slotCounts;
  return failures;
}
