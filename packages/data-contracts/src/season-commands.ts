import { z } from 'zod';
import { commandIdSchema, franchiseIdSchema, seasonGameIdSchema } from './ids.ts';
import {
  seasonDuplicateCommandRejectionSchema,
  seasonFreeAgencyUnresolvedRejectionSchema,
  seasonRunMismatchRejectionSchema,
  seasonSubmitBlockCommandSchema,
} from './season-block.ts';
import { seasonRunCommandBaseSchema } from './season-command-base.ts';
import { seasonCheckpointDigestSchema, seasonRotationSetDigestSchema } from './season-digests.ts';
import {
  seasonFreeAgencyRoleExpectationSchema,
  seasonFreeAgencySigningSchema,
  seasonFreeAgencyTargetSchema,
} from './season-free-agency.ts';
import { injuryIdSchema } from './season-health.ts';
import { seasonInfluenceLedgerEntrySchema } from './season-influence.ts';
import { seasonObjectiveIdSchema } from './season-objective.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { seasonTradeOfferIdSchema, seasonTradeOfferSchema } from './season-trade.ts';
import { postseasonGameIdSchema } from './season-postseason.ts';
import { seasonRotationSchema } from './season-rotation.ts';
import { seasonRunStageSchema } from './season-run.ts';

export { seasonRunCommandBaseSchema, type SeasonRunCommandBase } from './season-command-base.ts';

export const seasonStaleStateRejectionSchema = z.object({
  code: z.literal('stale-state'),
  expectedStateRevision: z.number().int().nonnegative(),
  expectedStateDigest: seasonCheckpointDigestSchema,
  currentStateRevision: z.number().int().nonnegative(),
  currentStateDigest: seasonCheckpointDigestSchema,
});
export type SeasonStaleStateRejection = z.infer<typeof seasonStaleStateRejectionSchema>;

export const seasonNotAtBoundaryRejectionSchema = z.object({
  code: z.literal('not-at-boundary'),

  blockIndex: z.number().int().min(0).max(7),

  nextUnselectedBlockIndex: z.number().int().min(0).max(7),
});
export type SeasonNotAtBoundaryRejection = z.infer<typeof seasonNotAtBoundaryRejectionSchema>;

export const seasonObjectiveNotOfferedRejectionSchema = z.object({
  code: z.literal('objective-not-offered'),
  blockIndex: z.number().int().min(0).max(7),
  objectiveId: seasonObjectiveIdSchema,

  offeredObjectiveIds: z.array(seasonObjectiveIdSchema).length(3),
});
export type SeasonObjectiveNotOfferedRejection = z.infer<
  typeof seasonObjectiveNotOfferedRejectionSchema
>;

export const seasonObjectiveAlreadySelectedRejectionSchema = z.object({
  code: z.literal('objective-already-selected'),
  blockIndex: z.number().int().min(0).max(7),
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
  windowIndex: z.number().int().min(0).max(2),
});
export type SeasonWindowNotOpenRejection = z.infer<typeof seasonWindowNotOpenRejectionSchema>;

export const seasonAlreadySpentRejectionSchema = z.object({
  code: z.literal('already-spent'),
  franchiseId: franchiseIdSchema,
  windowIndex: z.number().int().min(0).max(2),
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
  windowIndex: z.number().int().min(0).max(2),
  offerId: seasonTradeOfferIdSchema,
});
export type SeasonOfferUnknownRejection = z.infer<typeof seasonOfferUnknownRejectionSchema>;

export const seasonOfferNotOpenRejectionSchema = z.object({
  code: z.literal('offer-not-open'),
  windowIndex: z.number().int().min(0).max(2),
  offerId: seasonTradeOfferIdSchema,
});
export type SeasonOfferNotOpenRejection = z.infer<typeof seasonOfferNotOpenRejectionSchema>;

export const seasonRosterIllegalRejectionSchema = z.object({
  code: z.literal('roster-illegal'),
  windowIndex: z.number().int().min(0).max(2),
  offerId: seasonTradeOfferIdSchema,

  reasons: z.array(z.string().min(1).max(256)).min(1),
});
export type SeasonRosterIllegalRejection = z.infer<typeof seasonRosterIllegalRejectionSchema>;

export const seasonOwnershipConflictRejectionSchema = z.object({
  code: z.literal('ownership-conflict'),
  windowIndex: z.number().int().min(0).max(2),
  offerId: seasonTradeOfferIdSchema,

  playerVersionIds: z.array(playerVersionIdSchema).min(1),
});
export type SeasonOwnershipConflictRejection = z.infer<
  typeof seasonOwnershipConflictRejectionSchema
>;

export const seasonNoPendingBlockRejectionSchema = z.object({
  code: z.literal('no-pending-block'),
  blockIndex: z.number().int().min(0).max(8),
});
export type SeasonNoPendingBlockRejection = z.infer<typeof seasonNoPendingBlockRejectionSchema>;

export const seasonBlockMismatchRejectionSchema = z.object({
  code: z.literal('block-mismatch'),
  blockIndex: z.number().int().min(0).max(8),
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
  windowIndex: z.number().int().min(0).max(2),
});
export type SeasonFreeAgencyWindowNotOpenRejection = z.infer<
  typeof seasonFreeAgencyWindowNotOpenRejectionSchema
>;

export const seasonFreeAgencyAlreadyResolvedRejectionSchema = z.object({
  code: z.literal('free-agency-already-resolved'),
  windowIndex: z.number().int().min(0).max(2),
});
export type SeasonFreeAgencyAlreadyResolvedRejection = z.infer<
  typeof seasonFreeAgencyAlreadyResolvedRejectionSchema
>;

export const seasonFreeAgencyAlreadyDeclaredRejectionSchema = z.object({
  code: z.literal('free-agency-already-declared'),
  franchiseId: franchiseIdSchema,
  windowIndex: z.number().int().min(0).max(2),
});
export type SeasonFreeAgencyAlreadyDeclaredRejection = z.infer<
  typeof seasonFreeAgencyAlreadyDeclaredRejectionSchema
>;

export const seasonFreeAgencyTargetIneligibleRejectionSchema = z.object({
  code: z.literal('free-agency-target-ineligible'),
  windowIndex: z.number().int().min(0).max(2),
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
  windowIndex: z.number().int().min(0).max(2),
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
  windowIndex: z.number().int().min(0).max(2),

  targets: z.array(seasonFreeAgencyTargetSchema).min(1).max(2),
});
export type SeasonDeclareFreeAgentInterestCommand = z.infer<
  typeof seasonDeclareFreeAgentInterestCommandSchema
>;

export const seasonSkipFreeAgentMarketCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('skip-free-agent-market'),
  franchiseId: franchiseIdSchema,
  windowIndex: z.number().int().min(0).max(2),
});
export type SeasonSkipFreeAgentMarketCommand = z.infer<
  typeof seasonSkipFreeAgentMarketCommandSchema
>;

export const seasonResolveFreeAgentMarketCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('resolve-free-agent-market'),
  windowIndex: z.number().int().min(0).max(2),
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
    windowIndex: z.number().int().min(0).max(2),

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
    windowIndex: z.number().int().min(0).max(2),
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
    windowIndex: z.number().int().min(0).max(2),

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
  blockIndex: z.number().int().min(0).max(7),
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
    windowIndex: z.number().int().min(0).max(2).optional(),
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
  windowIndex: z.number().int().min(0).max(2),
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
  windowIndex: z.number().int().min(0).max(2),
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
  blockIndex: z.number().int().min(0).max(8),
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
  blockIndex: z.number().int().min(0).max(8),
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
    blockIndex: z.number().int().min(0).max(7),
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
    windowIndex: z.number().int().min(0).max(2),
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
    blockIndex: z.number().int().min(0).max(8),
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
    blockIndex: z.number().int().min(0).max(8),

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
]);
export type SeasonRunCommandRejection = z.infer<typeof seasonRunCommandRejectionSchema>;
