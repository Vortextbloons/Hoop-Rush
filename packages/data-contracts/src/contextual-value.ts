import { z } from 'zod';
export const contextualReasonCodeSchema = z.enum([
  'missing-creation',
  'role-competition',
  'spacing-supply',
  'spacing-redundancy',
  'defensive-coverage',
  'size-and-rebounding',
  'rim-pressure',
  'rim-protection',
  'perimeter-creation',
  'perimeter-defense',
  'turnover-pressure',
  'foul-pressure',
]);
export type ContextualReasonCode = z.infer<typeof contextualReasonCodeSchema>;
export const contextualReasonSchema = z.object({
  code: contextualReasonCodeSchema,
  direction: z.enum(['positive', 'negative', 'neutral']),
  label: z.string().min(1).max(96),
  measuredValue: z.number(),
  comparisonValue: z.number(),
  priority: z.number().int().min(0).max(99),
});
export type ContextualReason = z.infer<typeof contextualReasonSchema>;
export const lineUpFitEvaluationSchema = z.object({
  baseOverall: z.number().int().min(0).max(100),
  fitDelta: z.number().int().min(-4).max(4),
  reasons: z.array(contextualReasonSchema).max(5),
});
export type LineupFitEvaluation = z.infer<typeof lineUpFitEvaluationSchema>;
export const matchupEvaluationSchema = z.object({
  baseOverall: z.number().int().min(0).max(100),
  matchupDelta: z.number().int().min(-3).max(3),
  reasons: z.array(contextualReasonSchema).max(5),
});
export type MatchupEvaluation = z.infer<typeof matchupEvaluationSchema>;
export const contextualPlayerValueSchema = z.object({
  baseOverall: z.number().int().min(0).max(100),
  fitDelta: z.number().int().min(-4).max(4),
  matchupDelta: z.number().int().min(-3).max(3),
  effectiveValue: z.number().int().min(0).max(100),
  fitReasons: z.array(contextualReasonSchema).max(5),
  matchupReasons: z.array(contextualReasonSchema).max(5),
});
export type ContextualPlayerValue = z.infer<typeof contextualPlayerValueSchema>;
