import type { PlayersIndexEntry } from '@hoop-rush/data-contracts';
import { canPlay, slotRequirement } from '@hoop-rush/engine';
import { SLOT_INDEXES, SLOT_LABELS, SLOT_NAMES } from './player-positions';

/**
 * Draft-slot eligibility and displacement rules shared by the sandbox page,
 * the pool browser, and the slot picker. Slot labels and names live in the
 * shared player-position presentation module and are re-exported here so the
 * three surfaces keep one vocabulary.
 */

export { SLOT_INDEXES, SLOT_LABELS, SLOT_NAMES };

/** Whether a player's career-wide playable positions fill the slot. */
export function canFillSlot(player: PlayersIndexEntry, slotIndex: number): boolean {
  return canPlay(player.positionsPlayable, slotRequirement(slotIndex));
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
