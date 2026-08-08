import { z } from 'zod';
import { eraIdSchema, seasonKeySchema } from './ids.ts';

/**
 * A decade is a documented range of NBA seasons, per spec/01:
 * 1960s = 1960-61 through 1969-70, 1990s = 1990-91 through 1999-2000, ...
 */

/**
 * The default era id when no era is chosen: the 1990s are the calibration
 * and fixture default era across the CLI and test fixtures.
 */
export const DEFAULT_ERA_ID = '1990s' as const;

/**
 * The fixed simulation environment era for every sandbox and classic run
 * (spec/01): run creation always loads the frozen '2010s' era profile.
 */
export const FIXED_SANDBOX_ERA = '2010s' as const;

export const eraDefSchema = z.object({
  eraId: eraIdSchema,
  label: z.string().min(1).max(24),
  fromSeasonKey: seasonKeySchema,
  toSeasonKey: seasonKeySchema,
});
export type EraDef = z.infer<typeof eraDefSchema>;
