import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import {
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_ROTATION_SIZE,
  SEASON_ROTATION_VERSION,
} from './season-versions.ts';

/**
 * Season Run rotation contracts (spec/2.0/04, M2.2, season-rotation-v3). A
 * persisted rotation keeps the v1 structural shape: five slot-assigned
 * starters (G, G, F, F, C), a five-player bench order that doubles as the
 * deterministic contingency hierarchy, per-player regulation target minutes
 * totaling exactly 240, and an ordered closing five. Under v2 the closing
 * five is an independent legal five that may include bench players and may
 * differ from the starters. Under v3 (projection milestone) every rotation
 * additionally freezes the versioned minute policy that produced its target
 * minutes; the preset value `tight` is preserved for compatibility and
 * labeled Starter-Heavy.
 *
 * M2.6.5 (spec/2.0/15): every rotation contains exactly
 * `SEASON_ROTATION_SIZE` rostered players regardless of roster capacity
 * (10-15); coverage, legal-five, contingency, minutes, closing-five,
 * availability, and game validation apply to the rotation, never to
 * inactive depth.
 */

/** Minute-policy strategies (Starter-Heavy / Balanced / Bench-Heavy). */
export const seasonMinutePolicyStrategySchema = z.enum([
  'starter-heavy',
  'balanced',
  'bench-heavy',
]);
export type SeasonMinutePolicyStrategy = z.infer<typeof seasonMinutePolicyStrategySchema>;

/** Versioned minute-policy record frozen on every rotation (minute-policy-v1). */
export const seasonMinutePolicySchema = z.object({
  policyVersion: z.literal(SEASON_MINUTE_POLICY_VERSION),
  strategy: seasonMinutePolicyStrategySchema,
});
export type SeasonMinutePolicy = z.infer<typeof seasonMinutePolicySchema>;

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
  targetMinutes: z.array(seasonRotationTargetMinutesSchema).length(SEASON_ROTATION_SIZE),
  /**
   * Ordered closing five (G, G, F, F, C), independently legal and possibly
   * different from the starters. Preferred in the final-five-minute/12-point
   * window and at every overtime tip (season-rotation-v2).
   */
  closingFive: z.array(playerVersionIdSchema).length(5),
  /**
   * Versioned minute policy that produced the target minutes
   * (season-rotation-v3, minute-policy-v1).
   */
  minutePolicy: seasonMinutePolicySchema,
  rotationVersion: z.literal(SEASON_ROTATION_VERSION),
});
export type SeasonRotation = z.infer<typeof seasonRotationSchema>;
