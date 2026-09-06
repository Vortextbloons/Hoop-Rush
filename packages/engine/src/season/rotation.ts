import {
  LINEUP_STRUCTURE,
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_ROTATION_PRESET_TARGETS,
  SEASON_ROTATION_VERSION,
  franchiseIdSchema,
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
import { minuteStrategyOfPreset } from './minute-plan.ts';
import { enumerateLegalFives } from './rotation-planner.ts';
function canonicalOrder(a: SeasonRosterMemberInput, b: SeasonRosterMemberInput): number {
  return a.playerVersionId < b.playerVersionId ? -1 : a.playerVersionId > b.playerVersionId ? 1 : 0;
}
export function matchStartingFive(
  members: readonly SeasonRosterMemberInput[],
  order?: (a: SeasonRosterMemberInput, b: SeasonRosterMemberInput) => number,
): SeasonRosterMemberInput[] | null {
  const ordered = [...members].sort(order ?? canonicalOrder);
  if (!legalFiveExists(ordered)) return null;
  const plannerMembers = ordered.map((member) => ({
    playerVersionId: member.playerVersionId,
    playable: member.playable,
  }));
  const available = new Set(ordered.map((member) => member.playerVersionId));
  const first = enumerateLegalFives(plannerMembers, available)[0];
  if (first === undefined) return null;
  const byId = new Map(ordered.map((member) => [member.playerVersionId, member]));
  const result: SeasonRosterMemberInput[] = [];
  for (const playerVersionId of first) {
    const member = byId.get(playerVersionId);
    if (member === undefined) return null;
    result.push(member);
  }
  return result;
}
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
    franchiseId: franchiseIdSchema.parse(input.franchiseId),
    starters: starterOrder,
    benchOrder,
    targetMinutes: [
      ...starterOrder.map((playerVersionId) => ({ playerVersionId, minutes: 32 })),
      ...benchOrder.map((playerVersionId) => ({ playerVersionId, minutes: 16 })),
    ],
    closingFive: starterOrder,
    minutePolicy: { policyVersion: SEASON_MINUTE_POLICY_VERSION, strategy: 'balanced' },
    rotationVersion: SEASON_ROTATION_VERSION,
  };
}
export function rotationTargetMinutes(rotation: SeasonRotation): number {
  return rotation.targetMinutes.reduce((sum, entry) => sum + entry.minutes, 0);
}
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
      minutePolicy: rotation.minutePolicy,
      rotationVersion: rotation.rotationVersion,
    }));
  return seasonDigestHex(JSON.stringify(canonical));
}

export function auditSeasonRotation(
  rotation: SeasonRotation,
  memberPlayable: ReadonlyMap<string, readonly Position[]>,
): string[] {
  return validateSeasonRotation(rotation, memberPlayable);
}

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
    const requirement = LINEUP_STRUCTURE[slotIndex];
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
      const requirement = LINEUP_STRUCTURE[slotIndex];
      if (requirement === undefined || !canPlay(playable, requirement)) {
        failures.push(`closing-five player ${closingId} cannot play slot ${String(slotIndex)}`);
      }
    }
  }
  return failures;
}
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
    minutePolicy: {
      policyVersion: rotation.minutePolicy.policyVersion,
      strategy: minuteStrategyOfPreset(preset),
    },
  };
}
function firstRotationRejection(
  rotation: SeasonRotation,
  memberPlayable: ReadonlyMap<string, readonly Position[]>,
): {
  code: SeasonRotationRejectionCode;
  message: string;
} | null {
  const failures = validateSeasonRotation(rotation, memberPlayable);
  const message = failures[0];
  if (message === undefined) return null;
  if (message.includes('duplicate')) {
    return { code: 'DUPLICATE_PLAYER_VERSION', message };
  }
  if (message.includes('closing')) {
    return { code: 'ILLEGAL_CLOSING_FIVE', message };
  }
  if (message.includes('starter')) {
    return { code: 'ILLEGAL_STARTERS', message };
  }
  if (
    message.includes('target minute') ||
    message.includes('total 240') ||
    message.includes('integer')
  ) {
    return { code: 'INVALID_TARGETS', message };
  }
  return { code: 'ROSTER_MISMATCH', message };
}
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
