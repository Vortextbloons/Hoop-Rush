import type { PlayersIndexEntry } from '@hoop-rush/data-contracts';
import {
  canPlay,
  planLineupReposition,
  slotRequirement,
  type LineupRepositionPlan,
} from '@hoop-rush/engine';
import { SLOT_INDEXES, SLOT_LABELS, SLOT_NAMES } from './player-positions';
export { SLOT_INDEXES, SLOT_LABELS, SLOT_NAMES };
export function canFillSlot(player: PlayersIndexEntry, slotIndex: number): boolean {
  return canPlay(player.positionsPlayable, slotRequirement(slotIndex));
}
export function planPlayerMove(
  slots: readonly (PlayersIndexEntry | null)[],
  subject: PlayersIndexEntry,
  targetSlot: number,
): LineupRepositionPlan | null {
  if (!Number.isInteger(targetSlot) || targetSlot < 0 || targetSlot > 4) return null;
  return planLineupReposition(
    slots.flatMap((player, slotIndex) =>
      player
        ? [
            {
              playerId: player.playerId,
              positions: player.positionsPlayable,
              slotIndex,
            },
          ]
        : [],
    ),
    { playerId: subject.playerId, positions: subject.positionsPlayable },
    targetSlot,
  );
}
