import { z } from 'zod';
import { franchiseIdSchema, idSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { seasonTradeOfferIdSchema } from './season-trade.ts';
import { SEASON_TRADE_GRADE_VERSION } from './season-versions.ts';
import { canonicalJson, seasonDigestHex } from './season-hash.ts';

/**
 * Trade grades (M2.6, trade-grade-v1): bounded per-side grades for accepted
 * trades, derived by the engine from recorded post-trade facts (game
 * summaries through the champion, the trade-window facts, and the run
 * snapshot). The log is append-only and run-scoped; the derivation lives in
 * `@hoop-rush/engine` (`season/trade-grades.ts`), which is the only producer.
 *
 * CONTRACT CHANGE (documented for the lead): the original draft label enum
 * (`great`/`good`/`fair`/`poor`/`bad`) conflicted with the frozen display
 * grades of the trade-grade contract (A 80+, B 65-79, C 45-64, D 30-44,
 * F < 30). The persisted label is the display grade itself, so the enum is
 * the five letters; no persisted artifact used the old labels (the
 * derivation did not exist yet).
 */

export const seasonTradeGradeLabelSchema = z.enum(['A', 'B', 'C', 'D', 'F']);
export type SeasonTradeGradeLabel = z.infer<typeof seasonTradeGradeLabelSchema>;

/**
 * One graded side of one accepted trade. Every accepted trade produces two
 * sides (the `to` franchise and the `from` franchise), each graded from its
 * own received-vs-sent view over the recorded games after the trade window
 * through the champion. A sample below the frozen five-game floor is graded
 * neutral (`score` 50, label C, `neutral` true).
 */
export const seasonTradeGradeSchema = z.object({
  gradeId: idSchema,
  windowIndex: z.number().int().min(0).max(2),
  offerId: seasonTradeOfferIdSchema,
  /** The graded franchise (the side whose received/sent players are compared). */
  franchiseId: franchiseIdSchema,
  /** The players this side received in the trade, in offer order. */
  receivedPlayerVersionIds: z.array(playerVersionIdSchema).min(1).max(2),
  /** The players this side sent away, in offer order. */
  sentPlayerVersionIds: z.array(playerVersionIdSchema).min(1).max(2),
  /** Post-trade team games evaluated for this side (0 for the neutral path). */
  sample: z.number().int().nonnegative(),
  /** True when the five-game floor failed and the grade is neutral. */
  neutral: z.boolean(),
  /** Per-component scores (0-100 integers) under the frozen weights. */
  components: z.object({
    /** 55%: nonnegative accumulated MVP-style production (received vs sent). */
    production: z.number().int().min(0).max(100),
    /** 15%: received-player appearance share of the post-trade team games. */
    availability: z.number().int().min(0).max(100),
    /** 15%: received-player realized minutes and starts per game. */
    minutes: z.number().int().min(0).max(100),
    /** 15%: post-trade team win-rate trend against the pre-trade record. */
    trend: z.number().int().min(0).max(100),
  }),
  /** Bounded 0-100 score (the weighted component sum, rounded). */
  score: z.number().int().min(0).max(100),
  label: seasonTradeGradeLabelSchema,
  /** Bounded recorded reasons (no invented narrative). */
  reasons: z.array(z.string().min(1).max(256)).min(1).max(8),
});
export type SeasonTradeGrade = z.infer<typeof seasonTradeGradeSchema>;

/**
 * Run-scoped append-only trade-grade log. `digest` is a canonical 32-hex
 * digest of the recorded grades (self-excluded), so the almanac can absorb
 * the trade-grade facts under a single digest at Stage 3.
 */
export const seasonTradeGradeLogSchema = z.object({
  schemaVersion: z.literal(1),
  tradeGradeVersion: z.literal(SEASON_TRADE_GRADE_VERSION),
  runId: z.string().min(1).max(64),
  grades: z.array(seasonTradeGradeSchema),
  /** Canonical 32-hex digest of the grade facts (self-excluded). */
  digest: seasonCheckpointDigestSchema,
});
export type SeasonTradeGradeLog = z.infer<typeof seasonTradeGradeLogSchema>;

/** The digest material of a trade-grade log (every fact except `digest`). */
export function seasonTradeGradeLogFacts(log: SeasonTradeGradeLog): unknown {
  const facts: Record<string, unknown> = { ...log };
  delete facts.digest;
  return facts;
}

/** Canonical 32-hex digest of the trade-grade log facts. */
export function seasonTradeGradeLogDigest(log: SeasonTradeGradeLog): string {
  return seasonDigestHex(canonicalJson(seasonTradeGradeLogFacts(log)));
}
