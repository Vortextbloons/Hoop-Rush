import { z } from 'zod';

export const seedWindowSchema = z.object({
  seedFrom: z.number().int().nonnegative(),
  seedTo: z.number().int().nonnegative(),
});
