import { z } from 'zod';

export const difficultyProfileSchema = z.object({
  profileVersion: z.string().min(1).max(64),
  name: z.enum(['medium']),

  leagueMedianPercentileBand: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),

  teamPercentileBand: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
});
export type DifficultyProfile = z.infer<typeof difficultyProfileSchema>;
