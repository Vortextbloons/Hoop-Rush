import { z } from 'zod';
import { commandIdSchema, franchiseIdSchema, seasonGameIdSchema } from './ids.ts';
import {
  seasonDuplicateCommandRejectionSchema,
  seasonRunMismatchRejectionSchema,
  seasonSubmitBlockCommandSchema,
} from './season-block.ts';
import { seasonRunCommandBaseSchema } from './season-command-base.ts';
import { seasonCheckpointDigestSchema, seasonRotationSetDigestSchema } from './season-digests.ts';
import { injuryIdSchema } from './season-health.ts';
import { seasonInfluenceLedgerEntrySchema } from './season-influence.ts';
import { seasonObjectiveIdSchema } from './season-objective.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { seasonTradeOfferIdSchema, seasonTradeOfferSchema } from './season-trade.ts';

/**
 * M2.5 typed Season Run commands (spec/2.0 M2.5, schema 7). Every command
 * shares one base shape — schema version, commandId, runId, and the
 * expected run state revision/digest the command asserts — so a handler can
 * validate run identity, state freshness (recomputed by the engine), and
 * commandId uniqueness uniformly before evaluating deterministic
 * preconditions. Handlers are PURE engine functions; this file owns the
 * wire shapes and the typed rejections only.
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

/** Every M2.5 typed run command (submit-season-block lives in season-block.ts). */
export const seasonRunCommandSchema = z.discriminatedUnion('command', [
  seasonSelectBlockObjectiveCommandSchema,
  seasonSpendInfluenceCommandSchema,
  seasonAcceptTradeOfferCommandSchema,
  seasonDeclineTradeOfferCommandSchema,
  seasonResumeSeasonBlockCommandSchema,
  seasonForfeitInterruptedGameCommandSchema,
  seasonSubmitBlockCommandSchema,
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
]);
export type SeasonRunCommandRejection = z.infer<typeof seasonRunCommandRejectionSchema>;
