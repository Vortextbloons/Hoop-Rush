import { z } from 'zod';

/**
 * Detailed NBA positions are the one position vocabulary in Hoop Rush.
 * Players carry detailed positions (PG/SG/SF/PF/C) everywhere; the coarse
 * `G`/`F`/`C` letters survive only as lineup slot requirements and as the
 * slot-group mapping derived here. The mapping is the single authoritative
 * implementation shared by the importer, engine, and CLI (spec/01 and
 * spec/02): PG/SG guard, SF/PF forward, C center.
 */
export const positionSchema = z.enum(['PG', 'SG', 'SF', 'PF', 'C']);
export type Position = z.infer<typeof positionSchema>;

export const POSITIONS: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

/** A player's playable positions: the sorted, deduplicated career-wide union of detailed positions. */
export const positionUnionSchema = z
  .array(positionSchema)
  .min(1)
  .max(5)
  .transform((values) => [...new Set(values)].sort());
export type PositionUnion = z.infer<typeof positionUnionSchema>;

/** Source labels exactly as published (e.g. "PG", "G-F", "C-F"). */
export const sourcePositionSchema = z.string().min(1).max(8);
export type SourcePosition = z.infer<typeof sourcePositionSchema>;

/** Version tag of the label-normalization rule that produced the unions. */
export const positionNormalizationVersionSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);
export type PositionNormalizationVersion = z.infer<typeof positionNormalizationVersionSchema>;

/** Coarse slot groups used by lineup slot requirements (G,G,F,F,C). */
export type SlotGroup = 'G' | 'F' | 'C';

/** The slot group a detailed position fills: PG/SG -> G, SF/PF -> F, C -> C. */
export function slotGroupOf(position: Position): SlotGroup {
  if (position === 'PG' || position === 'SG') {
    return 'G';
  }
  if (position === 'SF' || position === 'PF') {
    return 'F';
  }
  return 'C';
}

/** Sorted, deduplicated slot groups for a playable union. */
export function playableSlotGroups(positions: readonly Position[]): SlotGroup[] {
  const groups = new Set<SlotGroup>();
  for (const position of positions) {
    groups.add(slotGroupOf(position));
  }
  return [...groups].sort();
}

/** True when any detailed position in `positions` maps to `slot`. */
export function canPlay(positions: readonly Position[], slot: SlotGroup): boolean {
  return positions.some((position) => slotGroupOf(position) === slot);
}
