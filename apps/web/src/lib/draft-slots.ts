import type { PlayersIndexEntry } from '@hoop-rush/data-contracts';
import { canPlay, slotRequirement } from '@hoop-rush/engine';
import { SLOT_INDEXES, SLOT_LABELS, SLOT_NAMES } from './player-positions';
export { SLOT_INDEXES, SLOT_LABELS, SLOT_NAMES };
export function canFillSlot(player: PlayersIndexEntry, slotIndex: number): boolean {
    return canPlay(player.positionsPlayable, slotRequirement(slotIndex));
}
export function displacementTargetFor(slots: readonly (PlayersIndexEntry | null)[], incumbent: PlayersIndexEntry, targetSlot: number, subjectSlot: number): number | null {
    for (const i of SLOT_INDEXES) {
        if (i === targetSlot)
            continue;
        const willBeOpen = i === subjectSlot || slots[i] === null;
        if (!willBeOpen)
            continue;
        if (canFillSlot(incumbent, i))
            return i;
    }
    return null;
}
