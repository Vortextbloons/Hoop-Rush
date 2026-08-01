import type { Position, PositionUnion } from '@hoop-rush/data-contracts';

/** Sorted, deduplicated canonical position union (G < F < C). */
export function normalizePositionUnion(positions: readonly Position[]): PositionUnion {
  return [...new Set(positions)].sort() as PositionUnion;
}

/** Whether a player's career union contains the given position. */
export function canPlay(positions: PositionUnion, position: Position): boolean {
  return positions.includes(position);
}
