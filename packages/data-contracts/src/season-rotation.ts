import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_ROTATION_VERSION } from './season-versions.ts';

/**
 * Season Run rotation contracts (spec/2.0/04, M2.1). M2.1 persists a minimal
 * deterministic rotation: five slot-assigned starters (G, G, F, F, C), a
 * five-player bench order, per-player target minutes totaling exactly 240,
 * and a closing five initially equal to the starters. M2.2 adds presets,
 * editing, substitution execution, and contingency behavior without replacing
 * this persisted rotation contract.
 */

export const seasonRotationTargetMinutesSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  minutes: z.number().int().min(0).max(48),
});

export const seasonRotationSchema = z.object({
  franchiseId: franchiseIdSchema,
  /** Five starters in slot order 0..4 (requirements G, G, F, F, C). */
  starters: z.array(playerVersionIdSchema).length(5),
  /** Remaining five in deterministic bench order. */
  benchOrder: z.array(playerVersionIdSchema).length(5),
  /** Per-player target minutes; must total exactly 240. */
  targetMinutes: z.array(seasonRotationTargetMinutesSchema).length(10),
  /** Closing five; M2.1 always equals the starters. */
  closingFive: z.array(playerVersionIdSchema).length(5),
  rotationVersion: z.literal(SEASON_ROTATION_VERSION),
});
export type SeasonRotation = z.infer<typeof seasonRotationSchema>;
