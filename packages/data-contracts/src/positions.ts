import { z } from 'zod';

export const positionSchema = z.enum(['PG', 'SG', 'SF', 'PF', 'C']);
export type Position = z.infer<typeof positionSchema>;

export const POSITIONS: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

export const POSITION_SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;

export const positionUnionSchema = z
  .array(positionSchema)
  .min(1)
  .max(5)
  .transform((values) => [...new Set(values)].sort());
export type PositionUnion = z.infer<typeof positionUnionSchema>;

export const sourcePositionSchema = z.string().min(1).max(8);
export type SourcePosition = z.infer<typeof sourcePositionSchema>;

export const positionNormalizationVersionSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);
export type PositionNormalizationVersion = z.infer<typeof positionNormalizationVersionSchema>;

export type SlotGroup = 'G' | 'F' | 'C';

export function slotGroupOf(position: Position): SlotGroup {
  if (position === 'PG' || position === 'SG') {
    return 'G';
  }
  if (position === 'SF' || position === 'PF') {
    return 'F';
  }
  return 'C';
}

export function playableSlotGroups(positions: readonly Position[]): SlotGroup[] {
  const groups = new Set<SlotGroup>();
  for (const position of positions) {
    groups.add(slotGroupOf(position));
  }
  return [...groups].sort();
}

export function canPlay(positions: readonly Position[], slot: SlotGroup): boolean {
  return positions.some((position) => slotGroupOf(position) === slot);
}
