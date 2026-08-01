import { z } from 'zod';
import { eraIdSchema, seasonKeySchema } from './ids.js';

/**
 * A decade is a documented range of NBA seasons, per spec/01:
 * 1960s = 1960-61 through 1969-70, 1990s = 1990-91 through 1999-2000, ...
 */

export const eraDefSchema = z.object({
  eraId: eraIdSchema,
  label: z.string().min(1).max(24),
  fromSeasonKey: seasonKeySchema,
  toSeasonKey: seasonKeySchema,
});
export type EraDef = z.infer<typeof eraDefSchema>;

/**
 * League-wide era configuration for one season: pace, scoring, and shot-mix
 * baselines. Possession resolution and rating derivation consume these values;
 * they are versioned data, not engine constants.
 */
export const eraConfigSchema = z.object({
  seasonKey: seasonKeySchema,
  /** Possessions per 48 minutes for the league. */
  pace: z.number().positive().max(130),
  /** League points per game. */
  leaguePpg: z.number().positive().max(150),
  /** Three-point attempts as a share of total field-goal attempts. */
  league3PARate: z.number().min(0).max(0.6),
  /** Optional scaling coefficient for possession-length modeling. */
  possessionCoefficient: z.number().positive().max(3).optional(),
});
export type EraConfig = z.infer<typeof eraConfigSchema>;

export const eraConfigListSchema = z.array(eraConfigSchema);
export type EraConfigList = z.infer<typeof eraConfigListSchema>;
