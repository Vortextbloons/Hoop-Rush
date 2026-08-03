import type { Position, PositionUnion } from '@hoop-rush/data-contracts';

/**
 * The engine consumes the detailed position vocabulary (PG/SG/SF/PF/C); the
 * coarse G/F/C slot grouping lives only in data-contracts, re-exported here so
 * the public @hoop-rush/engine API exposes the single authoritative mapping.
 */
export {
  canPlay,
  playableSlotGroups,
  slotGroupOf,
  type SlotGroup,
} from '@hoop-rush/data-contracts';

/** Sorted, deduplicated detailed position union (PG < SG < SF < PF < C). */
export function normalizePositionUnion(positions: readonly Position[]): PositionUnion {
  return [...new Set(positions)].sort();
}
