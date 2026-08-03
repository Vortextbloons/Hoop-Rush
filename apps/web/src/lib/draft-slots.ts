import type { PlayersIndexEntry, SlotIndex } from '@hoop-rush/data-contracts';
import { canPlay, slotRequirement } from '@hoop-rush/engine';

/**
 * Draft-slot presentation and displacement rules shared by the sandbox page,
 * the pool browser, and the slot picker so slot labels and eligibility never
 * drift between the three surfaces.
 */

export const SLOT_LABELS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
export const SLOT_NAMES = [
  'Point Guard',
  'Shooting Guard',
  'Small Forward',
  'Power Forward',
  'Center',
] as const;
export const SLOT_INDEXES = [0, 1, 2, 3, 4] as const;

/** Whether a player's career-wide playable positions fill the slot. */
export function canFillSlot(player: PlayersIndexEntry, slotIndex: number): boolean {
  return canPlay(player.positionsPlayable, slotRequirement(slotIndex as SlotIndex));
}

/**
 * Where a displaced incumbent can land: the first open slot it can fill,
 * including the slot the incoming player is vacating. Returns null when the
 * incumbent cannot move anywhere.
 */
export function displacementTargetFor(
  slots: readonly (PlayersIndexEntry | null)[],
  incumbent: PlayersIndexEntry,
  targetSlot: number,
  subjectSlot: number,
): number | null {
  for (const i of SLOT_INDEXES) {
    if (i === targetSlot) continue;
    const willBeOpen = i === subjectSlot || slots[i] === null;
    if (!willBeOpen) continue;
    if (canFillSlot(incumbent, i)) return i;
  }
  return null;
}
