import { z } from 'zod';
import { playerIdSchema } from './ids.ts';
import { positionSchema } from './positions.ts';
export const lineupStructureSchema = z.tuple([
  z.literal('PG'),
  z.literal('SG'),
  z.literal('SF'),
  z.literal('PF'),
  z.literal('C'),
]);
export type LineupStructure = z.infer<typeof lineupStructureSchema>;
export const LINEUP_STRUCTURE: LineupStructure = ['PG', 'SG', 'SF', 'PF', 'C'];
export const slotIndexSchema = z.number().int().min(0).max(4);
export type SlotIndex = z.infer<typeof slotIndexSchema>;
export const lineupAssignmentSchema = z.object({
  slotIndex: slotIndexSchema,
  playerId: playerIdSchema,
  positions: z.array(positionSchema).min(1).max(5),
});
export type LineupAssignment = z.infer<typeof lineupAssignmentSchema>;
export const lineupSchema = z.object({
  structure: lineupStructureSchema,
  assignments: z.array(lineupAssignmentSchema).length(5),
});
export type Lineup = z.infer<typeof lineupSchema>;
