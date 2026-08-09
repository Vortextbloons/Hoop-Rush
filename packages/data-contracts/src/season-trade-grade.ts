import { z } from 'zod';
import { franchiseIdSchema, idSchema } from './ids.ts';
import { seasonTradeOfferIdSchema } from './season-trade.ts';
import { SEASON_TRADE_GRADE_VERSION } from './season-versions.ts';

/**
 * Trade grades (M2.6, trade-grade-v1): bounded per-window grades for
 * accepted trades, derived from recorded trade-window facts (value bands,
 * roster movement). The log is append-only and run-scoped; grading rules
 * land with the trade-grade engine work in a later phase.
 */

export const seasonTradeGradeLabelSchema = z.enum(['great', 'good', 'fair', 'poor', 'bad']);
export type SeasonTradeGradeLabel = z.infer<typeof seasonTradeGradeLabelSchema>;

/** One graded accepted trade offer. */
export const seasonTradeGradeSchema = z.object({
  gradeId: idSchema,
  windowIndex: z.number().int().min(0).max(2),
  offerId: seasonTradeOfferIdSchema,
  /** The franchise whose grade this is (the human side of the offer). */
  franchiseId: franchiseIdSchema,
  /** Bounded 0-100 score (derived, not invented). */
  score: z.number().int().min(0).max(100),
  label: seasonTradeGradeLabelSchema,
});
export type SeasonTradeGrade = z.infer<typeof seasonTradeGradeSchema>;

/** Run-scoped append-only trade-grade log. */
export const seasonTradeGradeLogSchema = z.object({
  schemaVersion: z.literal(1),
  tradeGradeVersion: z.literal(SEASON_TRADE_GRADE_VERSION),
  runId: z.string().min(1).max(64),
  grades: z.array(seasonTradeGradeSchema),
});
export type SeasonTradeGradeLog = z.infer<typeof seasonTradeGradeLogSchema>;
