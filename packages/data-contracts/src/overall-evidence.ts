import { z } from 'zod';

export const individualHonorSchema = z.enum(['MVP-1', 'NBA1', 'NBA2', 'NBA3', 'DEF1', 'DEF2']);
export const overallSeasonEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.literal('overall-evidence-v1'),
  season: z.string().regex(/^\d{4}-\d{2}$/),
  sources: z.array(z.url()).min(1),
  recognitionSourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  leagueTrueShooting: z.number().min(0).max(1).nullable().optional(),
  players: z.record(
    z.string().min(1),
    z
      .object({
        honors: z
          .array(individualHonorSchema)
          .refine((honors) => new Set(honors).size === honors.length, 'duplicate honors'),
        possessionPace: z.number().min(70).max(150).nullable(),
        paceSource: z.literal('team-totals-possession-estimate').nullable(),
      })
      .refine(
        (player) => (player.possessionPace === null) === (player.paceSource === null),
        'pace source must match availability',
      ),
  ),
});
export const recognitionPriorsSchema = z.object({
  version: z.literal('recognition-priors-v1'),
  referenceStandardDeviation: z.number().positive(),
  population: z
    .object({
      mean: z.number().min(0).max(100),
      variance: z.number().positive(),
      sampleCount: z.number().int().min(2),
    })
    .optional(),
  entries: z.partialRecord(
    individualHonorSchema,
    z.object({
      mean: z.number().min(0).max(100),
      variance: z.number().positive(),
      sampleCount: z.number().int().min(2),
    }),
  ),
});
export type IndividualHonor = z.infer<typeof individualHonorSchema>;
export type OverallSeasonEvidence = z.infer<typeof overallSeasonEvidenceSchema>;
export type RecognitionPriors = z.infer<typeof recognitionPriorsSchema>;
