import { z } from 'zod';
import { playerIdSchema } from './ids.js';
import { positionSchema } from './positions.js';

/**
 * A legal lineup contains two Guard slots, two Forward slots, and one Center
 * slot. Players may fill only their career-wide NBA-listed positions.
 */

/** Position requirement per slot index, in fixed order. */
export const lineupStructureSchema = z.tuple([
  z.literal('G'),
  z.literal('G'),
  z.literal('F'),
  z.literal('F'),
  z.literal('C'),
]);
export type LineupStructure = z.infer<typeof lineupStructureSchema>;

export const LINEUP_STRUCTURE: LineupStructure = ['G', 'G', 'F', 'F', 'C'];

export const slotIndexSchema = z.number().int().min(0).max(4);
export type SlotIndex = z.infer<typeof slotIndexSchema>;

export const lineupAssignmentSchema = z.object({
  slotIndex: slotIndexSchema,
  playerId: playerIdSchema,
  /** The assigned player's career-wide position union, recorded for audit. */
  positions: z.array(positionSchema).min(1).max(3),
});
export type LineupAssignment = z.infer<typeof lineupAssignmentSchema>;

export const lineupSchema = z.object({
  structure: lineupStructureSchema,
  assignments: z.array(lineupAssignmentSchema).length(5),
});
export type Lineup = z.infer<typeof lineupSchema>;
