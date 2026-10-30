import type { Lineup, Position, SlotIndex } from '@hoop-rush/data-contracts';
import { LINEUP_STRUCTURE } from '@hoop-rush/data-contracts';
import { canPlay } from './positions.ts';
export function slotRequirement(slotIndex: SlotIndex): Position {
  const requirement = LINEUP_STRUCTURE[slotIndex];
  if (requirement === undefined) {
    throw new Error(`lineup: no position requirement for slot ${String(slotIndex)}`);
  }
  return requirement;
}
export interface LineupIssue {
  code: 'duplicate-player' | 'slot-missing' | 'slot-mismatch' | 'bad-slot';
  slotIndex: SlotIndex;
  playerId: string;
  message: string;
}
export interface LineupValidation {
  ok: boolean;
  issues: LineupIssue[];
}
export function validateLineup(lineup: Lineup): LineupValidation {
  const issues: LineupIssue[] = [];
  const seen = new Set<string>();
  const covered = new Set<SlotIndex>();
  for (const assignment of lineup.assignments) {
    const { slotIndex, playerId, positions } = assignment;
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 4) {
      issues.push({
        code: 'bad-slot',
        slotIndex: slotIndex,
        playerId,
        message: `slot index ${String(slotIndex)} is outside 0..4`,
      });
      continue;
    }
    if (seen.has(playerId)) {
      issues.push({
        code: 'duplicate-player',
        slotIndex,
        playerId,
        message: `player ${playerId} appears more than once`,
      });
    }
    seen.add(playerId);
    if (covered.has(slotIndex)) {
      issues.push({
        code: 'slot-missing',
        slotIndex,
        playerId,
        message: `slot ${String(slotIndex)} is assigned more than once`,
      });
    }
    covered.add(slotIndex);
    const requirement = slotRequirement(slotIndex);
    if (!canPlay(positions, requirement)) {
      issues.push({
        code: 'slot-mismatch',
        slotIndex,
        playerId,
        message: `player ${playerId} (${positions.join('/')}) cannot fill ${requirement} slot ${String(slotIndex)}`,
      });
    }
  }
  for (let slotIndex = 0; slotIndex < LINEUP_STRUCTURE.length; slotIndex += 1) {
    if (!covered.has(slotIndex)) {
      issues.push({
        code: 'slot-missing',
        slotIndex: slotIndex,
        playerId: '',
        message: `slot ${String(slotIndex)} is not assigned`,
      });
    }
  }
  return { ok: issues.length === 0, issues };
}
