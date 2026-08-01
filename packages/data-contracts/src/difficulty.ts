import { z } from 'zod';

/**
 * Versioned difficulty/calibration profile. Medium difficulty is implemented by
 * lineup generation within a calibrated strength band (spec/01), never by
 * rating boosts or hidden bonuses.
 */

export const difficultyProfileSchema = z.object({
  /** Version of this difficulty profile; persisted with every run. */
  profileVersion: z.string().min(1).max(64),
  name: z.enum(['medium']),
  /** League-median opponent strength band, as percentiles of the field. */
  leagueMedianPercentileBand: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
  /** Allowed team strength spread across the 30-team bracket. */
  teamPercentileBand: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
});
export type DifficultyProfile = z.infer<typeof difficultyProfileSchema>;
