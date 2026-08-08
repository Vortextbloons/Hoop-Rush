import {
  SEASON_ROTATION_PRESET_TARGETS,
  SEASON_ROTATION_VERSION,
  seasonDigestHex,
  type SeasonRotation,
  type SeasonRotationCommandResult,
  type SeasonRotationPreset,
  type SeasonRotationRejectionCode,
  type SetSeasonRotationCommand,
} from '@hoop-rush/data-contracts';
import type { Position } from '@hoop-rush/data-contracts';
import { legalFiveExists, type SeasonRosterMemberInput } from './roster-rules.ts';
import { canPlay } from '../domain/positions.ts';

/**
 * Minimal M2.1 rotation builder (spec/2.0/04, season-rotation-v1). Five
 * slot-assigned starters (G, G, F, F, C) play 32 minutes each and the five
 * bench players play 16 each, totals equal exactly 240, and the closing five
 * initially equals the starters. The legal-five matching is deterministic:
 * members are canonically sorted by playerVersionId and the first legal
 * slot assignment is found by backtracking in slot order. An optional
 * `order` comparator (projection milestone) makes the matching and the bench
 * hierarchy talent-ordered for callers that can score members (AI
 * generation); the default stays byte-identical. M2.2 adds presets,
 * editing, substitution execution, and contingency behavior without replacing
 * this persisted rotation contract.
 */

const STARTING_SLOTS: Array<'G' | 'F' | 'C'> = ['G', 'G', 'F', 'F', 'C'];

function canonicalOrder(a: SeasonRosterMemberInput, b: SeasonRosterMemberInput): number {
  return a.playerVersionId < b.playerVersionId ? -1 : a.playerVersionId > b.playerVersionId ? 1 : 0;
}

/**
 * Deterministic legal-five matching. With no `order`, members are canonically
 * sorted and the first legal slot assignment is found by backtracking in slot
 * order; with `order`, the same search runs over the ordered list, so the
 * first legal five is the strongest under the caller's comparator. Returns
 * the five starters in slot order 0..4, or null when no legal five exists.
 */
export function matchStartingFive(
  members: readonly SeasonRosterMemberInput[],
  order?: (a: SeasonRosterMemberInput, b: SeasonRosterMemberInput) => number,
): SeasonRosterMemberInput[] | null {
  const ordered = [...members].sort(order ?? canonicalOrder);
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
 * roster cannot field a legal starting five. With an `order` comparator the
 * starters are the strongest legal five under it and the bench hierarchy
 * follows the same order (best remaining player first); the default is
 * byte-identical canonical behavior.
 */
export function buildMinimalRotation(input: {
  franchiseId: string;
  members: SeasonRosterMemberInput[];
  order?: (a: SeasonRosterMemberInput, b: SeasonRosterMemberInput) => number;
}): SeasonRotation {
  if (input.members.length !== 10) {
    throw new Error(`rotation requires exactly ten members (got ${String(input.members.length)})`);
  }
  const starters = matchStartingFive(input.members, input.order);
  if (starters === null) {
    const detail = input.members
      .map((member) => `${member.playerVersionId}:${member.playable.join('|')}`)
      .join(' ');
    throw new Error(`roster has no legal G,G,F,F,C starting five: ${detail}`);
  }
  const starterIds = new Set(starters.map((member) => member.playerVersionId));
  const sort = input.order ?? canonicalOrder;
  const bench = [...input.members]
    .filter((member) => !starterIds.has(member.playerVersionId))
    .sort(sort);
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

/**
 * Canonical digest of the locked 30-rotation set (spec/2.0/07 M2.3). Sort by
 * franchiseId; include starters, bench order, target minutes sorted by
 * playerVersionId, the closing five, and the rotation version; hash with
 * `seasonDigestHex`. Identical sets hash identically regardless of input
 * order, so a stale or tampered block lock is rejected before any simulation
 * runs.
 */
export function seasonRotationSetDigest(rotations: readonly SeasonRotation[]): string {
  const canonical = [...rotations]
    .sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1))
    .map((rotation) => ({
      franchiseId: rotation.franchiseId,
      starters: rotation.starters,
      benchOrder: rotation.benchOrder,
      targetMinutes: [...rotation.targetMinutes].sort((a, b) =>
        a.playerVersionId < b.playerVersionId ? -1 : 1,
      ),
      closingFive: rotation.closingFive,
      rotationVersion: rotation.rotationVersion,
    }));
  return seasonDigestHex(JSON.stringify(canonical));
}

/**
 * Audits a rotation against the M2.2 contract (season-rotation-v2): starter
 * and closing fives are independently legal ordered fives, the partition
 * covers the roster exactly with no duplicates, and target minutes are
 * integers 0-48 totaling exactly 240. Equivalent to validateSeasonRotation;
 * kept as the authoritative audit export.
 */
export function auditSeasonRotation(
  rotation: SeasonRotation,
  memberPlayable: ReadonlyMap<string, readonly Position[]>,
): string[] {
  return validateSeasonRotation(rotation, memberPlayable);
}

/**
 * M2.2 v2 rotation validation (season-rotation-v2, spec/2.0/04): the
 * starter/bench partition references exactly the ten rostered versions with
 * no duplicates, target minutes are integers from 0-48 totaling exactly 240
 * and covering exactly the roster, the starters form a legal ordered
 * G, G, F, F, C five in their configured slot order, and the closing five
 * is an independent ordered legal five (which may differ from the starters
 * and include bench players). Returns failure strings; empty means valid.
 */
export function validateSeasonRotation(
  rotation: SeasonRotation,
  memberPlayable: ReadonlyMap<string, readonly Position[]>,
): string[] {
  const failures: string[] = [];
  const partition = [...rotation.starters, ...rotation.benchOrder];

  if (rotation.starters.length !== 5 || rotation.benchOrder.length !== 5) {
    failures.push(
      `rotation must reference exactly ten players (got ${String(rotation.starters.length)} starters and ${String(rotation.benchOrder.length)} bench)`,
    );
  }
  if (new Set(partition).size !== partition.length) {
    failures.push('rotation references duplicate players');
  }
  for (const playerVersionId of partition) {
    if (!memberPlayable.has(playerVersionId)) {
      failures.push(`rotation references an unrostered player ${playerVersionId}`);
    }
  }
  for (const playerVersionId of memberPlayable.keys()) {
    if (!partition.includes(playerVersionId)) {
      failures.push(`rotation omits rostered player ${playerVersionId}`);
    }
  }

  const minuteIds = rotation.targetMinutes.map((entry) => entry.playerVersionId);
  if (rotation.targetMinutes.length !== 10) {
    failures.push(
      `rotation must have exactly ten target-minute entries (got ${String(rotation.targetMinutes.length)})`,
    );
  }
  if (new Set(minuteIds).size !== minuteIds.length) {
    failures.push('target minutes reference duplicate players');
  }
  for (const entry of rotation.targetMinutes) {
    if (!partition.includes(entry.playerVersionId)) {
      failures.push(`target minutes reference an unrostered player ${entry.playerVersionId}`);
    }
    if (!Number.isInteger(entry.minutes) || entry.minutes < 0 || entry.minutes > 48) {
      failures.push(
        `target minutes for ${entry.playerVersionId} must be an integer from 0-48 (got ${String(entry.minutes)})`,
      );
    }
  }
  for (const playerVersionId of partition) {
    if (!minuteIds.includes(playerVersionId)) {
      failures.push(`no target minutes for rostered player ${playerVersionId}`);
    }
  }
  const total = rotationTargetMinutes(rotation);
  if (total !== 240) {
    failures.push(`target minutes must total 240 (got ${String(total)})`);
  }

  for (const starterId of rotation.starters) {
    const playable = memberPlayable.get(starterId);
    if (playable === undefined) {
      failures.push(`no position data for starter ${starterId}`);
      continue;
    }
    const slotIndex = rotation.starters.indexOf(starterId);
    const requirement = STARTING_SLOTS[slotIndex];
    if (requirement === undefined || !canPlay(playable, requirement)) {
      failures.push(`starter ${starterId} cannot play slot ${String(slotIndex)}`);
    }
  }

  if (rotation.closingFive.length !== 5) {
    failures.push(
      `closing five must contain exactly five players (got ${String(rotation.closingFive.length)})`,
    );
  } else if (new Set(rotation.closingFive).size !== 5) {
    failures.push('closing five must be five distinct players');
  } else {
    for (const playerVersionId of rotation.closingFive) {
      if (!partition.includes(playerVersionId)) {
        failures.push(`closing five references an unrostered player ${playerVersionId}`);
      }
    }
    for (const closingId of rotation.closingFive) {
      const playable = memberPlayable.get(closingId);
      if (playable === undefined) {
        failures.push(`no position data for closing-five player ${closingId}`);
        continue;
      }
      const slotIndex = rotation.closingFive.indexOf(closingId);
      const requirement = STARTING_SLOTS[slotIndex];
      if (requirement === undefined || !canPlay(playable, requirement)) {
        failures.push(`closing-five player ${closingId} cannot play slot ${String(slotIndex)}`);
      }
    }
  }

  return failures;
}

/**
 * M2.2 preset application: rewrites ONLY the target minutes using the frozen
 * preset tables (SEASON_ROTATION_PRESET_TARGETS: Balanced 33 each starter /
 * bench 21,18,15,12,9; Tight 37 / 20,14,9,7,5; Bench-Heavy 29 /
 * 23,21,19,17,15). The current starter order, bench hierarchy, and closing
 * five are preserved exactly. Returns a new rotation; the input is untouched.
 */
export function applySeasonRotationPreset(
  rotation: SeasonRotation,
  preset: SeasonRotationPreset,
): SeasonRotation {
  const table = SEASON_ROTATION_PRESET_TARGETS[preset];
  return {
    ...rotation,
    targetMinutes: [
      ...rotation.starters.map((playerVersionId) => ({
        playerVersionId,
        minutes: table.starters,
      })),
      ...rotation.benchOrder.map((playerVersionId, index) => {
        const benchMinutes = table.bench[index];
        if (benchMinutes === undefined) {
          throw new Error(`preset ${preset} has no minutes for bench role ${String(index)}`);
        }
        return { playerVersionId, minutes: benchMinutes };
      }),
    ],
  };
}

/**
 * First M2.2 rejection for an explicit-rotation command, in fixed priority
 * order: duplicates, roster/partition correspondence, target values, starter
 * slot legality, then closing-five slot legality. Returns null when the
 * rotation is valid. The category mapping is the authoritative translation
 * of the audit failures into the fixed rejection codes.
 */
function firstRotationRejection(
  rotation: SeasonRotation,
  memberPlayable: ReadonlyMap<string, readonly Position[]>,
): { code: SeasonRotationRejectionCode; message: string } | null {
  const partition = [...rotation.starters, ...rotation.benchOrder];
  const partitionSet = new Set(partition);
  const minuteIds = rotation.targetMinutes.map((entry) => entry.playerVersionId);

  if (partitionSet.size !== partition.length) {
    return { code: 'DUPLICATE_PLAYER_VERSION', message: 'rotation references duplicate players' };
  }
  if (new Set(minuteIds).size !== minuteIds.length) {
    return {
      code: 'DUPLICATE_PLAYER_VERSION',
      message: 'target minutes reference duplicate players',
    };
  }

  if (rotation.starters.length !== 5 || rotation.benchOrder.length !== 5) {
    return {
      code: 'ROSTER_MISMATCH',
      message: `rotation must reference exactly ten players (got ${String(rotation.starters.length)} starters and ${String(rotation.benchOrder.length)} bench)`,
    };
  }
  for (const playerVersionId of partition) {
    if (!memberPlayable.has(playerVersionId)) {
      return {
        code: 'ROSTER_MISMATCH',
        message: `rotation references an unrostered player ${playerVersionId}`,
      };
    }
  }
  for (const playerVersionId of memberPlayable.keys()) {
    if (!partitionSet.has(playerVersionId)) {
      return {
        code: 'ROSTER_MISMATCH',
        message: `rotation omits rostered player ${playerVersionId}`,
      };
    }
  }
  if (rotation.targetMinutes.length !== 10) {
    return {
      code: 'ROSTER_MISMATCH',
      message: `rotation must have exactly ten target-minute entries (got ${String(rotation.targetMinutes.length)})`,
    };
  }
  for (const entry of rotation.targetMinutes) {
    if (!partitionSet.has(entry.playerVersionId)) {
      return {
        code: 'ROSTER_MISMATCH',
        message: `target minutes reference an unrostered player ${entry.playerVersionId}`,
      };
    }
  }
  for (const playerVersionId of partition) {
    if (!minuteIds.includes(playerVersionId)) {
      return {
        code: 'ROSTER_MISMATCH',
        message: `no target minutes for rostered player ${playerVersionId}`,
      };
    }
  }
  for (const playerVersionId of rotation.closingFive) {
    if (!partitionSet.has(playerVersionId)) {
      return {
        code: 'ROSTER_MISMATCH',
        message: `closing five references an unrostered player ${playerVersionId}`,
      };
    }
  }

  for (const entry of rotation.targetMinutes) {
    if (!Number.isInteger(entry.minutes) || entry.minutes < 0 || entry.minutes > 48) {
      return {
        code: 'INVALID_TARGETS',
        message: `target minutes for ${entry.playerVersionId} must be an integer from 0-48 (got ${String(entry.minutes)})`,
      };
    }
  }
  const total = rotationTargetMinutes(rotation);
  if (total !== 240) {
    return {
      code: 'INVALID_TARGETS',
      message: `target minutes must total 240 (got ${String(total)})`,
    };
  }

  for (const starterId of rotation.starters) {
    const playable = memberPlayable.get(starterId);
    const slotIndex = rotation.starters.indexOf(starterId);
    const requirement = STARTING_SLOTS[slotIndex];
    if (playable === undefined || requirement === undefined || !canPlay(playable, requirement)) {
      return {
        code: 'ILLEGAL_STARTERS',
        message: `starter ${starterId} cannot play slot ${String(slotIndex)}`,
      };
    }
  }

  if (rotation.closingFive.length !== 5 || new Set(rotation.closingFive).size !== 5) {
    return {
      code: 'ILLEGAL_CLOSING_FIVE',
      message: 'closing five must be five distinct players',
    };
  }
  for (const closingId of rotation.closingFive) {
    const playable = memberPlayable.get(closingId);
    const slotIndex = rotation.closingFive.indexOf(closingId);
    const requirement = STARTING_SLOTS[slotIndex];
    if (playable === undefined || requirement === undefined || !canPlay(playable, requirement)) {
      return {
        code: 'ILLEGAL_CLOSING_FIVE',
        message: `closing-five player ${closingId} cannot play slot ${String(slotIndex)}`,
      };
    }
  }

  return null;
}

/**
 * M2.2 typed rotation-editing command handler. Preset commands rewrite target
 * minutes and preserve the current starter order, bench hierarchy, and
 * closing five; explicit-rotation commands replace the rotation wholesale.
 * Rejection codes are fixed as ROSTER_MISMATCH, DUPLICATE_PLAYER_VERSION,
 * INVALID_TARGETS, ILLEGAL_STARTERS, and ILLEGAL_CLOSING_FIVE.
 *
 * Command shapes that carry neither a preset nor a rotation (or both) are
 * rejected before handling with INVALID_TARGETS and the schema's own stable
 * messages. A preset command preserves `currentRotation` when the caller
 * supplies it (the persisted rotation); otherwise the base rotation is
 * derived deterministically from the roster (matchStartingFive, canonical
 * bench), so the preset rewrites only the target minutes exactly like
 * applySeasonRotationPreset. An explicit-rotation command is validated with
 * the fixed-code mapping above and returned wholesale when accepted.
 */
export function handleSetSeasonRotationCommand(
  command: SetSeasonRotationCommand,
  memberPlayable: ReadonlyMap<string, readonly Position[]>,
  currentRotation?: SeasonRotation,
): SeasonRotationCommandResult {
  const rejected = (
    errorCode: SeasonRotationRejectionCode,
    message: string,
  ): SeasonRotationCommandResult => ({
    status: 'rejected',
    commandId: command.commandId,
    franchiseId: command.franchiseId,
    errorCode,
    message,
  });

  if (command.preset === null && command.rotation === null) {
    return rejected('INVALID_TARGETS', 'set-season-rotation needs a preset or rotation');
  }
  if (command.preset !== null && command.rotation !== null) {
    return rejected('INVALID_TARGETS', 'set-season-rotation takes preset or rotation, not both');
  }

  if (command.preset !== null) {
    if (currentRotation !== undefined) {
      const currentRejection = firstRotationRejection(currentRotation, memberPlayable);
      if (currentRejection !== null) {
        return rejected(currentRejection.code, currentRejection.message);
      }
      return {
        status: 'accepted',
        commandId: command.commandId,
        franchiseId: command.franchiseId,
        rotation: applySeasonRotationPreset(currentRotation, command.preset),
      };
    }
    const members: SeasonRosterMemberInput[] = [...memberPlayable.entries()].map(
      ([playerVersionId, playable]) => ({ playerVersionId, playable }),
    );
    if (members.length !== 10) {
      return rejected(
        'ROSTER_MISMATCH',
        `rotation needs exactly ten rostered players (got ${String(members.length)})`,
      );
    }
    if (matchStartingFive(members) === null) {
      return rejected('ILLEGAL_STARTERS', 'roster has no legal G,G,F,F,C starting five');
    }
    const base = buildMinimalRotation({ franchiseId: command.franchiseId, members });
    return {
      status: 'accepted',
      commandId: command.commandId,
      franchiseId: command.franchiseId,
      rotation: applySeasonRotationPreset(base, command.preset),
    };
  }

  const rotation = command.rotation;
  if (rotation === null) {
    return rejected('INVALID_TARGETS', 'set-season-rotation needs a preset or rotation');
  }
  const rejection = firstRotationRejection(rotation, memberPlayable);
  if (rejection !== null) {
    return rejected(rejection.code, rejection.message);
  }
  return {
    status: 'accepted',
    commandId: command.commandId,
    franchiseId: command.franchiseId,
    rotation,
  };
}
