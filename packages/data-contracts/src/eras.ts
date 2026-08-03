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
