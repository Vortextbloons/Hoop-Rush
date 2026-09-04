import type {
  Lineup,
  LineupAssignment,
  PositionUnion,
  SlotGroup,
  SlotIndex,
} from '@hoop-rush/data-contracts';
import { LINEUP_STRUCTURE } from '@hoop-rush/data-contracts';
import { playerIdSchema } from '@hoop-rush/data-contracts';
import { canPlay } from './positions.ts';
export function slotRequirement(slotIndex: SlotIndex): SlotGroup {
  const requirement = LINEUP_STRUCTURE[slotIndex];
  if (requirement === undefined) {
    throw new Error(`lineup: no position requirement for slot ${String(slotIndex)}`);
  }
  return requirement;
}
export function canFillSlot(positions: PositionUnion, slotIndex: SlotIndex): boolean {
  return canPlay(positions, slotRequirement(slotIndex));
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
export function assignLineup(
  players: ReadonlyArray<{
    playerId: string;
    positions: PositionUnion;
  }>,
): LineupAssignment[] | null {
  if (players.length !== 5) return null;
  const byId = new Map(players.map((p) => [p.playerId, p]));
  if (byId.size !== 5) return null;
  const slots: SlotIndex[] = [0, 1, 2, 3, 4];
  function search(index: number, used: Map<SlotIndex, string>): LineupAssignment[] | null {
    if (index === players.length) {
      return [...used.entries()].map(([slotIndex, playerId]) => {
        const assigned = byId.get(playerId);
        if (assigned === undefined) {
          throw new Error(`lineup: missing player ${playerId}`);
        }
        return { slotIndex, playerId: playerIdSchema.parse(playerId), positions: assigned.positions };
      });
    }
    const player = players[index];
    if (player === undefined) {
      throw new Error(`lineup: missing player at index ${String(index)}`);
    }
    for (const slotIndex of slots) {
      if (used.has(slotIndex)) continue;
      if (!canFillSlot(player.positions, slotIndex)) continue;
      used.set(slotIndex, player.playerId);
      const result = search(index + 1, used);
      if (result) return result;
      used.delete(slotIndex);
    }
    return null;
  }
  return search(0, new Map());
}
