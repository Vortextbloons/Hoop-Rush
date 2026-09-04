import { z } from 'zod';
import { eraIdSchema, seasonKeySchema } from './ids.ts';
export const DEFAULT_ERA_ID = '1990s' as const;
export const FIXED_SANDBOX_ERA = '2010s' as const;
export const eraDefSchema = z.object({
    eraId: eraIdSchema,
    label: z.string().min(1).max(24),
    fromSeasonKey: seasonKeySchema,
    toSeasonKey: seasonKeySchema,
});
export type EraDef = z.infer<typeof eraDefSchema>;
