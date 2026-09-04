import { z } from 'zod';
import { franchiseIdSchema, idSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { seasonTradeOfferIdSchema } from './season-trade.ts';
import { SEASON_TRADE_GRADE_VERSION } from './season-versions.ts';
import { canonicalJson, seasonDigestHex } from './season-hash.ts';
export const seasonTradeGradeLabelSchema = z.enum(['A', 'B', 'C', 'D', 'F']);
export type SeasonTradeGradeLabel = z.infer<typeof seasonTradeGradeLabelSchema>;
export const seasonTradeGradeSchema = z.object({
    gradeId: idSchema,
    windowIndex: z.number().int().min(0).max(2),
    offerId: seasonTradeOfferIdSchema,
    franchiseId: franchiseIdSchema,
    receivedPlayerVersionIds: z.array(playerVersionIdSchema).min(1).max(2),
    sentPlayerVersionIds: z.array(playerVersionIdSchema).min(1).max(2),
    sample: z.number().int().nonnegative(),
    neutral: z.boolean(),
    components: z.object({
        production: z.number().int().min(0).max(100),
        availability: z.number().int().min(0).max(100),
        minutes: z.number().int().min(0).max(100),
        trend: z.number().int().min(0).max(100),
    }),
    score: z.number().int().min(0).max(100),
    label: seasonTradeGradeLabelSchema,
    reasons: z.array(z.string().min(1).max(256)).min(1).max(8),
});
export type SeasonTradeGrade = z.infer<typeof seasonTradeGradeSchema>;
export const seasonTradeGradeLogSchema = z.object({
    schemaVersion: z.literal(1),
    tradeGradeVersion: z.literal(SEASON_TRADE_GRADE_VERSION),
    runId: z.string().min(1).max(64),
    grades: z.array(seasonTradeGradeSchema),
    digest: seasonCheckpointDigestSchema,
});
export type SeasonTradeGradeLog = z.infer<typeof seasonTradeGradeLogSchema>;
export function seasonTradeGradeLogFacts(log: SeasonTradeGradeLog): unknown {
    const facts: Record<string, unknown> = { ...log };
    delete facts.digest;
    return facts;
}
export function seasonTradeGradeLogDigest(log: SeasonTradeGradeLog): string {
    return seasonDigestHex(canonicalJson(seasonTradeGradeLogFacts(log)));
}
