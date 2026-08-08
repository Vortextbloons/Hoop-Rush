import { z } from 'zod';

/**
 * Canonical 32-hex digest schemas shared across Season Run contracts
 * (engine season/checkpoint and season/rotation). Kept in their own
 * zod-only module so every consumer imports the same declaration without
 * dragging in the full checkpoint record graph.
 */

/** 32-hex canonical checkpoint digest (engine season/checkpoint). */
export const seasonCheckpointDigestSchema = z.string().regex(/^[0-9a-f]{32}$/);
export type SeasonCheckpointDigest = z.infer<typeof seasonCheckpointDigestSchema>;

/** 32-hex canonical digest of the locked 30-rotation set (engine season/rotation). */
export const seasonRotationSetDigestSchema = z.string().regex(/^[0-9a-f]{32}$/);
export type SeasonRotationSetDigest = z.infer<typeof seasonRotationSetDigestSchema>;
