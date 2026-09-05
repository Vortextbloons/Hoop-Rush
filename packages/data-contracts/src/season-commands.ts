import { z } from 'zod';
import { commandIdSchema, franchiseIdSchema, seasonGameIdSchema } from './ids.ts';
import {
  seasonDuplicateCommandRejectionSchema,
  seasonFreeAgencyUnresolvedRejectionSchema,
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonSubmitBlockCommandSchema,
} from './season-block.ts';
import {
  blockIndexSchema,
  inquiryIdSchema,
  objectiveBlockIndexSchema,
  seasonRunCommandBaseSchema,
  windowIndexSchema,
} from './season-command-base.ts';
import { seasonRotationSetDigestSchema } from './season-digests.ts';
import {
  seasonFreeAgencyRoleExpectationSchema,
  seasonFreeAgencySigningSchema,
  seasonFreeAgencyTargetSchema,
} from './season-free-agency.ts';
import { injuryIdSchema } from './season-health.ts';
import { seasonInfluenceLedgerEntrySchema } from './season-influence.ts';
import { seasonObjectiveIdSchema } from './season-objective.ts';
import {
  seasonCampaignFocusSchema,
  seasonCampaignGmIdentitySchema,
  seasonCampaignOpportunityIdSchema,
} from './season-campaign.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { seasonTradeOfferIdSchema, seasonTradeOfferSchema } from './season-trade.ts';
import { postseasonGameIdSchema } from './season-postseason.ts';
import { seasonRotationSchema } from './season-rotation.ts';
import {
  seasonSelectFrontOfficeCommandSchema,
  seasonSelectCourtInnovationCommandSchema,
  seasonFrontOfficeAlreadySelectedRejectionSchema,
  seasonFrontOfficeInvalidRejectionSchema,
  seasonFrontOfficeTooLateRejectionSchema,
  seasonInnovationNotDiscoveredRejectionSchema,
  seasonInnovationAlreadySelectedRejectionSchema,
  seasonInnovationInvalidRejectionSchema,
} from './season-evolution.ts';
import { seasonRunStageSchema } from './season-run.ts';
export { seasonRunCommandBaseSchema, type SeasonRunCommandBase } from './season-command-base.ts';
export { seasonStaleStateRejectionSchema, type SeasonStaleStateRejection } from './season-block.ts';
export const seasonNotAtBoundaryRejectionSchema = z.object({
  code: z.literal('not-at-boundary'),
  blockIndex: objectiveBlockIndexSchema,
  nextUnselectedBlockIndex: z.number().int().min(0).max(7),
});
export type SeasonNotAtBoundaryRejection = z.infer<typeof seasonNotAtBoundaryRejectionSchema>;
export const seasonObjectiveNotOfferedRejectionSchema = z.object({
  code: z.literal('objective-not-offered'),
  blockIndex: objectiveBlockIndexSchema,
  objectiveId: seasonObjectiveIdSchema,
  offeredObjectiveIds: z.array(seasonObjectiveIdSchema).length(3),
});
export type SeasonObjectiveNotOfferedRejection = z.infer<
  typeof seasonObjectiveNotOfferedRejectionSchema
>;
export const seasonObjectiveAlreadySelectedRejectionSchema = z.object({
  code: z.literal('objective-already-selected'),
  blockIndex: objectiveBlockIndexSchema,
  objectiveId: seasonObjectiveIdSchema,
});
export type SeasonObjectiveAlreadySelectedRejection = z.infer<
  typeof seasonObjectiveAlreadySelectedRejectionSchema
>;
export const seasonInsufficientBalanceRejectionSchema = z.object({
  code: z.literal('insufficient-balance'),
  franchiseId: franchiseIdSchema,
  balance: z.number().int(),
  requestedDelta: z.number().int().negative(),
  floor: z.number().int(),
});
export type SeasonInsufficientBalanceRejection = z.infer<
  typeof seasonInsufficientBalanceRejectionSchema
>;
export const seasonWindowNotOpenRejectionSchema = z.object({
  code: z.literal('window-not-open'),
  franchiseId: franchiseIdSchema.nullable(),
  windowIndex: windowIndexSchema,
});
export type SeasonWindowNotOpenRejection = z.infer<typeof seasonWindowNotOpenRejectionSchema>;
export const seasonAlreadySpentRejectionSchema = z.object({
  code: z.literal('already-spent'),
  franchiseId: franchiseIdSchema,
  windowIndex: windowIndexSchema,
});
export type SeasonAlreadySpentRejection = z.infer<typeof seasonAlreadySpentRejectionSchema>;
export const seasonInjuryNotActiveRejectionSchema = z.object({
  code: z.literal('injury-not-active'),
  injuryId: injuryIdSchema,
});
export type SeasonInjuryNotActiveRejection = z.infer<typeof seasonInjuryNotActiveRejectionSchema>;
export const seasonAlreadyRehabbedRejectionSchema = z.object({
  code: z.literal('already-rehabbed'),
  injuryId: injuryIdSchema,
});
export type SeasonAlreadyRehabbedRejection = z.infer<typeof seasonAlreadyRehabbedRejectionSchema>;
export const seasonNoWindowRejectionSchema = z.object({
  code: z.literal('no-window'),
  franchiseId: franchiseIdSchema,
});
export type SeasonNoWindowRejection = z.infer<typeof seasonNoWindowRejectionSchema>;
export const seasonOfferUnknownRejectionSchema = z.object({
  code: z.literal('offer-unknown'),
  windowIndex: windowIndexSchema,
  offerId: seasonTradeOfferIdSchema,
});
export type SeasonOfferUnknownRejection = z.infer<typeof seasonOfferUnknownRejectionSchema>;
export const seasonOfferNotOpenRejectionSchema = z.object({
  code: z.literal('offer-not-open'),
  windowIndex: windowIndexSchema,
  offerId: seasonTradeOfferIdSchema,
});
export type SeasonOfferNotOpenRejection = z.infer<typeof seasonOfferNotOpenRejectionSchema>;
export const seasonRosterIllegalRejectionSchema = z.object({
  code: z.literal('roster-illegal'),
  windowIndex: windowIndexSchema,
  offerId: seasonTradeOfferIdSchema,
  reasons: z.array(z.string().min(1).max(256)).min(1),
});
export type SeasonRosterIllegalRejection = z.infer<typeof seasonRosterIllegalRejectionSchema>;
export const seasonOwnershipConflictRejectionSchema = z.object({
  code: z.literal('ownership-conflict'),
  windowIndex: windowIndexSchema,
  offerId: seasonTradeOfferIdSchema,
  playerVersionIds: z.array(playerVersionIdSchema).min(1),
});
export type SeasonOwnershipConflictRejection = z.infer<
  typeof seasonOwnershipConflictRejectionSchema
>;
export const seasonNoPendingBlockRejectionSchema = z.object({
  code: z.literal('no-pending-block'),
  blockIndex: blockIndexSchema,
});
export type SeasonNoPendingBlockRejection = z.infer<typeof seasonNoPendingBlockRejectionSchema>;
export const seasonBlockMismatchRejectionSchema = z.object({
  code: z.literal('block-mismatch'),
  blockIndex: blockIndexSchema,
  pendingBlockIndex: z.number().int().min(0).max(8),
});
export type SeasonBlockMismatchRejection = z.infer<typeof seasonBlockMismatchRejectionSchema>;
export const seasonRotationDigestMismatchRejectionSchema = z.object({
  code: z.literal('rotation-digest-mismatch'),
  rotationDigest: seasonRotationSetDigestSchema,
  pendingRotationDigest: seasonRotationSetDigestSchema,
});
export type SeasonRotationDigestMismatchRejection = z.infer<
  typeof seasonRotationDigestMismatchRejectionSchema
>;
export const seasonGameMismatchRejectionSchema = z.object({
  code: z.literal('game-mismatch'),
  nextGameId: seasonGameIdSchema,
  pendingNextGameId: seasonGameIdSchema,
});
export type SeasonGameMismatchRejection = z.infer<typeof seasonGameMismatchRejectionSchema>;
export {
  seasonFreeAgencyUnresolvedRejectionSchema,
  type SeasonFreeAgencyUnresolvedRejection,
} from './season-block.ts';
export const seasonFreeAgencyWindowNotOpenRejectionSchema = z.object({
  code: z.literal('free-agency-window-not-open'),
  franchiseId: franchiseIdSchema.nullable(),
  windowIndex: windowIndexSchema,
});
export type SeasonFreeAgencyWindowNotOpenRejection = z.infer<
  typeof seasonFreeAgencyWindowNotOpenRejectionSchema
>;
export const seasonFreeAgencyAlreadyResolvedRejectionSchema = z.object({
  code: z.literal('free-agency-already-resolved'),
  windowIndex: windowIndexSchema,
});
export type SeasonFreeAgencyAlreadyResolvedRejection = z.infer<
  typeof seasonFreeAgencyAlreadyResolvedRejectionSchema
>;
export const seasonFreeAgencyAlreadyDeclaredRejectionSchema = z.object({
  code: z.literal('free-agency-already-declared'),
  franchiseId: franchiseIdSchema,
  windowIndex: windowIndexSchema,
});
export type SeasonFreeAgencyAlreadyDeclaredRejection = z.infer<
  typeof seasonFreeAgencyAlreadyDeclaredRejectionSchema
>;
export const seasonFreeAgencyTargetIneligibleRejectionSchema = z.object({
  code: z.literal('free-agency-target-ineligible'),
  windowIndex: windowIndexSchema,
  playerVersionId: playerVersionIdSchema,
});
export type SeasonFreeAgencyTargetIneligibleRejection = z.infer<
  typeof seasonFreeAgencyTargetIneligibleRejectionSchema
>;
export const seasonFreeAgencyDuplicateIdentityRejectionSchema = z.object({
  code: z.literal('free-agency-duplicate-identity'),
  playerId: z.string().min(1).max(64),
  playerVersionId: playerVersionIdSchema,
});
export type SeasonFreeAgencyDuplicateIdentityRejection = z.infer<
  typeof seasonFreeAgencyDuplicateIdentityRejectionSchema
>;
export const seasonFreeAgencyInvalidPriorityRejectionSchema = z.object({
  code: z.literal('free-agency-invalid-priority'),
  playerVersionId: playerVersionIdSchema,
});
export type SeasonFreeAgencyInvalidPriorityRejection = z.infer<
  typeof seasonFreeAgencyInvalidPriorityRejectionSchema
>;
export const seasonFreeAgencyUnsupportedRoleRejectionSchema = z.object({
  code: z.literal('free-agency-unsupported-role'),
  playerVersionId: playerVersionIdSchema,
  roleExpectation: seasonFreeAgencyRoleExpectationSchema,
  supportedRoles: z.array(seasonFreeAgencyRoleExpectationSchema),
});
export type SeasonFreeAgencyUnsupportedRoleRejection = z.infer<
  typeof seasonFreeAgencyUnsupportedRoleRejectionSchema
>;
export const seasonFreeAgencyInvalidInfluenceRejectionSchema = z.object({
  code: z.literal('free-agency-invalid-influence'),
  playerVersionId: playerVersionIdSchema,
  influence: z.number().int(),
  minimum: z.number().int().min(1).max(3),
});
export type SeasonFreeAgencyInvalidInfluenceRejection = z.infer<
  typeof seasonFreeAgencyInvalidInfluenceRejectionSchema
>;
export const seasonFreeAgencyRosterCapRejectionSchema = z.object({
  code: z.literal('free-agency-roster-cap'),
  franchiseId: franchiseIdSchema,
  rosterSize: z.number().int().min(10).max(15),
});
export type SeasonFreeAgencyRosterCapRejection = z.infer<
  typeof seasonFreeAgencyRosterCapRejectionSchema
>;
export const seasonFreeAgencySeasonSigningCapRejectionSchema = z.object({
  code: z.literal('free-agency-season-signing-cap'),
  franchiseId: franchiseIdSchema,
  signingCount: z.number().int().min(0).max(3),
});
export type SeasonFreeAgencySeasonSigningCapRejection = z.infer<
  typeof seasonFreeAgencySeasonSigningCapRejectionSchema
>;
export const seasonFreeAgencySeasonInfluenceCapRejectionSchema = z.object({
  code: z.literal('free-agency-season-influence-cap'),
  franchiseId: franchiseIdSchema,
  seasonSpend: z.number().int().min(0).max(6),
});
export type SeasonFreeAgencySeasonInfluenceCapRejection = z.infer<
  typeof seasonFreeAgencySeasonInfluenceCapRejectionSchema
>;
export const seasonFreeAgencyInsufficientBalanceRejectionSchema = z.object({
  code: z.literal('free-agency-insufficient-balance'),
  franchiseId: franchiseIdSchema,
  balance: z.number().int(),
  required: z.number().int().min(1).max(3),
});
export type SeasonFreeAgencyInsufficientBalanceRejection = z.infer<
  typeof seasonFreeAgencyInsufficientBalanceRejectionSchema
>;
export const seasonFreeAgencyPendingDeclarationRejectionSchema = z.object({
  code: z.literal('free-agency-pending-declaration'),
  franchiseId: franchiseIdSchema,
  windowIndex: windowIndexSchema,
});
export type SeasonFreeAgencyPendingDeclarationRejection = z.infer<
  typeof seasonFreeAgencyPendingDeclarationRejectionSchema
>;
export const seasonFreeAgencyOwnershipConflictRejectionSchema = z.object({
  code: z.literal('free-agency-ownership-conflict'),
  franchiseId: franchiseIdSchema,
  playerVersionId: playerVersionIdSchema,
  reason: z.string().min(1).max(256),
});
export type SeasonFreeAgencyOwnershipConflictRejection = z.infer<
  typeof seasonFreeAgencyOwnershipConflictRejectionSchema
>;
export const seasonDeclareFreeAgentInterestCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('declare-free-agent-interest'),
  franchiseId: franchiseIdSchema,
  windowIndex: windowIndexSchema,
  targets: z.array(seasonFreeAgencyTargetSchema).min(1).max(2),
});
export type SeasonDeclareFreeAgentInterestCommand = z.infer<
  typeof seasonDeclareFreeAgentInterestCommandSchema
>;
export const seasonSkipFreeAgentMarketCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('skip-free-agent-market'),
  franchiseId: franchiseIdSchema,
  windowIndex: windowIndexSchema,
});
export type SeasonSkipFreeAgentMarketCommand = z.infer<
  typeof seasonSkipFreeAgentMarketCommandSchema
>;
export const seasonResolveFreeAgentMarketCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('resolve-free-agent-market'),
  windowIndex: windowIndexSchema,
});
export type SeasonResolveFreeAgentMarketCommand = z.infer<
  typeof seasonResolveFreeAgentMarketCommandSchema
>;
export const seasonDeclareFreeAgentInterestRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonFreeAgencyWindowNotOpenRejectionSchema,
  seasonFreeAgencyAlreadyResolvedRejectionSchema,
  seasonFreeAgencyAlreadyDeclaredRejectionSchema,
  seasonFreeAgencyTargetIneligibleRejectionSchema,
  seasonFreeAgencyDuplicateIdentityRejectionSchema,
  seasonFreeAgencyInvalidPriorityRejectionSchema,
  seasonFreeAgencyUnsupportedRoleRejectionSchema,
  seasonFreeAgencyInvalidInfluenceRejectionSchema,
  seasonFreeAgencyRosterCapRejectionSchema,
  seasonFreeAgencySeasonSigningCapRejectionSchema,
  seasonFreeAgencySeasonInfluenceCapRejectionSchema,
  seasonFreeAgencyInsufficientBalanceRejectionSchema,
  seasonFreeAgencyOwnershipConflictRejectionSchema,
]);
export type SeasonDeclareFreeAgentInterestRejection = z.infer<
  typeof seasonDeclareFreeAgentInterestRejectionSchema
>;
export const seasonSkipFreeAgentMarketRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonFreeAgencyWindowNotOpenRejectionSchema,
  seasonFreeAgencyAlreadyResolvedRejectionSchema,
  seasonFreeAgencyAlreadyDeclaredRejectionSchema,
]);
export type SeasonSkipFreeAgentMarketRejection = z.infer<
  typeof seasonSkipFreeAgentMarketRejectionSchema
>;
export const seasonResolveFreeAgentMarketRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonFreeAgencyWindowNotOpenRejectionSchema,
  seasonFreeAgencyAlreadyResolvedRejectionSchema,
  seasonFreeAgencyPendingDeclarationRejectionSchema,
]);
export type SeasonResolveFreeAgentMarketRejection = z.infer<
  typeof seasonResolveFreeAgentMarketRejectionSchema
>;
export const seasonDeclareFreeAgentInterestResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonDeclareFreeAgentInterestRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    franchiseId: franchiseIdSchema,
    windowIndex: windowIndexSchema,
    declaration: seasonFreeAgencyTargetSchema.array(),
  }),
]);
export type SeasonDeclareFreeAgentInterestResult = z.infer<
  typeof seasonDeclareFreeAgentInterestResultSchema
>;
export const seasonSkipFreeAgentMarketResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonSkipFreeAgentMarketRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    franchiseId: franchiseIdSchema,
    windowIndex: windowIndexSchema,
  }),
]);
export type SeasonSkipFreeAgentMarketResult = z.infer<typeof seasonSkipFreeAgentMarketResultSchema>;
export const seasonResolveFreeAgentMarketResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonResolveFreeAgentMarketRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    windowIndex: windowIndexSchema,
    traces: z.array(
      z.object({
        seedPath: z.array(z.string()).min(1),
        resolution: z.enum(['signed', 'no-signing']),
        signingFranchiseId: franchiseIdSchema.nullable(),
        signedPlayerVersionId: playerVersionIdSchema.nullable(),
      }),
    ),
    signings: z.array(seasonFreeAgencySigningSchema),
    humanSigned: z.boolean(),
  }),
]);
export type SeasonResolveFreeAgentMarketResult = z.infer<
  typeof seasonResolveFreeAgentMarketResultSchema
>;
export const seasonInvalidStageRejectionSchema = z.object({
  code: z.literal('invalid-stage'),
  requiredStage: seasonRunStageSchema,
  currentStage: seasonRunStageSchema,
});
export type SeasonInvalidStageRejection = z.infer<typeof seasonInvalidStageRejectionSchema>;
export const seasonWrongGameRejectionSchema = z.object({
  code: z.literal('wrong-game'),
  targetGameId: postseasonGameIdSchema,
  nextGameId: postseasonGameIdSchema,
});
export type SeasonWrongGameRejection = z.infer<typeof seasonWrongGameRejectionSchema>;
export const seasonInvalidRotationRejectionSchema = z.object({
  code: z.literal('invalid-rotation'),
  franchiseId: franchiseIdSchema,
  reasons: z.array(z.string().min(1).max(256)).min(1),
});
export type SeasonInvalidRotationRejection = z.infer<typeof seasonInvalidRotationRejectionSchema>;
export const seasonUnavailablePlayerRejectionSchema = z.object({
  code: z.literal('unavailable-player'),
  playerVersionId: playerVersionIdSchema,
  reason: z.enum(['injured', 'not-on-roster']),
});
export type SeasonUnavailablePlayerRejection = z.infer<
  typeof seasonUnavailablePlayerRejectionSchema
>;
export const seasonInsufficientRehabResourcesRejectionSchema = z.object({
  code: z.literal('insufficient-rehab-resources'),
  franchiseId: franchiseIdSchema,
  balance: z.number().int(),
  required: z.number().int(),
});
export type SeasonInsufficientRehabResourcesRejection = z.infer<
  typeof seasonInsufficientRehabResourcesRejectionSchema
>;
export const seasonInvalidSeriesStateRejectionSchema = z.object({
  code: z.literal('invalid-series-state'),
  seriesId: z.string().min(1).max(64),
  reason: z.enum(['unpaired', 'complete', 'not-current']),
});
export type SeasonInvalidSeriesStateRejection = z.infer<
  typeof seasonInvalidSeriesStateRejectionSchema
>;
export const seasonIntegrityFailureRejectionSchema = z.object({
  code: z.literal('integrity-failure'),
  reason: z.string().min(1).max(256),
});
export type SeasonIntegrityFailureRejection = z.infer<typeof seasonIntegrityFailureRejectionSchema>;
export const seasonStartPostseasonCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('start-postseason'),
});
export type SeasonStartPostseasonCommand = z.infer<typeof seasonStartPostseasonCommandSchema>;
export const seasonStartPostseasonRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonInvalidStageRejectionSchema,
  seasonIntegrityFailureRejectionSchema,
]);
export type SeasonStartPostseasonRejection = z.infer<typeof seasonStartPostseasonRejectionSchema>;
export const seasonAdvancePostseasonCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('advance-postseason'),
  targetGameId: postseasonGameIdSchema.optional(),
});
export type SeasonAdvancePostseasonCommand = z.infer<typeof seasonAdvancePostseasonCommandSchema>;
export const seasonAdvancePostseasonRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonInvalidStageRejectionSchema,
  seasonWrongGameRejectionSchema,
  seasonInvalidSeriesStateRejectionSchema,
  seasonIntegrityFailureRejectionSchema,
]);
export type SeasonAdvancePostseasonRejection = z.infer<
  typeof seasonAdvancePostseasonRejectionSchema
>;
export const seasonPostseasonRotationPayloadSchema = z.object({
  franchiseId: franchiseIdSchema,
  rotation: seasonRotationSchema,
  riskyRehabInjuryId: injuryIdSchema.optional(),
});
export type SeasonPostseasonRotationPayload = z.infer<typeof seasonPostseasonRotationPayloadSchema>;
export const seasonSubmitPostseasonRotationCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('submit-postseason-rotation'),
  targetGameId: postseasonGameIdSchema,
  rotation: seasonPostseasonRotationPayloadSchema,
});
export type SeasonSubmitPostseasonRotationCommand = z.infer<
  typeof seasonSubmitPostseasonRotationCommandSchema
>;
export const seasonSubmitPostseasonRotationRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonInvalidStageRejectionSchema,
  seasonWrongGameRejectionSchema,
  seasonInvalidRotationRejectionSchema,
  seasonUnavailablePlayerRejectionSchema,
  seasonInsufficientRehabResourcesRejectionSchema,
  seasonIntegrityFailureRejectionSchema,
]);
export type SeasonSubmitPostseasonRotationRejection = z.infer<
  typeof seasonSubmitPostseasonRotationRejectionSchema
>;
export const seasonSpectatePostseasonGameCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('spectate-postseason-game'),
  targetGameId: postseasonGameIdSchema,
});
export type SeasonSpectatePostseasonGameCommand = z.infer<
  typeof seasonSpectatePostseasonGameCommandSchema
>;
export const seasonSpectatePostseasonGameRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonInvalidStageRejectionSchema,
  seasonWrongGameRejectionSchema,
  seasonInvalidSeriesStateRejectionSchema,
  seasonIntegrityFailureRejectionSchema,
]);
export type SeasonSpectatePostseasonGameRejection = z.infer<
  typeof seasonSpectatePostseasonGameRejectionSchema
>;
export const seasonFastForwardPostseasonCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('fast-forward-postseason'),
  targetGameId: postseasonGameIdSchema.optional(),
});
export type SeasonFastForwardPostseasonCommand = z.infer<
  typeof seasonFastForwardPostseasonCommandSchema
>;
export const seasonFastForwardPostseasonRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonInvalidStageRejectionSchema,
  seasonIntegrityFailureRejectionSchema,
]);
export type SeasonFastForwardPostseasonRejection = z.infer<
  typeof seasonFastForwardPostseasonRejectionSchema
>;
export const seasonSelectBlockObjectiveCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('select-block-objective'),
  blockIndex: objectiveBlockIndexSchema,
  objectiveId: seasonObjectiveIdSchema,
});
export type SeasonSelectBlockObjectiveCommand = z.infer<
  typeof seasonSelectBlockObjectiveCommandSchema
>;
export const seasonSelectBlockObjectiveRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonNotAtBoundaryRejectionSchema,
  seasonObjectiveNotOfferedRejectionSchema,
  seasonObjectiveAlreadySelectedRejectionSchema,
]);
export type SeasonSelectBlockObjectiveRejection = z.infer<
  typeof seasonSelectBlockObjectiveRejectionSchema
>;
export const seasonSpendInfluenceCommandSchema = seasonRunCommandBaseSchema
  .extend({
    command: z.literal('spend-influence'),
    franchiseId: franchiseIdSchema,
    purpose: z.enum(['extra-trade-offer', 'risky-rehab']),
    windowIndex: windowIndexSchema.optional(),
    injuryId: injuryIdSchema.optional(),
  })
  .superRefine((command, ctx) => {
    if (command.purpose === 'extra-trade-offer' && command.windowIndex === undefined) {
      ctx.addIssue({ code: 'custom', message: 'extra-trade-offer spend requires windowIndex' });
    }
    if (command.purpose === 'extra-trade-offer' && command.injuryId !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'extra-trade-offer spend takes no injuryId' });
    }
    if (command.purpose === 'risky-rehab' && command.injuryId === undefined) {
      ctx.addIssue({ code: 'custom', message: 'risky-rehab spend requires injuryId' });
    }
    if (command.purpose === 'risky-rehab' && command.windowIndex !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'risky-rehab spend takes no windowIndex' });
    }
  });
export type SeasonSpendInfluenceCommand = z.infer<typeof seasonSpendInfluenceCommandSchema>;
export const seasonSpendInfluenceRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonInsufficientBalanceRejectionSchema,
  seasonWindowNotOpenRejectionSchema,
  seasonAlreadySpentRejectionSchema,
  seasonInjuryNotActiveRejectionSchema,
  seasonAlreadyRehabbedRejectionSchema,
  seasonNoWindowRejectionSchema,
]);
export type SeasonSpendInfluenceRejection = z.infer<typeof seasonSpendInfluenceRejectionSchema>;
export const seasonAcceptTradeOfferCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('accept-trade-offer'),
  windowIndex: windowIndexSchema,
  offerId: seasonTradeOfferIdSchema,
});
export type SeasonAcceptTradeOfferCommand = z.infer<typeof seasonAcceptTradeOfferCommandSchema>;
export const seasonAcceptTradeOfferRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonOfferUnknownRejectionSchema,
  seasonWindowNotOpenRejectionSchema,
  seasonOfferNotOpenRejectionSchema,
  seasonRosterIllegalRejectionSchema,
  seasonOwnershipConflictRejectionSchema,
]);
export type SeasonAcceptTradeOfferRejection = z.infer<typeof seasonAcceptTradeOfferRejectionSchema>;
export const seasonDeclineTradeOfferCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('decline-trade-offer'),
  windowIndex: windowIndexSchema,
  offerId: seasonTradeOfferIdSchema,
});
export type SeasonDeclineTradeOfferCommand = z.infer<typeof seasonDeclineTradeOfferCommandSchema>;
export const seasonDeclineTradeOfferRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonOfferUnknownRejectionSchema,
  seasonWindowNotOpenRejectionSchema,
  seasonOfferNotOpenRejectionSchema,
]);
export type SeasonDeclineTradeOfferRejection = z.infer<
  typeof seasonDeclineTradeOfferRejectionSchema
>;
export const seasonResumeSeasonBlockCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('resume-season-block'),
  blockIndex: blockIndexSchema,
  rotationDigest: seasonRotationSetDigestSchema,
});
export type SeasonResumeSeasonBlockCommand = z.infer<typeof seasonResumeSeasonBlockCommandSchema>;
export const seasonResumeSeasonBlockRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonNoPendingBlockRejectionSchema,
  seasonBlockMismatchRejectionSchema,
  seasonRotationDigestMismatchRejectionSchema,
]);
export type SeasonResumeSeasonBlockRejection = z.infer<
  typeof seasonResumeSeasonBlockRejectionSchema
>;
export const seasonForfeitInterruptedGameCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('forfeit-interrupted-game'),
  blockIndex: blockIndexSchema,
  nextGameId: seasonGameIdSchema,
});
export type SeasonForfeitInterruptedGameCommand = z.infer<
  typeof seasonForfeitInterruptedGameCommandSchema
>;
export const seasonForfeitInterruptedGameRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonNoPendingBlockRejectionSchema,
  seasonBlockMismatchRejectionSchema,
  seasonGameMismatchRejectionSchema,
]);
export type SeasonForfeitInterruptedGameRejection = z.infer<
  typeof seasonForfeitInterruptedGameRejectionSchema
>;
export const seasonCampaignIdentityRequiredRejectionSchema = z.object({
  code: z.literal('campaign-identity-required'),
});
export type SeasonCampaignIdentityRequiredRejection = z.infer<
  typeof seasonCampaignIdentityRequiredRejectionSchema
>;
export const seasonCampaignEvolutionRequiredRejectionSchema = z.object({
  code: z.literal('campaign-evolution-required'),
  afterBlockIndex: z.number().int().min(4).max(4),
});
export type SeasonCampaignEvolutionRequiredRejection = z.infer<
  typeof seasonCampaignEvolutionRequiredRejectionSchema
>;
export const seasonCampaignOpportunityRequiredRejectionSchema = z.object({
  code: z.literal('campaign-opportunity-required'),
  blockIndex: objectiveBlockIndexSchema,
});
export type SeasonCampaignOpportunityRequiredRejection = z.infer<
  typeof seasonCampaignOpportunityRequiredRejectionSchema
>;
export const seasonCampaignOpportunityNotOfferedRejectionSchema = z.object({
  code: z.literal('campaign-opportunity-not-offered'),
  blockIndex: objectiveBlockIndexSchema,
  opportunityId: seasonCampaignOpportunityIdSchema,
  offeredOpportunityIds: z.array(seasonCampaignOpportunityIdSchema).length(2),
});
export type SeasonCampaignOpportunityNotOfferedRejection = z.infer<
  typeof seasonCampaignOpportunityNotOfferedRejectionSchema
>;
export const seasonCampaignAlreadySelectedRejectionSchema = z.object({
  code: z.literal('campaign-already-selected'),
  blockIndex: objectiveBlockIndexSchema,
});
export type SeasonCampaignAlreadySelectedRejection = z.infer<
  typeof seasonCampaignAlreadySelectedRejectionSchema
>;
export const seasonCampaignIdentityAlreadySelectedRejectionSchema = z.object({
  code: z.literal('campaign-identity-already-selected'),
});
export type SeasonCampaignIdentityAlreadySelectedRejection = z.infer<
  typeof seasonCampaignIdentityAlreadySelectedRejectionSchema
>;
export const seasonCampaignEvolutionAlreadySelectedRejectionSchema = z.object({
  code: z.literal('campaign-evolution-already-selected'),
});
export type SeasonCampaignEvolutionAlreadySelectedRejection = z.infer<
  typeof seasonCampaignEvolutionAlreadySelectedRejectionSchema
>;
export const seasonCampaignEvolutionNotOfferedRejectionSchema = z.object({
  code: z.literal('campaign-evolution-not-offered'),
  offerId: z.string().regex(/^evo-[0-9a-f]{8,32}$/),
});
export type SeasonCampaignEvolutionNotOfferedRejection = z.infer<
  typeof seasonCampaignEvolutionNotOfferedRejectionSchema
>;
export const seasonTradeInquiryCapRejectionSchema = z.object({
  code: z.literal('trade-inquiry-cap'),
  windowIndex: windowIndexSchema,
  inquiriesUsed: z.number().int().min(0).max(5),
  allowance: z.number().int().min(3).max(5),
});
export type SeasonTradeInquiryCapRejection = z.infer<typeof seasonTradeInquiryCapRejectionSchema>;
export const seasonTradeActiveNegotiationRejectionSchema = z.object({
  code: z.literal('trade-active-negotiation'),
  windowIndex: windowIndexSchema,
  activeInquiryId: inquiryIdSchema,
});
export type SeasonTradeActiveNegotiationRejection = z.infer<
  typeof seasonTradeActiveNegotiationRejectionSchema
>;
export const seasonTradeDuplicateProposalRejectionSchema = z.object({
  code: z.literal('trade-duplicate-proposal'),
  fingerprint: z.string().min(1).max(128),
});
export type SeasonTradeDuplicateProposalRejection = z.infer<
  typeof seasonTradeDuplicateProposalRejectionSchema
>;
export const seasonTradeProtectedPlayerRejectionSchema = z.object({
  code: z.literal('trade-protected-player'),
  playerVersionId: playerVersionIdSchema,
});
export type SeasonTradeProtectedPlayerRejection = z.infer<
  typeof seasonTradeProtectedPlayerRejectionSchema
>;
export const seasonTradeExchangeLimitRejectionSchema = z.object({
  code: z.literal('trade-exchange-limit'),
  windowIndex: windowIndexSchema,
  inquiryId: inquiryIdSchema,
  exchangeCount: z.number().int().min(0).max(3),
});
export type SeasonTradeExchangeLimitRejection = z.infer<
  typeof seasonTradeExchangeLimitRejectionSchema
>;
export const seasonTradeCashCapRejectionSchema = z.object({
  code: z.literal('trade-cash-cap'),
  franchiseId: franchiseIdSchema,
  windowIndex: windowIndexSchema,
  sent: z.number().int().min(0).max(2),
  requested: z.number().int().min(1).max(2),
});
export type SeasonTradeCashCapRejection = z.infer<typeof seasonTradeCashCapRejectionSchema>;
export const seasonTradeNegotiationsClosedRejectionSchema = z.object({
  code: z.literal('trade-negotiations-closed'),
  windowIndex: windowIndexSchema,
});
export type SeasonTradeNegotiationsClosedRejection = z.infer<
  typeof seasonTradeNegotiationsClosedRejectionSchema
>;
export const seasonTradeAvailabilityRiskRejectionSchema = z.object({
  code: z.literal('trade-availability-risk'),
  playerVersionId: playerVersionIdSchema,
});
export type SeasonTradeAvailabilityRiskRejection = z.infer<
  typeof seasonTradeAvailabilityRiskRejectionSchema
>;
export const seasonTradeWrongFitRejectionSchema = z.object({
  code: z.literal('trade-wrong-fit'),
  reason: z.string().min(1).max(512),
});
export type SeasonTradeWrongFitRejection = z.infer<typeof seasonTradeWrongFitRejectionSchema>;
export const seasonTradeInsufficientTalentRejectionSchema = z.object({
  code: z.literal('trade-insufficient-talent'),
  reason: z.string().min(1).max(512),
});
export type SeasonTradeInsufficientTalentRejection = z.infer<
  typeof seasonTradeInsufficientTalentRejectionSchema
>;
export const seasonSelectGmIdentityCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('select-gm-identity'),
  identity: seasonCampaignGmIdentitySchema,
  focus: seasonCampaignFocusSchema.nullable(),
});
export type SeasonSelectGmIdentityCommand = z.infer<typeof seasonSelectGmIdentityCommandSchema>;
export const seasonSelectCampaignOpportunityCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('select-campaign-opportunity'),
  blockIndex: objectiveBlockIndexSchema,
  opportunityId: seasonCampaignOpportunityIdSchema,
});
export type SeasonSelectCampaignOpportunityCommand = z.infer<
  typeof seasonSelectCampaignOpportunityCommandSchema
>;
export const seasonEvolveGmCampaignCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('evolve-gm-campaign'),
  offerId: z.string().regex(/^evo-[0-9a-f]{8,32}$/),
});
export type SeasonEvolveGmCampaignCommand = z.infer<typeof seasonEvolveGmCampaignCommandSchema>;
export const seasonOpenTradeInquiryCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('open-trade-inquiry'),
  windowIndex: windowIndexSchema,
  toFranchiseId: franchiseIdSchema,
});
export type SeasonOpenTradeInquiryCommand = z.infer<typeof seasonOpenTradeInquiryCommandSchema>;
export const seasonSubmitTradeProposalCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('submit-trade-proposal'),
  windowIndex: windowIndexSchema,
  toFranchiseId: franchiseIdSchema,
  outgoingPlayerVersionIds: z.array(playerVersionIdSchema).min(1).max(2),
  incomingPlayerVersionIds: z.array(playerVersionIdSchema).min(1).max(2),
  influenceAmount: z.number().int().min(0).max(2),
  influenceFromSender: franchiseIdSchema.nullable(),
});
export type SeasonSubmitTradeProposalCommand = z.infer<
  typeof seasonSubmitTradeProposalCommandSchema
>;
export const seasonRespondToTradeCounterCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('respond-to-trade-counter'),
  windowIndex: windowIndexSchema,
  inquiryId: inquiryIdSchema,
  accept: z.boolean(),
});
export type SeasonRespondToTradeCounterCommand = z.infer<
  typeof seasonRespondToTradeCounterCommandSchema
>;
export const seasonWalkAwayFromTradeCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('walk-away-from-trade'),
  windowIndex: windowIndexSchema,
  inquiryId: inquiryIdSchema,
});
export type SeasonWalkAwayFromTradeCommand = z.infer<typeof seasonWalkAwayFromTradeCommandSchema>;
export const seasonPurchaseTradeInquiryCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('purchase-trade-inquiry'),
  windowIndex: windowIndexSchema,
});
export type SeasonPurchaseTradeInquiryCommand = z.infer<
  typeof seasonPurchaseTradeInquiryCommandSchema
>;
export const seasonSelectGmIdentityRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonCampaignIdentityAlreadySelectedRejectionSchema,
]);
export type SeasonSelectGmIdentityRejection = z.infer<typeof seasonSelectGmIdentityRejectionSchema>;
export const seasonSelectCampaignOpportunityRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonCampaignIdentityRequiredRejectionSchema,
  seasonCampaignEvolutionRequiredRejectionSchema,
  seasonCampaignOpportunityNotOfferedRejectionSchema,
  seasonCampaignAlreadySelectedRejectionSchema,
]);
export type SeasonSelectCampaignOpportunityRejection = z.infer<
  typeof seasonSelectCampaignOpportunityRejectionSchema
>;
export const seasonEvolveGmCampaignRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonCampaignIdentityRequiredRejectionSchema,
  seasonCampaignEvolutionAlreadySelectedRejectionSchema,
  seasonCampaignEvolutionNotOfferedRejectionSchema,
]);
export type SeasonEvolveGmCampaignRejection = z.infer<typeof seasonEvolveGmCampaignRejectionSchema>;
export const seasonOpenTradeInquiryRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonWindowNotOpenRejectionSchema,
  seasonTradeActiveNegotiationRejectionSchema,
  seasonTradeInquiryCapRejectionSchema,
]);
export type SeasonOpenTradeInquiryRejection = z.infer<typeof seasonOpenTradeInquiryRejectionSchema>;
export const seasonSubmitTradeProposalRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonWindowNotOpenRejectionSchema,
  seasonTradeActiveNegotiationRejectionSchema,
  seasonTradeInquiryCapRejectionSchema,
  seasonTradeDuplicateProposalRejectionSchema,
  seasonTradeProtectedPlayerRejectionSchema,
  seasonRosterIllegalRejectionSchema,
  seasonOwnershipConflictRejectionSchema,
  seasonTradeAvailabilityRiskRejectionSchema,
  seasonTradeInsufficientTalentRejectionSchema,
  seasonFrontOfficeAlreadySelectedRejectionSchema,
  seasonFrontOfficeTooLateRejectionSchema,
  seasonFrontOfficeInvalidRejectionSchema,
  seasonInnovationNotDiscoveredRejectionSchema,
  seasonInnovationAlreadySelectedRejectionSchema,
  seasonInnovationInvalidRejectionSchema,
  seasonTradeWrongFitRejectionSchema,
  seasonTradeExchangeLimitRejectionSchema,
  seasonInsufficientBalanceRejectionSchema,
  seasonTradeCashCapRejectionSchema,
  seasonTradeNegotiationsClosedRejectionSchema,
]);
export type SeasonSubmitTradeProposalRejection = z.infer<
  typeof seasonSubmitTradeProposalRejectionSchema
>;
export const seasonRespondToTradeCounterRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonWindowNotOpenRejectionSchema,
  seasonTradeExchangeLimitRejectionSchema,
  seasonTradeNegotiationsClosedRejectionSchema,
]);
export type SeasonRespondToTradeCounterRejection = z.infer<
  typeof seasonRespondToTradeCounterRejectionSchema
>;
export const seasonWalkAwayFromTradeRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonWindowNotOpenRejectionSchema,
]);
export type SeasonWalkAwayFromTradeRejection = z.infer<
  typeof seasonWalkAwayFromTradeRejectionSchema
>;
export const seasonPurchaseTradeInquiryRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonWindowNotOpenRejectionSchema,
  seasonAlreadySpentRejectionSchema,
  seasonInsufficientBalanceRejectionSchema,
  seasonTradeInquiryCapRejectionSchema,
]);
export type SeasonPurchaseTradeInquiryRejection = z.infer<
  typeof seasonPurchaseTradeInquiryRejectionSchema
>;
export const seasonTradeRosterChangeSchema = z.object({
  franchiseId: franchiseIdSchema,
  added: z.array(playerVersionIdSchema).min(1).max(2),
  removed: z.array(playerVersionIdSchema).min(1).max(2),
});
export type SeasonTradeRosterChange = z.infer<typeof seasonTradeRosterChangeSchema>;
export const seasonSelectBlockObjectiveResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonSelectBlockObjectiveRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    blockIndex: objectiveBlockIndexSchema,
    objectiveId: seasonObjectiveIdSchema,
  }),
]);
export type SeasonSelectBlockObjectiveResult = z.infer<
  typeof seasonSelectBlockObjectiveResultSchema
>;
export const seasonSpendInfluenceResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonSpendInfluenceRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    franchiseId: franchiseIdSchema,
    purpose: z.enum(['extra-trade-offer', 'risky-rehab']),
    ledgerEntry: seasonInfluenceLedgerEntrySchema,
    generatedOffer: seasonTradeOfferSchema.nullable(),
  }),
]);
export type SeasonSpendInfluenceResult = z.infer<typeof seasonSpendInfluenceResultSchema>;
export const seasonAcceptTradeOfferResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonAcceptTradeOfferRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    trade: seasonTradeOfferSchema,
    rosterChanges: z.array(seasonTradeRosterChangeSchema).length(2),
  }),
]);
export type SeasonAcceptTradeOfferResult = z.infer<typeof seasonAcceptTradeOfferResultSchema>;
export const seasonDeclineTradeOfferResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonDeclineTradeOfferRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    windowIndex: windowIndexSchema,
    offerId: seasonTradeOfferIdSchema,
  }),
]);
export type SeasonDeclineTradeOfferResult = z.infer<typeof seasonDeclineTradeOfferResultSchema>;
export const seasonResumeSeasonBlockResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonResumeSeasonBlockRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    blockIndex: blockIndexSchema,
    nextGameId: seasonGameIdSchema,
  }),
]);
export type SeasonResumeSeasonBlockResult = z.infer<typeof seasonResumeSeasonBlockResultSchema>;
export const seasonForfeitInterruptedGameResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonForfeitInterruptedGameRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    blockIndex: blockIndexSchema,
    forfeitedGameId: seasonGameIdSchema,
    nextGameId: seasonGameIdSchema,
  }),
]);
export type SeasonForfeitInterruptedGameResult = z.infer<
  typeof seasonForfeitInterruptedGameResultSchema
>;
export const seasonPostseasonAdvanceResultSchema = z.object({
  status: z.literal('accepted'),
  commandId: commandIdSchema,
  stage: seasonRunStageSchema,
  advancedGameIds: z.array(postseasonGameIdSchema),
  nextDecision: z.enum(['rotation', 'none']),
  nextGameId: postseasonGameIdSchema.nullable(),
  aiNextGameId: postseasonGameIdSchema.nullable(),
});
export const seasonStartPostseasonResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonStartPostseasonRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    stage: z.literal('play-in'),
    postseasonSeed: z.string().regex(/^[0-9a-f]{16,64}$/),
    nextGameId: z.string().regex(/^pi-(east|west)-(seven-eight|nine-ten|final)$/),
  }),
]);
export type SeasonStartPostseasonResult = z.infer<typeof seasonStartPostseasonResultSchema>;
export const seasonAdvancePostseasonResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonAdvancePostseasonRejectionSchema,
  }),
  seasonPostseasonAdvanceResultSchema,
]);
export type SeasonAdvancePostseasonResult = z.infer<typeof seasonAdvancePostseasonResultSchema>;
export const seasonSubmitPostseasonRotationResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonSubmitPostseasonRotationRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    targetGameId: postseasonGameIdSchema,
    franchiseId: franchiseIdSchema,
    rotationDigest: seasonRotationSetDigestSchema,
  }),
]);
export type SeasonSubmitPostseasonRotationResult = z.infer<
  typeof seasonSubmitPostseasonRotationResultSchema
>;
export const seasonSpectatePostseasonGameResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonSpectatePostseasonGameRejectionSchema,
  }),
  seasonPostseasonAdvanceResultSchema,
]);
export type SeasonSpectatePostseasonGameResult = z.infer<
  typeof seasonSpectatePostseasonGameResultSchema
>;
export const seasonFastForwardPostseasonResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonFastForwardPostseasonRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    stage: z.literal('completed'),
    championFranchiseId: franchiseIdSchema,
  }),
]);
export type SeasonFastForwardPostseasonResult = z.infer<
  typeof seasonFastForwardPostseasonResultSchema
>;
export const seasonSelectGmIdentityResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonSelectGmIdentityRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    identity: seasonCampaignGmIdentitySchema,
    focus: seasonCampaignFocusSchema.nullable(),
  }),
]);
export type SeasonSelectGmIdentityResult = z.infer<typeof seasonSelectGmIdentityResultSchema>;
export const seasonSelectCampaignOpportunityResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonSelectCampaignOpportunityRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    blockIndex: objectiveBlockIndexSchema,
    opportunityId: seasonCampaignOpportunityIdSchema,
  }),
]);
export type SeasonSelectCampaignOpportunityResult = z.infer<
  typeof seasonSelectCampaignOpportunityResultSchema
>;
export const seasonEvolveGmCampaignResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonEvolveGmCampaignRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    offerId: z.string().regex(/^evo-[0-9a-f]{8,32}$/),
  }),
]);
export type SeasonEvolveGmCampaignResult = z.infer<typeof seasonEvolveGmCampaignResultSchema>;
export const seasonOpenTradeInquiryResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonOpenTradeInquiryRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    windowIndex: windowIndexSchema,
    inquiryId: inquiryIdSchema,
  }),
]);
export type SeasonOpenTradeInquiryResult = z.infer<typeof seasonOpenTradeInquiryResultSchema>;
export const seasonSubmitTradeProposalResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonSubmitTradeProposalRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    windowIndex: windowIndexSchema,
    inquiryId: inquiryIdSchema,
    proposalId: z.string().regex(/^prop-[0-9a-f]{32}$/),
  }),
]);
export type SeasonSubmitTradeProposalResult = z.infer<typeof seasonSubmitTradeProposalResultSchema>;
export const seasonRespondToTradeCounterResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonRespondToTradeCounterRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    windowIndex: windowIndexSchema,
    inquiryId: inquiryIdSchema,
  }),
]);
export type SeasonRespondToTradeCounterResult = z.infer<
  typeof seasonRespondToTradeCounterResultSchema
>;
export const seasonWalkAwayFromTradeResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonWalkAwayFromTradeRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    windowIndex: windowIndexSchema,
    inquiryId: inquiryIdSchema,
  }),
]);
export type SeasonWalkAwayFromTradeResult = z.infer<typeof seasonWalkAwayFromTradeResultSchema>;
export const seasonPurchaseTradeInquiryResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: seasonPurchaseTradeInquiryRejectionSchema,
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    windowIndex: windowIndexSchema,
  }),
]);
export type SeasonPurchaseTradeInquiryResult = z.infer<
  typeof seasonPurchaseTradeInquiryResultSchema
>;
export const seasonRunCommandSchema = z.discriminatedUnion('command', [
  seasonSelectBlockObjectiveCommandSchema,
  seasonSpendInfluenceCommandSchema,
  seasonAcceptTradeOfferCommandSchema,
  seasonDeclineTradeOfferCommandSchema,
  seasonResumeSeasonBlockCommandSchema,
  seasonForfeitInterruptedGameCommandSchema,
  seasonSubmitBlockCommandSchema,
  seasonStartPostseasonCommandSchema,
  seasonAdvancePostseasonCommandSchema,
  seasonSubmitPostseasonRotationCommandSchema,
  seasonSpectatePostseasonGameCommandSchema,
  seasonFastForwardPostseasonCommandSchema,
  seasonDeclareFreeAgentInterestCommandSchema,
  seasonSkipFreeAgentMarketCommandSchema,
  seasonResolveFreeAgentMarketCommandSchema,
  seasonSelectGmIdentityCommandSchema,
  seasonSelectCampaignOpportunityCommandSchema,
  seasonEvolveGmCampaignCommandSchema,
  seasonOpenTradeInquiryCommandSchema,
  seasonSubmitTradeProposalCommandSchema,
  seasonRespondToTradeCounterCommandSchema,
  seasonWalkAwayFromTradeCommandSchema,
  seasonPurchaseTradeInquiryCommandSchema,
  seasonSelectFrontOfficeCommandSchema,
  seasonSelectCourtInnovationCommandSchema,
]);
export type SeasonRunCommand = z.infer<typeof seasonRunCommandSchema>;
export const seasonRunCommandRejectionSchema = z.discriminatedUnion('code', [
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
  seasonDuplicateCommandRejectionSchema,
  seasonNotAtBoundaryRejectionSchema,
  seasonObjectiveNotOfferedRejectionSchema,
  seasonObjectiveAlreadySelectedRejectionSchema,
  seasonInsufficientBalanceRejectionSchema,
  seasonWindowNotOpenRejectionSchema,
  seasonAlreadySpentRejectionSchema,
  seasonInjuryNotActiveRejectionSchema,
  seasonAlreadyRehabbedRejectionSchema,
  seasonNoWindowRejectionSchema,
  seasonOfferUnknownRejectionSchema,
  seasonOfferNotOpenRejectionSchema,
  seasonRosterIllegalRejectionSchema,
  seasonOwnershipConflictRejectionSchema,
  seasonNoPendingBlockRejectionSchema,
  seasonBlockMismatchRejectionSchema,
  seasonRotationDigestMismatchRejectionSchema,
  seasonGameMismatchRejectionSchema,
  seasonInvalidStageRejectionSchema,
  seasonWrongGameRejectionSchema,
  seasonInvalidRotationRejectionSchema,
  seasonUnavailablePlayerRejectionSchema,
  seasonInsufficientRehabResourcesRejectionSchema,
  seasonInvalidSeriesStateRejectionSchema,
  seasonIntegrityFailureRejectionSchema,
  seasonFreeAgencyUnresolvedRejectionSchema,
  seasonFreeAgencyWindowNotOpenRejectionSchema,
  seasonFreeAgencyAlreadyResolvedRejectionSchema,
  seasonFreeAgencyAlreadyDeclaredRejectionSchema,
  seasonFreeAgencyTargetIneligibleRejectionSchema,
  seasonFreeAgencyDuplicateIdentityRejectionSchema,
  seasonFreeAgencyInvalidPriorityRejectionSchema,
  seasonFreeAgencyUnsupportedRoleRejectionSchema,
  seasonFreeAgencyInvalidInfluenceRejectionSchema,
  seasonFreeAgencyRosterCapRejectionSchema,
  seasonFreeAgencySeasonSigningCapRejectionSchema,
  seasonFreeAgencySeasonInfluenceCapRejectionSchema,
  seasonFreeAgencyInsufficientBalanceRejectionSchema,
  seasonFreeAgencyPendingDeclarationRejectionSchema,
  seasonFreeAgencyOwnershipConflictRejectionSchema,
  seasonCampaignIdentityRequiredRejectionSchema,
  seasonCampaignEvolutionRequiredRejectionSchema,
  seasonCampaignOpportunityRequiredRejectionSchema,
  seasonCampaignOpportunityNotOfferedRejectionSchema,
  seasonCampaignAlreadySelectedRejectionSchema,
  seasonCampaignIdentityAlreadySelectedRejectionSchema,
  seasonCampaignEvolutionAlreadySelectedRejectionSchema,
  seasonCampaignEvolutionNotOfferedRejectionSchema,
  seasonTradeInquiryCapRejectionSchema,
  seasonTradeActiveNegotiationRejectionSchema,
  seasonTradeDuplicateProposalRejectionSchema,
  seasonTradeProtectedPlayerRejectionSchema,
  seasonTradeExchangeLimitRejectionSchema,
  seasonTradeCashCapRejectionSchema,
  seasonTradeNegotiationsClosedRejectionSchema,
  seasonTradeAvailabilityRiskRejectionSchema,
  seasonTradeWrongFitRejectionSchema,
  seasonTradeInsufficientTalentRejectionSchema,
  seasonFrontOfficeAlreadySelectedRejectionSchema,
  seasonFrontOfficeTooLateRejectionSchema,
  seasonFrontOfficeInvalidRejectionSchema,
  seasonInnovationNotDiscoveredRejectionSchema,
  seasonInnovationAlreadySelectedRejectionSchema,
  seasonInnovationInvalidRejectionSchema,
]);
export type SeasonRunCommandRejection = z.infer<typeof seasonRunCommandRejectionSchema>;
