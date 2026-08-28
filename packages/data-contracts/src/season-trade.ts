import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { injuryIdSchema } from './season-health.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_TRADE_VERSION } from './season-versions.ts';
export const seasonTradeOfferIdSchema = z.string().regex(/^off-[0-9a-f]{32}$/);
export type SeasonTradeOfferId = z.infer<typeof seasonTradeOfferIdSchema>;
export const seasonTradeOfferStatusSchema = z.enum(['open', 'accepted', 'declined', 'expired']);
export type SeasonTradeOfferStatus = z.infer<typeof seasonTradeOfferStatusSchema>;
export const seasonTradePlayerHealthSchema = z.object({
    available: z.boolean(),
    activeInjuryIds: z.array(injuryIdSchema),
});
export type SeasonTradePlayerHealth = z.infer<typeof seasonTradePlayerHealthSchema>;
export const seasonTradeOfferValueBandSchema = z.object({
    ratioBasisPoints: z.number().int().min(800).max(1200),
    band: z.enum(['85-115', '80-120']),
    qualified: z.boolean(),
});
export type SeasonTradeOfferValueBand = z.infer<typeof seasonTradeOfferValueBandSchema>;
export const seasonTradeOfferRoleFitSchema = z.object({
    outgoingRoles: z.array(z.string().min(1).max(64)),
    incomingRoles: z.array(z.string().min(1).max(64)),
    notes: z.string().max(512),
});
export type SeasonTradeOfferRoleFit = z.infer<typeof seasonTradeOfferRoleFitSchema>;
export const seasonTradeOfferRosterNeedFactsSchema = z.object({
    outgoingDepth: z.number().int().nonnegative(),
    incomingDepth: z.number().int().nonnegative(),
    notes: z.string().max(512),
});
export type SeasonTradeOfferRosterNeedFacts = z.infer<typeof seasonTradeOfferRosterNeedFactsSchema>;
export const seasonTradeOfferChemistryDisruptionSchema = z.object({
    removedPairs: z.number().int().nonnegative(),
    newPairs: z.number().int().nonnegative(),
});
export type SeasonTradeOfferChemistryDisruption = z.infer<typeof seasonTradeOfferChemistryDisruptionSchema>;
export const seasonTradeOfferSchema = z
    .object({
    offerId: seasonTradeOfferIdSchema,
    windowIndex: z.number().int().min(0).max(2),
    seedPath: z.array(z.string()).min(1),
    toFranchiseId: franchiseIdSchema,
    fromFranchiseId: franchiseIdSchema,
    outgoingPlayerVersionIds: z.array(playerVersionIdSchema).min(1).max(2),
    incomingPlayerVersionIds: z.array(playerVersionIdSchema).min(1).max(2),
    outgoingHealth: z.array(seasonTradePlayerHealthSchema),
    incomingHealth: z.array(seasonTradePlayerHealthSchema),
    valueBand: seasonTradeOfferValueBandSchema,
    roleFit: seasonTradeOfferRoleFitSchema,
    rosterNeedFacts: seasonTradeOfferRosterNeedFactsSchema,
    projectedRotationChanges: z.string().max(512),
    projectedChemistryDisruption: seasonTradeOfferChemistryDisruptionSchema,
    status: seasonTradeOfferStatusSchema,
})
    .superRefine((offer, ctx) => {
    if (offer.outgoingHealth.length !== offer.outgoingPlayerVersionIds.length) {
        ctx.addIssue({
            code: 'custom',
            message: 'outgoingHealth must carry one entry per outgoing player',
        });
    }
    if (offer.incomingHealth.length !== offer.incomingPlayerVersionIds.length) {
        ctx.addIssue({
            code: 'custom',
            message: 'incomingHealth must carry one entry per incoming player',
        });
    }
});
export type SeasonTradeOffer = z.infer<typeof seasonTradeOfferSchema>;
export const seasonTradeNeedSchema = z.enum([
    'ball-handling',
    'shooting',
    'perimeter-defense',
    'interior-defense',
    'rebounding',
    'availability',
    'rotation-talent',
    'depth',
]);
export type SeasonTradeNeed = z.infer<typeof seasonTradeNeedSchema>;
export const seasonTradePrioritySchema = z.enum([
    'talent',
    'fit',
    'availability',
    'depth',
    'influence',
]);
export type SeasonTradePriority = z.infer<typeof seasonTradePrioritySchema>;
export const seasonTradeCompetitorInterestSchema = z.enum([
    'low',
    'possible',
    'strong',
    'preferred-fit',
]);
export type SeasonTradeCompetitorInterest = z.infer<typeof seasonTradeCompetitorInterestSchema>;
export const seasonTradeBoardTeamProfileSchema = z.object({
    franchiseId: franchiseIdSchema,
    needs: z.array(seasonTradeNeedSchema).min(1).max(2),
    priority: seasonTradePrioritySchema,
    listedPlayerIds: z.array(playerVersionIdSchema),
    discussablePlayerIds: z.array(playerVersionIdSchema),
    protectedPlayerIds: z.array(playerVersionIdSchema),
    hardConstraints: z.array(z.string().min(1).max(512)),
    rationale: z.string().min(1).max(1024),
    competitorInterest: z
        .record(playerVersionIdSchema, seasonTradeCompetitorInterestSchema)
        .optional(),
});
export type SeasonTradeBoardTeamProfile = z.infer<typeof seasonTradeBoardTeamProfileSchema>;
export const seasonTradeResponseCauseSchema = z.enum([
    'acceptable',
    'close-needs-more-value',
    'wrong-roster-fit',
    'unacceptable-injury-risk',
    'protected-player',
    'illegal-roster',
    'negotiations-closed',
]);
export type SeasonTradeResponseCause = z.infer<typeof seasonTradeResponseCauseSchema>;
export const seasonTradeValueTrendSchema = z.object({
    playerVersionId: playerVersionIdSchema,
    trend: z.enum(['rising', 'stable', 'falling']),
    basis: z.string().min(1).max(1024),
});
export type SeasonTradeValueTrend = z.infer<typeof seasonTradeValueTrendSchema>;
export const seasonTradeProposalSchema = z
    .object({
    proposalId: z.string().regex(/^prop-[0-9a-f]{32}$/),
    windowIndex: z.number().int().min(0).max(2),
    fromFranchiseId: franchiseIdSchema,
    toFranchiseId: franchiseIdSchema,
    outgoingPlayerVersionIds: z.array(playerVersionIdSchema).min(1).max(2),
    incomingPlayerVersionIds: z.array(playerVersionIdSchema).min(1).max(2),
    influenceFromSender: franchiseIdSchema.nullable(),
    influenceAmount: z.number().int().min(0).max(2),
    fingerprint: z.string().min(1).max(128),
    consequenceFacts: z.record(z.string(), z.unknown()),
    seedPath: z.array(z.string()).min(1),
    expectedStateRevision: z.number().int().nonnegative(),
    expectedStateDigest: z.string().regex(/^[0-9a-f]{32}$/),
})
    .superRefine((p, ctx) => {
    const all = [...p.outgoingPlayerVersionIds, ...p.incomingPlayerVersionIds];
    if (new Set(all).size !== all.length) {
        ctx.addIssue({ code: 'custom', message: 'proposal player ids must be distinct' });
    }
    if (p.fingerprint.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'fingerprint required' });
    }
    if (p.outgoingPlayerVersionIds.length === 0 && p.incomingPlayerVersionIds.length === 0) {
        ctx.addIssue({
            code: 'custom',
            message: 'proposal must include at least one player per side',
        });
    }
    if (p.influenceAmount > 0 && p.influenceFromSender === null) {
        ctx.addIssue({ code: 'custom', message: 'influenceAmount requires a sender' });
    }
    if (p.influenceAmount === 0 && p.influenceFromSender !== null) {
        ctx.addIssue({
            code: 'custom',
            message: 'influenceFromSender must be null when amount is 0',
        });
    }
    if (p.influenceFromSender !== null &&
        p.influenceFromSender !== p.fromFranchiseId &&
        p.influenceFromSender !== p.toFranchiseId) {
        ctx.addIssue({
            code: 'custom',
            message: 'influence sender must be one of the two franchises',
        });
    }
    if (p.influenceAmount > 0 && (p.influenceAmount < 1 || p.influenceAmount > 2)) {
        ctx.addIssue({ code: 'custom', message: 'influenceAmount must be 1-2' });
    }
});
export type SeasonTradeProposal = z.infer<typeof seasonTradeProposalSchema>;
export const seasonTradeNegotiationStatusSchema = z.enum([
    'draft',
    'active',
    'countered',
    'accepted',
    'declined',
    'walked-away',
    'expired',
]);
export type SeasonTradeNegotiationStatus = z.infer<typeof seasonTradeNegotiationStatusSchema>;
export const seasonTradeExchangeSchema = z.object({
    exchangeIndex: z.number().int().min(1).max(3),
    kind: z.enum(['human-proposal', 'ai-counter', 'human-revision', 'ai-final']),
    proposalId: z
        .string()
        .regex(/^prop-[0-9a-f]{32}$/)
        .nullable(),
    proposalFingerprint: z.string().min(1).max(128).nullable(),
    responseCause: seasonTradeResponseCauseSchema.nullable(),
    atStateRevision: z.number().int().nonnegative(),
});
export type SeasonTradeExchange = z.infer<typeof seasonTradeExchangeSchema>;
export const seasonTradeNegotiationSchema = z
    .object({
    inquiryId: z.string().regex(/^inq-[0-9a-f]{32}$/),
    windowIndex: z.number().int().min(0).max(2),
    fromFranchiseId: franchiseIdSchema,
    toFranchiseId: franchiseIdSchema,
    status: seasonTradeNegotiationStatusSchema,
    exchangeCount: z.number().int().min(0).max(3),
    exchanges: z.array(seasonTradeExchangeSchema).max(3),
    rejectedPlayerVersionIds: z.array(playerVersionIdSchema),
    expressedInterests: z.array(z.string().min(1).max(512)),
    latestRequestedChange: z.string().min(1).max(512).nullable(),
    finalReason: seasonTradeResponseCauseSchema.nullable(),
    activeProposalId: z
        .string()
        .regex(/^prop-[0-9a-f]{32}$/)
        .nullable(),
})
    .superRefine((n, ctx) => {
    if (n.exchangeCount !== n.exchanges.length) {
        ctx.addIssue({ code: 'custom', message: 'exchangeCount must match exchanges length' });
    }
    if (n.exchangeCount > 3) {
        ctx.addIssue({ code: 'custom', message: 'at most three exchanges' });
    }
    const terminal = new Set(['accepted', 'declined', 'walked-away', 'expired']);
    if (terminal.has(n.status) && n.activeProposalId !== null) {
    }
});
export type SeasonTradeNegotiation = z.infer<typeof seasonTradeNegotiationSchema>;
export const seasonTradeWindowStatusSchema = z.enum(['open', 'closed']);
export type SeasonTradeWindowStatus = z.infer<typeof seasonTradeWindowStatusSchema>;
export const seasonTradeWindowStateSchema = z.object({
    windowIndex: z.number().int().min(0).max(2),
    blockIndex: z.number().int().min(2).max(5),
    status: seasonTradeWindowStatusSchema,
    offers: z.array(seasonTradeOfferSchema),
    boardProfiles: z.array(seasonTradeBoardTeamProfileSchema).max(8).optional(),
    canonicalTeamOrder: z.array(franchiseIdSchema).max(29).optional(),
    inquiryAllowance: z.number().int().min(3).max(5).optional(),
    purchasedInquiryUsed: z.boolean().optional(),
    earnedInquiryUsed: z.boolean().optional(),
    activeInquiryId: z
        .string()
        .regex(/^inq-[0-9a-f]{32}$/)
        .nullable()
        .optional(),
    negotiations: z.array(seasonTradeNegotiationSchema).max(15).optional(),
    valueTrends: z.array(seasonTradeValueTrendSchema).max(450).optional(),
    aiTransactionResolved: z.boolean().optional(),
});
export type SeasonTradeWindowState = z.infer<typeof seasonTradeWindowStateSchema>;
export const seasonHumanTradeDirectStatusSchema = z.enum([
    'draft',
    'submitted',
    'countered',
    'final-pending-confirmation',
    'confirmed',
    'declined',
    'cancelled',
    'expired',
]);
export type SeasonHumanTradeDirectStatus = z.infer<typeof seasonHumanTradeDirectStatusSchema>;
export const seasonHumanTradeDirectNegotiationSchema = z.object({
    negotiationId: z.string().regex(/^htn-[0-9a-f]{32}$/),
    windowIndex: z.number().int().min(0).max(2),
    initiatorFranchiseId: franchiseIdSchema,
    receiverFranchiseId: franchiseIdSchema,
    initiatorParticipantId: z.enum(['p1', 'p2']),
    receiverParticipantId: z.enum(['p1', 'p2']),
    status: seasonHumanTradeDirectStatusSchema,
    currentProposal: seasonTradeProposalSchema.nullable(),
    counterProposal: seasonTradeProposalSchema.nullable(),
    finalPackageFingerprint: z.string().min(1).max(128).nullable(),
    confirmations: z.record(franchiseIdSchema, z.boolean()),
    submittedAtRevision: z.number().int().nonnegative(),
    expiresAt: z.string().min(1).max(64).nullable(),
    counterUsed: z.boolean(),
});
export type SeasonHumanTradeDirectNegotiation = z.infer<
    typeof seasonHumanTradeDirectNegotiationSchema
>;
export const seasonTradeStateSchema = z
    .object({
    schemaVersion: z.literal(1),
    tradeVersion: z.union([z.literal(SEASON_TRADE_VERSION), z.literal('season-trade-v3')]),
    windows: z.array(seasonTradeWindowStateSchema).max(3),
    humanDirectNegotiations: z.array(seasonHumanTradeDirectNegotiationSchema).max(3).optional(),
})
    .superRefine((state, ctx) => {
    const activeCount = state.windows.filter((w) => w.activeInquiryId).length;
    if (activeCount > 3) {
        ctx.addIssue({ code: 'custom', message: 'at most one active inquiry per window' });
    }
    for (const w of state.windows) {
        if (w.inquiryAllowance !== undefined && (w.inquiryAllowance < 3 || w.inquiryAllowance > 5)) {
            ctx.addIssue({ code: 'custom', message: 'inquiryAllowance must be 3-5' });
        }
        if (w.negotiations) {
            const active = w.negotiations.filter((n) => n.status === 'active' || n.status === 'countered');
            if (active.length > 1) {
                ctx.addIssue({ code: 'custom', message: 'at most one active negotiation per window' });
            }
        }
    }
});
export type SeasonTradeState = z.infer<typeof seasonTradeStateSchema>;
