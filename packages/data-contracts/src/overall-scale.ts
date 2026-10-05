import { z } from 'zod';

export const overallScaleSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.string().min(1).max(64),
    modelVersion: z.string().min(1).max(64),
    reference: z.object({
      firstSeason: z.literal('1996-97'),
      lastSeason: z.literal('2024-25'),
      minimumGames: z.literal(50),
      minimumMinutes: z.literal(1500),
      sampleCount: z.number().int().positive(),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    knots: z
      .array(
        z.object({
          score: z.number(),
          overall: z.number().min(40).max(99),
          percentile: z.number().min(0).max(1),
        }),
      )
      .min(2),
  })
  .superRefine((scale, context) => {
    for (let i = 1; i < scale.knots.length; i += 1) {
      const previous = scale.knots[i - 1];
      const current = scale.knots[i];
      if (previous === undefined || current === undefined) continue;
      if (
        current.score <= previous.score ||
        current.overall < previous.overall ||
        current.percentile > previous.percentile
      ) {
        context.addIssue({
          code: 'custom',
          path: ['knots', i],
          message: 'scale must be monotonic',
        });
      }
    }
  });

export type OverallScale = z.infer<typeof overallScaleSchema>;

export function overallForScore(
  score: number,
  scale: OverallScale,
): {
  overall: number;
  percentile: number;
} {
  if (!Number.isFinite(score)) throw new Error('overall score must be finite');
  const first = scale.knots[0];
  const last = scale.knots[scale.knots.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error('overall scale requires at least two knots');
  }
  if (score <= first.score)
    return { overall: Math.round(first.overall), percentile: first.percentile };
  if (score >= last.score)
    return { overall: Math.round(last.overall), percentile: last.percentile };
  let low = 0;
  let high = scale.knots.length - 1;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    const middleKnot = scale.knots[middle];
    if (middleKnot === undefined) throw new Error('overall scale knot missing');
    if (middleKnot.score <= score) low = middle;
    else high = middle;
  }
  const left = scale.knots[low];
  const right = scale.knots[high];
  if (left === undefined || right === undefined) {
    throw new Error('overall scale knot missing');
  }
  const fraction = (score - left.score) / (right.score - left.score);
  return {
    overall: Math.max(
      40,
      Math.min(99, Math.round(left.overall + fraction * (right.overall - left.overall))),
    ),
    percentile: left.percentile + fraction * (right.percentile - left.percentile),
  };
}
