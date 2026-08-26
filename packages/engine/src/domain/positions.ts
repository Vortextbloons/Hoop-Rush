import type { Position, PositionUnion } from '@hoop-rush/data-contracts';
export { canPlay, playableSlotGroups, slotGroupOf, type SlotGroup, } from '@hoop-rush/data-contracts';
export function normalizePositionUnion(positions: readonly Position[]): PositionUnion {
    return [...new Set(positions)].sort();
}
