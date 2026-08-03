import { z } from 'zod';

/**
 * Canonical NBA position groups. `G`, `F`, and `C` are the only positions a
 * player may occupy in a lineup, per spec/01. Source labels (PG, SG, SF, PF,
 * G-F, ...) are normalized once at build time; gameplay consumes only the
 * canonical groups.
 */
export const positionSchema = z.enum(['G', 'F', 'C']);
export type Position = z.infer<typeof positionSchema>;

export const POSITIONS: readonly Position[] = ['G', 'F', 'C'];

/** A player's playable positions: the sorted, deduplicated career-wide union. */
export const positionUnionSchema = z
  .array(positionSchema)
  .min(1)
  .max(3)
  .transform((values) => [...new Set(values)].sort());
export type PositionUnion = z.infer<typeof positionUnionSchema>;

/** Source labels exactly as published (e.g. "PG", "G-F", "C-F"). */
export const sourcePositionSchema = z.string().min(1).max(8);
export type SourcePosition = z.infer<typeof sourcePositionSchema>;

/** Version tag of the label-normalization rule that produced the unions. */
export const positionNormalizationVersionSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);
export type PositionNormalizationVersion = z.infer<typeof positionNormalizationVersionSchema>;
