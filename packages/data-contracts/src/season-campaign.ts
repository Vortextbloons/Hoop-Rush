import { z } from 'zod';
import { commandIdSchema, franchiseIdSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_CAMPAIGN_VERSION } from './season-versions.ts';
export const seasonCampaignGmIdentitySchema = z.enum([
    'win-now',
    'player-development',
    'team-identity',
]);
export type SeasonCampaignGmIdentity = z.infer<typeof seasonCampaignGmIdentitySchema>;
export const seasonCampaignFocusSchema = z.enum(['defense', 'shooting', 'ball-movement', 'depth']);
export type SeasonCampaignFocus = z.infer<typeof seasonCampaignFocusSchema>;
export const seasonCampaignFamilySchema = z.enum([
    'results',
    'marquee',
    'style',
    'player-role',
    'roster-response',
]);
export type SeasonCampaignFamily = z.infer<typeof seasonCampaignFamilySchema>;
export const seasonCampaignConditionKindSchema = z.enum([
    'block-wins',
    'winning-block',
    'top-six',
    'play-in',
    'win-over-higher',
    'beat-conference-leader',
    'sweep-opponent',
    'defensive-efficiency',
    'three-point-volume',
    'assists',
    'turnover-control',
    'rebound-margin',
    'bench-contribution',
    'player-minutes',
    'player-starts',
    'player-availability',
    'player-points',
    'player-assists',
    'player-rebounds',
    'roster-new-player-minutes',
    'roster-new-player-starts',
    'roster-replace-unavailable',
    'roster-depth-coverage',
]);
export type SeasonCampaignConditionKind = z.infer<typeof seasonCampaignConditionKindSchema>;
export const seasonCampaignComparisonOperatorSchema = z.enum(['gte', 'lte', 'gt', 'lt', 'eq']);
export type SeasonCampaignComparisonOperator = z.infer<typeof seasonCampaignComparisonOperatorSchema>;
export const seasonCampaignWindowSchema = z.enum(['block', 'post-block', 'schedule']);
export type SeasonCampaignWindow = z.infer<typeof seasonCampaignWindowSchema>;
const seasonCampaignConditionBase = z.object({
    kind: seasonCampaignConditionKindSchema,
    comparisonOperator: seasonCampaignComparisonOperatorSchema,
    threshold: z.number().int(),
    window: seasonCampaignWindowSchema,
});
export const seasonCampaignConditionSchema = z.discriminatedUnion('kind', [
    seasonCampaignConditionBase.extend({
        kind: z.literal('block-wins'),
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('winning-block'),
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('top-six'),
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('play-in'),
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('win-over-higher'),
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('beat-conference-leader'),
        opponentFranchiseId: franchiseIdSchema.optional(),
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('sweep-opponent'),
        opponentFranchiseId: franchiseIdSchema,
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('defensive-efficiency'),
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('three-point-volume'),
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('assists'),
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('turnover-control'),
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('rebound-margin'),
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('bench-contribution'),
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('player-minutes'),
        playerVersionId: playerVersionIdSchema,
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('player-starts'),
        playerVersionId: playerVersionIdSchema,
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('player-availability'),
        playerVersionId: playerVersionIdSchema,
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('player-points'),
        playerVersionId: playerVersionIdSchema,
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('player-assists'),
        playerVersionId: playerVersionIdSchema,
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('player-rebounds'),
        playerVersionId: playerVersionIdSchema,
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('roster-new-player-minutes'),
        playerVersionId: playerVersionIdSchema.optional(),
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('roster-new-player-starts'),
        playerVersionId: playerVersionIdSchema.optional(),
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('roster-replace-unavailable'),
        playerVersionId: playerVersionIdSchema.optional(),
    }),
    seasonCampaignConditionBase.extend({
        kind: z.literal('roster-depth-coverage'),
    }),
]);
export type SeasonCampaignCondition = z.infer<typeof seasonCampaignConditionSchema>;
export const seasonCampaignRewardTypeSchema = z.enum([
    'influence',
    'trade-board-information',
    'trade-inquiry-credit',
    'follow-up-unlock',
]);
export type SeasonCampaignRewardType = z.infer<typeof seasonCampaignRewardTypeSchema>;
export const seasonCampaignRewardSchema = z.object({
    rewardId: z.string().regex(/^rew-[0-9a-f]{8,32}$/),
    type: seasonCampaignRewardTypeSchema,
    amount: z.number().int().min(0).max(5),
});
export type SeasonCampaignReward = z.infer<typeof seasonCampaignRewardSchema>;
export const seasonCampaignOpportunityIdSchema = z.string().regex(/^copp-[0-9a-f]{8,32}$/);
export const seasonCampaignBranchIdSchema = z.string().regex(/^cbr-[0-9a-f]{8,32}$/);
export const seasonCampaignTemplateIdSchema = z.string().regex(/^ctpl-[0-9a-f]{8,32}$/);
export const seasonCampaignOpportunitySchema = z.object({
    opportunityId: seasonCampaignOpportunityIdSchema,
    branchId: seasonCampaignBranchIdSchema,
    templateId: seasonCampaignTemplateIdSchema,
    blockIndex: z.number().int().min(0).max(7),
    identity: seasonCampaignGmIdentitySchema,
    family: seasonCampaignFamilySchema,
    prerequisiteId: seasonCampaignOpportunityIdSchema.nullable(),
    target: seasonCampaignConditionSchema,
    breakthrough: seasonCampaignConditionSchema.nullable(),
    completedReward: seasonCampaignRewardSchema,
    breakthroughReward: seasonCampaignRewardSchema.nullable(),
    feasibilityFacts: z.record(z.string(), z.unknown()),
    seedPath: z.array(z.string()).min(1),
});
export type SeasonCampaignOpportunity = z.infer<typeof seasonCampaignOpportunitySchema>;
export const seasonCampaignOutcomeSchema = z.enum(['missed', 'completed', 'breakthrough']);
export type SeasonCampaignOutcome = z.infer<typeof seasonCampaignOutcomeSchema>;
export const seasonCampaignEvaluationSchema = z.object({
    opportunityId: seasonCampaignOpportunityIdSchema,
    blockIndex: z.number().int().min(0).max(7),
    outcome: seasonCampaignOutcomeSchema,
    facts: z.record(z.string(), z.unknown()),
    appliedRewardIds: z.array(z.string().regex(/^rew-[0-9a-f]{8,32}$/)),
    explanation: z.string().min(1).max(1024),
});
export type SeasonCampaignEvaluation = z.infer<typeof seasonCampaignEvaluationSchema>;
export const seasonCampaignEvolutionKindSchema = z.enum(['double-down', 'adapt', 'pivot']);
export type SeasonCampaignEvolutionKind = z.infer<typeof seasonCampaignEvolutionKindSchema>;
export const seasonCampaignEvolutionOfferSchema = z.object({
    offerId: z.string().regex(/^evo-[0-9a-f]{8,32}$/),
    kind: seasonCampaignEvolutionKindSchema,
    evidence: z.string().min(1).max(1024),
    resultingIdentity: seasonCampaignGmIdentitySchema,
    resultingFocus: seasonCampaignFocusSchema.nullable(),
});
export type SeasonCampaignEvolutionOffer = z.infer<typeof seasonCampaignEvolutionOfferSchema>;
export const seasonCampaignEvolutionSelectionSchema = z.object({
    selectedOfferId: z.string().regex(/^evo-[0-9a-f]{8,32}$/),
    kind: seasonCampaignEvolutionKindSchema,
    resultingIdentity: seasonCampaignGmIdentitySchema,
    resultingFocus: seasonCampaignFocusSchema.nullable(),
    selectedByCommandId: commandIdSchema,
});
export type SeasonCampaignEvolutionSelection = z.infer<typeof seasonCampaignEvolutionSelectionSchema>;
export const seasonCampaignPerFranchiseStateSchema = z.object({
    offers: z.record(z.coerce.number().int().min(0).max(7), z.array(seasonCampaignOpportunitySchema).length(2)),
    selections: z.record(z.coerce.number().int().min(0).max(7), z.object({
        opportunityId: seasonCampaignOpportunityIdSchema,
        selectedByCommandId: commandIdSchema,
    })),
    evaluations: z.array(seasonCampaignEvaluationSchema),
    branchState: z.record(seasonCampaignBranchIdSchema, z.enum(['open', 'completed', 'missed', 'locked'])),
    evolutionOffers: z.array(seasonCampaignEvolutionOfferSchema).nullable(),
    evolutionSelection: seasonCampaignEvolutionSelectionSchema.nullable(),
    rewardEntitlements: z.object({
        influenceEarned: z.number().int().nonnegative(),
        inquiryCredits: z.number().int().nonnegative(),
        informationBenefits: z.number().int().nonnegative(),
        followUpUnlocks: z.array(z.string()),
    }),
    appliedRewardIds: z.array(z.string().regex(/^rew-[0-9a-f]{8,32}$/)),
});
export type SeasonCampaignPerFranchiseState = z.infer<typeof seasonCampaignPerFranchiseStateSchema>;
export const seasonCampaignStateSchema = z
    .object({
    schemaVersion: z.literal(1),
    campaignVersion: z.union([z.literal(SEASON_CAMPAIGN_VERSION), z.literal('season-campaign-v1')]),
    startingIdentity: seasonCampaignGmIdentitySchema.nullable(),
    startingFocus: seasonCampaignFocusSchema.nullable(),
    offers: z.record(z.coerce.number().int().min(0).max(7), z.array(seasonCampaignOpportunitySchema).length(2)),
    selections: z.record(z.coerce.number().int().min(0).max(7), z.object({
        opportunityId: seasonCampaignOpportunityIdSchema,
        selectedByCommandId: commandIdSchema,
    })),
    evaluations: z.array(seasonCampaignEvaluationSchema),
    branchState: z.record(seasonCampaignBranchIdSchema, z.enum(['open', 'completed', 'missed', 'locked'])),
    evolutionOffers: z.array(seasonCampaignEvolutionOfferSchema).nullable(),
    evolutionSelection: seasonCampaignEvolutionSelectionSchema.nullable(),
    rewardEntitlements: z.object({
        influenceEarned: z.number().int().nonnegative(),
        inquiryCredits: z.number().int().nonnegative(),
        informationBenefits: z.number().int().nonnegative(),
        followUpUnlocks: z.array(z.string()),
    }),
    appliedRewardIds: z.array(z.string().regex(/^rew-[0-9a-f]{8,32}$/)),
    franchiseStates: z.record(franchiseIdSchema, seasonCampaignPerFranchiseStateSchema).optional(),
})
    .superRefine((state, ctx) => {
    for (const [blockKey, offers] of Object.entries(state.offers)) {
        const blockIndex = Number(blockKey);
        if (blockIndex < 0 || blockIndex > 7) {
            ctx.addIssue({ code: 'custom', message: `offers blockIndex out of range: ${blockKey}` });
        }
        if (offers.length !== 2) {
            ctx.addIssue({ code: 'custom', message: `block ${blockKey} must have exactly 2 offers` });
        }
        const ids = new Set(offers.map((o) => o.opportunityId));
        if (ids.size !== 2) {
            ctx.addIssue({ code: 'custom', message: `block ${blockKey} offers must be unique` });
        }
        for (const offer of offers) {
            if (offer.blockIndex !== blockIndex) {
                ctx.addIssue({
                    code: 'custom',
                    message: `offer ${offer.opportunityId} blockIndex ${String(offer.blockIndex)} mismatches key ${blockKey}`,
                });
            }
        }
    }
    for (const [blockKey, sel] of Object.entries(state.selections)) {
        const blockIndex = Number(blockKey);
        const offers = state.offers[blockIndex];
        if (!offers) {
            ctx.addIssue({ code: 'custom', message: `selection for block ${blockKey} has no offers` });
            continue;
        }
        const offeredIds = new Set(offers.map((o) => o.opportunityId));
        if (!offeredIds.has(sel.opportunityId)) {
            ctx.addIssue({
                code: 'custom',
                message: `selection ${sel.opportunityId} not in offers for block ${blockKey}`,
            });
        }
    }
    const seenEvals = new Set<string>();
    for (const ev of state.evaluations) {
        const key = `${String(ev.blockIndex)}:${ev.opportunityId}`;
        if (seenEvals.has(key)) {
            ctx.addIssue({ code: 'custom', message: `duplicate evaluation for ${key}` });
        }
        seenEvals.add(key);
        if (!(ev.blockIndex in state.selections) && state.startingIdentity !== null) {
        }
    }
    if (state.evolutionOffers && state.evolutionOffers.length > 3) {
        ctx.addIssue({ code: 'custom', message: 'evolutionOffers must have at most 3 entries' });
    }
    if (state.evolutionSelection && !state.evolutionOffers) {
        ctx.addIssue({ code: 'custom', message: 'evolutionSelection requires evolutionOffers' });
    }
    if (state.evolutionSelection && state.evolutionOffers) {
        const ids = new Set(state.evolutionOffers.map((o) => o.offerId));
        if (!ids.has(state.evolutionSelection.selectedOfferId)) {
            ctx.addIssue({
                code: 'custom',
                message: `evolution selection ${state.evolutionSelection.selectedOfferId} not in offers`,
            });
        }
    }
    const allApplied = new Set(state.appliedRewardIds);
    if (allApplied.size !== state.appliedRewardIds.length) {
        ctx.addIssue({ code: 'custom', message: 'appliedRewardIds must be unique' });
    }
});
export type SeasonCampaignState = z.infer<typeof seasonCampaignStateSchema>;
export function buildEmptyCampaignState(): SeasonCampaignState {
    return {
        schemaVersion: 1,
        campaignVersion: SEASON_CAMPAIGN_VERSION,
        startingIdentity: null,
        startingFocus: null,
        offers: {},
        selections: {},
        evaluations: [],
        branchState: {},
        evolutionOffers: null,
        evolutionSelection: null,
        rewardEntitlements: {
            influenceEarned: 0,
            inquiryCredits: 0,
            informationBenefits: 0,
            followUpUnlocks: [],
        },
        appliedRewardIds: [],
    };
}
