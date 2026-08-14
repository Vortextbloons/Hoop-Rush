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

/**
 * M2.5 typed Season Run commands (spec/2.0 M2.5, schema 7; M2.6.5 schema 10
 * adds the free-agency commands). Every command shares one base shape —
 * schema version, commandId, runId, and the expected run state
 * revision/digest the command asserts — so a handler can validate run
 * identity, state freshness (recomputed by the engine), and commandId
 * uniqueness uniformly before evaluating deterministic preconditions.
 * Handlers are PURE engine functions; this file owns the wire shapes and
 * the typed rejections only.
 */

/** The base envelope every M2.5 run command composes (see season-command-base.ts). */
export { seasonRunCommandBaseSchema, type SeasonRunCommandBase } from './season-command-base.ts';

/**
 * The command asserted a stale run state: its expected revision/digest do
 * not match the run's current facts (engine recomputes the digest).
 */
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
  /** The block the command targeted. */
  blockIndex: z.number().int().min(0).max(7),
  /** The current playable block the run expects (blocks 0-7 only). */
  nextUnselectedBlockIndex: z.number().int().min(0).max(7),
});
export type SeasonNotAtBoundaryRejection = z.infer<typeof seasonNotAtBoundaryRejectionSchema>;

export const seasonObjectiveNotOfferedRejectionSchema = z.object({
  code: z.literal('objective-not-offered'),
  blockIndex: z.number().int().min(0).max(7),
  objectiveId: seasonObjectiveIdSchema,
  /** The block's deterministic three-choice set. */
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
  /** The franchise balance before the spend was rejected. */
  balance: z.number().int(),
  requestedDelta: z.number().int().negative(),
  /** The -3 floor that rejected the spend. */
  floor: z.number().int(),
});
export type SeasonInsufficientBalanceRejection = z.infer<
  typeof seasonInsufficientBalanceRejectionSchema
>;

export const seasonWindowNotOpenRejectionSchema = z.object({
  code: z.literal('window-not-open'),
  /** Null for accept/decline commands that do not name a franchise. */
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
  /** Legality reasons for the resulting rosters. */
  reasons: z.array(z.string().min(1).max(256)).min(1),
});
export type SeasonRosterIllegalRejection = z.infer<typeof seasonRosterIllegalRejectionSchema>;

export const seasonOwnershipConflictRejectionSchema = z.object({
  code: z.literal('ownership-conflict'),
  windowIndex: z.number().int().min(0).max(2),
  offerId: seasonTradeOfferIdSchema,
  /** Versions that would appear on two rosters after the trade. */
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

// ---------------------------------------------------------------------------
// M2.6.5 free-agency commands and typed rejections (spec/2.0/15).
// ---------------------------------------------------------------------------

/**
 * Re-exported from season-block.ts (the submit-block rejection union owns
 * it; both surfaces share the literal): a block submission was attempted
 * while a free-agency market window is still open.
 */
export {
  seasonFreeAgencyUnresolvedRejectionSchema,
  type SeasonFreeAgencyUnresolvedRejection,
} from './season-block.ts';

/** The named market window is not open (closed, resolved, or not yet opened). */
export const seasonFreeAgencyWindowNotOpenRejectionSchema = z.object({
  code: z.literal('free-agency-window-not-open'),
  franchiseId: franchiseIdSchema.nullable(),
  windowIndex: z.number().int().min(0).max(2),
});
export type SeasonFreeAgencyWindowNotOpenRejection = z.infer<
  typeof seasonFreeAgencyWindowNotOpenRejectionSchema
>;

/** The named market window is already resolved; no further commands apply. */
export const seasonFreeAgencyAlreadyResolvedRejectionSchema = z.object({
  code: z.literal('free-agency-already-resolved'),
  windowIndex: z.number().int().min(0).max(2),
});
export type SeasonFreeAgencyAlreadyResolvedRejection = z.infer<
  typeof seasonFreeAgencyAlreadyResolvedRejectionSchema
>;

/** The franchise already declared or skipped this window (final once accepted). */
export const seasonFreeAgencyAlreadyDeclaredRejectionSchema = z.object({
  code: z.literal('free-agency-already-declared'),
  franchiseId: franchiseIdSchema,
  windowIndex: z.number().int().min(0).max(2),
});
export type SeasonFreeAgencyAlreadyDeclaredRejection = z.infer<
  typeof seasonFreeAgencyAlreadyDeclaredRejectionSchema
>;

/** The named target is not a candidate of this window. */
export const seasonFreeAgencyTargetIneligibleRejectionSchema = z.object({
  code: z.literal('free-agency-target-ineligible'),
  windowIndex: z.number().int().min(0).max(2),
  playerVersionId: playerVersionIdSchema,
});
export type SeasonFreeAgencyTargetIneligibleRejection = z.infer<
  typeof seasonFreeAgencyTargetIneligibleRejectionSchema
>;

/** The declared identity is already represented on a roster in the league. */
export const seasonFreeAgencyDuplicateIdentityRejectionSchema = z.object({
  code: z.literal('free-agency-duplicate-identity'),
  playerId: z.string().min(1).max(64),
  playerVersionId: playerVersionIdSchema,
});
export type SeasonFreeAgencyDuplicateIdentityRejection = z.infer<
  typeof seasonFreeAgencyDuplicateIdentityRejectionSchema
>;

/** The two targets are the same version (a priority must order distinct targets). */
export const seasonFreeAgencyInvalidPriorityRejectionSchema = z.object({
  code: z.literal('free-agency-invalid-priority'),
  playerVersionId: playerVersionIdSchema,
});
export type SeasonFreeAgencyInvalidPriorityRejection = z.infer<
  typeof seasonFreeAgencyInvalidPriorityRejectionSchema
>;

/** The role expectation is not supported by the candidate. */
export const seasonFreeAgencyUnsupportedRoleRejectionSchema = z.object({
  code: z.literal('free-agency-unsupported-role'),
  playerVersionId: playerVersionIdSchema,
  roleExpectation: seasonFreeAgencyRoleExpectationSchema,
  supportedRoles: z.array(seasonFreeAgencyRoleExpectationSchema),
});
export type SeasonFreeAgencyUnsupportedRoleRejection = z.infer<
  typeof seasonFreeAgencyUnsupportedRoleRejectionSchema
>;

/** The committed Influence is below the candidate minimum or above 3. */
export const seasonFreeAgencyInvalidInfluenceRejectionSchema = z.object({
  code: z.literal('free-agency-invalid-influence'),
  playerVersionId: playerVersionIdSchema,
  influence: z.number().int(),
  minimum: z.number().int().min(1).max(3),
});
export type SeasonFreeAgencyInvalidInfluenceRejection = z.infer<
  typeof seasonFreeAgencyInvalidInfluenceRejectionSchema
>;

/** The franchise is already at the 15-player roster cap. */
export const seasonFreeAgencyRosterCapRejectionSchema = z.object({
  code: z.literal('free-agency-roster-cap'),
  franchiseId: franchiseIdSchema,
  rosterSize: z.number().int().min(10).max(15),
});
export type SeasonFreeAgencyRosterCapRejection = z.infer<
  typeof seasonFreeAgencyRosterCapRejectionSchema
>;

/** The franchise already signed three free agents this season. */
export const seasonFreeAgencySeasonSigningCapRejectionSchema = z.object({
  code: z.literal('free-agency-season-signing-cap'),
  franchiseId: franchiseIdSchema,
  signingCount: z.number().int().min(0).max(3),
});
export type SeasonFreeAgencySeasonSigningCapRejection = z.infer<
  typeof seasonFreeAgencySeasonSigningCapRejectionSchema
>;

/** The franchise already spent its 6-Influence free-agency season budget. */
export const seasonFreeAgencySeasonInfluenceCapRejectionSchema = z.object({
  code: z.literal('free-agency-season-influence-cap'),
  franchiseId: franchiseIdSchema,
  seasonSpend: z.number().int().min(0).max(6),
});
export type SeasonFreeAgencySeasonInfluenceCapRejection = z.infer<
  typeof seasonFreeAgencySeasonInfluenceCapRejectionSchema
>;

/** The franchise's available non-debt balance cannot cover the commitment. */
export const seasonFreeAgencyInsufficientBalanceRejectionSchema = z.object({
  code: z.literal('free-agency-insufficient-balance'),
  franchiseId: franchiseIdSchema,
  balance: z.number().int(),
  required: z.number().int().min(1).max(3),
});
export type SeasonFreeAgencyInsufficientBalanceRejection = z.infer<
  typeof seasonFreeAgencyInsufficientBalanceRejectionSchema
>;

/** The franchise has not yet declared or skipped; resolution cannot run. */
export const seasonFreeAgencyPendingDeclarationRejectionSchema = z.object({
  code: z.literal('free-agency-pending-declaration'),
  franchiseId: franchiseIdSchema,
  windowIndex: z.number().int().min(0).max(2),
});
export type SeasonFreeAgencyPendingDeclarationRejection = z.infer<
  typeof seasonFreeAgencyPendingDeclarationRejectionSchema
>;

/** An ownership or roster conflict would make the signing illegal. */
export const seasonFreeAgencyOwnershipConflictRejectionSchema = z.object({
  code: z.literal('free-agency-ownership-conflict'),
  franchiseId: franchiseIdSchema,
  playerVersionId: playerVersionIdSchema,
  reason: z.string().min(1).max(256),
});
export type SeasonFreeAgencyOwnershipConflictRejection = z.infer<
  typeof seasonFreeAgencyOwnershipConflictRejectionSchema
>;

/**
 * Declare interest in one or two ordered targets of an open market window.
 * Declarations are final once accepted; UI edits remain local until
 * submission. Losing, cancelled, skipped, stale, or rejected targets cost
 * zero; the winning commitment is debited at resolution.
 */
export const seasonDeclareFreeAgentInterestCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('declare-free-agent-interest'),
  franchiseId: franchiseIdSchema,
  windowIndex: z.number().int().min(0).max(2),
  /** One or two ordered targets (first priority, then second). */
  targets: z.array(seasonFreeAgencyTargetSchema).min(1).max(2),
});
export type SeasonDeclareFreeAgentInterestCommand = z.infer<
  typeof seasonDeclareFreeAgentInterestCommandSchema
>;

/**
 * Skip the open market window with no targets, no cost, and no penalty.
 */
export const seasonSkipFreeAgentMarketCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('skip-free-agent-market'),
  franchiseId: franchiseIdSchema,
  windowIndex: z.number().int().min(0).max(2),
});
export type SeasonSkipFreeAgentMarketCommand = z.infer<
  typeof seasonSkipFreeAgentMarketCommandSchema
>;

/**
 * Resolve the open market window. Accepted only after every human-controlled
 * franchise declared or skipped; AI declarations were recorded
 * deterministically when the window opened. Resolves first priorities
 * simultaneously by candidate, then second priorities for franchises that
 * did not sign; winners leave every remaining target list and at most one
 * player signs per franchise.
 */
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
    /** The recorded declaration (targets in priority order). */
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
    /** The recorded resolution trace(s) for the window. */
    traces: z.array(
      z.object({
        seedPath: z.array(z.string()).min(1),
        resolution: z.enum(['signed', 'no-signing']),
        signingFranchiseId: franchiseIdSchema.nullable(),
        signedPlayerVersionId: playerVersionIdSchema.nullable(),
      }),
    ),
    /** The immutable signings applied by this resolution. */
    signings: z.array(seasonFreeAgencySigningSchema),
    /** Whether the human franchise signed in this window. */
    humanSigned: z.boolean(),
  }),
]);
export type SeasonResolveFreeAgentMarketResult = z.infer<
  typeof seasonResolveFreeAgentMarketResultSchema
>;

// ---------------------------------------------------------------------------
// M2.6 postseason commands and typed rejections (spec/2.0/02 Playoffs).
// ---------------------------------------------------------------------------

/**
 * The command requires a run stage the run is not in (e.g. starting the
 * postseason before the regular season completes, or advancing the
 * postseason after completion).
 */
export const seasonInvalidStageRejectionSchema = z.object({
  code: z.literal('invalid-stage'),
  /** The stage the command requires. */
  requiredStage: seasonRunStageSchema,
  /** The run's current stage. */
  currentStage: seasonRunStageSchema,
});
export type SeasonInvalidStageRejection = z.infer<typeof seasonInvalidStageRejectionSchema>;

/**
 * The command named a postseason game that is not the run's current expected
 * game (wrong phase, wrong series, or wrong game number).
 */
export const seasonWrongGameRejectionSchema = z.object({
  code: z.literal('wrong-game'),
  targetGameId: postseasonGameIdSchema,
  /** The postseason game the run expects next. */
  nextGameId: postseasonGameIdSchema,
});
export type SeasonWrongGameRejection = z.infer<typeof seasonWrongGameRejectionSchema>;

/** The submitted postseason rotation is not legal against the roster. */
export const seasonInvalidRotationRejectionSchema = z.object({
  code: z.literal('invalid-rotation'),
  franchiseId: franchiseIdSchema,
  /** Legality reasons for the submitted rotation. */
  reasons: z.array(z.string().min(1).max(256)).min(1),
});
export type SeasonInvalidRotationRejection = z.infer<typeof seasonInvalidRotationRejectionSchema>;

/** The rotation (or a risky-rehab request) names a player who cannot play. */
export const seasonUnavailablePlayerRejectionSchema = z.object({
  code: z.literal('unavailable-player'),
  playerVersionId: playerVersionIdSchema,
  reason: z.enum(['injured', 'not-on-roster']),
});
export type SeasonUnavailablePlayerRejection = z.infer<
  typeof seasonUnavailablePlayerRejectionSchema
>;

/**
 * A risky-rehab spend was requested but the franchise lacks the required
 * Influence balance (postseason Influence spending supports risky rehab
 * only).
 */
export const seasonInsufficientRehabResourcesRejectionSchema = z.object({
  code: z.literal('insufficient-rehab-resources'),
  franchiseId: franchiseIdSchema,
  /** The franchise balance before the rejected spend. */
  balance: z.number().int(),
  /** Influence required for the requested rehab. */
  required: z.number().int(),
});
export type SeasonInsufficientRehabResourcesRejection = z.infer<
  typeof seasonInsufficientRehabResourcesRejectionSchema
>;

/** The named series cannot receive the requested advance (unpaired/complete/not current). */
export const seasonInvalidSeriesStateRejectionSchema = z.object({
  code: z.literal('invalid-series-state'),
  seriesId: z.string().min(1).max(64),
  reason: z.enum(['unpaired', 'complete', 'not-current']),
});
export type SeasonInvalidSeriesStateRejection = z.infer<
  typeof seasonInvalidSeriesStateRejectionSchema
>;

/**
 * The postseason state failed an integrity check (accounting or structural
 * inconsistency); the command is rejected without mutating the run.
 */
export const seasonIntegrityFailureRejectionSchema = z.object({
  code: z.literal('integrity-failure'),
  reason: z.string().min(1).max(256),
});
export type SeasonIntegrityFailureRejection = z.infer<typeof seasonIntegrityFailureRejectionSchema>;

/**
 * Start the postseason from the final regular-season standings (M2.6):
 * resolves qualification and seeding ties through the versioned tiebreak
 * sequence, records the deterministic resolutions, sets the Play-In
 * rankings, and moves the run to the `play-in` stage. Requires the
 * `regular-season` stage with all 82 rounds complete.
 */
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

/**
 * Advance the postseason until the next human lineup decision (M2.6). The
 * engine simulates the target game (or the next playable game when omitted)
 * and continues until a human rotation is required or the postseason ends.
 */
export const seasonAdvancePostseasonCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('advance-postseason'),
  /** The next postseason game to simulate; omitted advances the next playable game. */
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

/** The human postseason rotation payload (rotation + optional risky rehab). */
export const seasonPostseasonRotationPayloadSchema = z.object({
  franchiseId: franchiseIdSchema,
  /** The legal ten-player rotation (starters, closing five, target minutes). */
  rotation: seasonRotationSchema,
  /**
   * Optional risky-rehab spend for an injured player before the target game
   * (postseason Influence spending supports risky rehab only).
   */
  riskyRehabInjuryId: injuryIdSchema.optional(),
});
export type SeasonPostseasonRotationPayload = z.infer<typeof seasonPostseasonRotationPayloadSchema>;

/**
 * Submit the human postseason rotation for the target game (M2.6). Human
 * rotations may change between games; AI rotations are fixed.
 */
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

/**
 * Spectate the next postseason game after elimination (M2.6): simulates the
 * named game with no human decision required.
 */
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

/**
 * Fast-forward an eliminated run to its champion (M2.6): simulates every
 * remaining postseason game with fixed AI rotations and completes the run.
 */
export const seasonFastForwardPostseasonCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('fast-forward-postseason'),
  /** Optional terminal target; defaults to the champion-deciding game. */
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

/**
 * Select the block's objective BEFORE block submission. The objective is
 * locked into the block command and evaluated at assembly from saved facts
 * only. Must target the next unselected block and an id inside the block's
 * deterministic three-choice set.
 */
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

/**
 * Spend 1 Influence on `extra-trade-offer` (at most once per franchise per
 * open window) or 2 Influence on `risky-rehab` (at most once per active
 * injury). The floor -3 is enforced by validation, never by silent clamp;
 * the extra offer generated by the spend travels in the accepted result.
 */
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

/**
 * Accept an open trade offer. Application is atomic: unique ownership
 * transfer, legal ten-player rosters, deterministic rotation repair,
 * preserved health/load facts, zero-state chemistry for new pairs, and an
 * immutable `trade` transaction entry.
 */
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

/** Decline an open trade offer (no roster change, offer status -> declined). */
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

/**
 * Resume an interrupted block from its pending candidate. The rotation
 * digest must match the one locked at submission (the rotations never
 * change mid-block).
 */
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

/**
 * Forfeit the interrupted game (`nextGameId`) with an official 2-0 result
 * and no player statistics (`human-interruption-forfeit`), append the
 * forfeit summary to the pending candidate, and advance to the next game in
 * block order. Repeats while the human still lacks a legal five.
 */
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
    /** The recorded ledger entry (balanceAfter reconciles). */
    ledgerEntry: seasonInfluenceLedgerEntrySchema,
    /** Offer #4 for extra-trade-offer spends; null otherwise. */
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
    /** The game that was forfeited 2-0. */
    forfeitedGameId: seasonGameIdSchema,
    /** The next game in block order after the forfeit. */
    nextGameId: seasonGameIdSchema,
  }),
]);
export type SeasonForfeitInterruptedGameResult = z.infer<
  typeof seasonForfeitInterruptedGameResultSchema
>;

/** Shared accepted shape of postseason advancement results. */
export const seasonPostseasonAdvanceResultSchema = z.object({
  status: z.literal('accepted'),
  commandId: commandIdSchema,
  /** The run stage after the advance. */
  stage: seasonRunStageSchema,
  /** Games simulated by this advance, in play order. */
  advancedGameIds: z.array(postseasonGameIdSchema),
  /** Whether the run now needs a human rotation ('rotation') or not ('none'). */
  nextDecision: z.enum(['rotation', 'none']),
  /** The next game awaiting a human rotation, when one is needed. */
  nextGameId: postseasonGameIdSchema.nullable(),
  /** The next game to simulate with AI rotations, when the run continues. */
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
    /** The run stage after the start (always `play-in`). */
    stage: z.literal('play-in'),
    /** The derived postseason namespace seed. */
    postseasonSeed: z.string().regex(/^[0-9a-f]{16,64}$/),
    /** The first game awaiting resolution (a Play-In game). */
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
    /** Canonical digest of the locked rotation (engine season/rotation). */
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
    /** The run stage after the fast-forward (always `completed`). */
    stage: z.literal('completed'),
    championFranchiseId: franchiseIdSchema,
  }),
]);
export type SeasonFastForwardPostseasonResult = z.infer<
  typeof seasonFastForwardPostseasonResultSchema
>;

/** Every M2.5/M2.6/M2.6.5 typed run command (submit-season-block lives in season-block.ts). */
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
