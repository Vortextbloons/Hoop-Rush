import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { injuryIdSchema } from './season-health.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_TRADE_VERSION } from './season-versions.ts';

/**
 * M2.5 trade contracts (spec/2.0 M2.5, season-trade-v1; spec/2.0/15 M2.6.5,
 * season-trade-v2). Trade windows open after accepted checkpoints for
 * blocks 2, 4, 5 (windowIndex 0, 1, 2 respectively). At window open the
 * engine deterministically generates three base human offers plus AI-to-AI
 * activity; spending 1 Influence on `extra-trade-offer` during an open
 * window generates a fourth human offer. Offers are evaluated with
 * contextual player value (role fit, availability, workload, contribution)
 * — Overall is never an authority — and value bands influence AI
 * willingness but never force acceptance. Applying a trade is atomic:
 * unique ownership transfer, legal 10-15 rosters with a legal ten-player
 * rotation subset, deterministic rotation repair, preserved health/load
 * facts, zero-state chemistry for the new pairs, and an immutable
 * transaction entry.
 *
 * season-trade-v2 (M2.6.5): 1-for-1, 2-for-2, 1-for-2, and 2-for-1 offers
 * are legal when both resulting rosters stay within 10-15. Value bands:
 * 85-115% for 1-for-1 and 80-120% for every multi-player or uneven
 * package. Moving only inactive players leaves rotations and active effects
 * unchanged; moving rotation players rebuilds affected rotations
 * deterministically while preserving retained assignments/minutes where
 * possible. Open free-agent targets are revalidated after every
 * ownership-changing transaction.
 */

/** Deterministic offer id (`off-` + 32-hex from the named seed path). */
export const seasonTradeOfferIdSchema = z.string().regex(/^off-[0-9a-f]{32}$/);
export type SeasonTradeOfferId = z.infer<typeof seasonTradeOfferIdSchema>;

/** Lifecycle of one generated offer. */
export const seasonTradeOfferStatusSchema = z.enum(['open', 'accepted', 'declined', 'expired']);
export type SeasonTradeOfferStatus = z.infer<typeof seasonTradeOfferStatusSchema>;

/** Per-player health facts recorded on the offer (health follows the player). */
export const seasonTradePlayerHealthSchema = z.object({
  available: z.boolean(),
  activeInjuryIds: z.array(injuryIdSchema),
});
export type SeasonTradePlayerHealth = z.infer<typeof seasonTradePlayerHealthSchema>;

/**
 * Value band (season-trade-v2): 1-for-1 trades require incoming between 85%
 * and 115% of outgoing; 2-for-2, 1-for-2, and 2-for-1 packages require
 * between 80% and 120% (ratio in basis points). The band enum names the
 * frozen bounds the ratio was measured against.
 */
export const seasonTradeOfferValueBandSchema = z.object({
  ratioBasisPoints: z.number().int().min(800).max(1200),
  band: z.enum(['85-115', '80-120']),
  qualified: z.boolean(),
});
export type SeasonTradeOfferValueBand = z.infer<typeof seasonTradeOfferValueBandSchema>;

/** Role-fit facts from the contextual role evaluation. */
export const seasonTradeOfferRoleFitSchema = z.object({
  outgoingRoles: z.array(z.string().min(1).max(64)),
  incomingRoles: z.array(z.string().min(1).max(64)),
  notes: z.string().max(512),
});
export type SeasonTradeOfferRoleFit = z.infer<typeof seasonTradeOfferRoleFitSchema>;

/** Depth facts showing why the trade serves the receiving roster. */
export const seasonTradeOfferRosterNeedFactsSchema = z.object({
  outgoingDepth: z.number().int().nonnegative(),
  incomingDepth: z.number().int().nonnegative(),
  notes: z.string().max(512),
});
export type SeasonTradeOfferRosterNeedFacts = z.infer<typeof seasonTradeOfferRosterNeedFactsSchema>;

/** Chemistry consequence: removed old-roster pairs and new zero-state pairs. */
export const seasonTradeOfferChemistryDisruptionSchema = z.object({
  removedPairs: z.number().int().nonnegative(),
  newPairs: z.number().int().nonnegative(),
});
export type SeasonTradeOfferChemistryDisruption = z.infer<
  typeof seasonTradeOfferChemistryDisruptionSchema
>;

/**
 * One generated offer. `toFranchiseId` is the human franchise; both sides
 * move one or two players, and — since season-trade-v2 — packages may be
 * uneven (1-for-2 and 2-for-1 are legal when both resulting rosters stay
 * within 10-15 and retain legal ten-player rotation subsets). Health arrays
 * carry one entry per moved player in the same order as the version arrays.
 */
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
    /** Max 512 characters. */
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

/**
 * Persisted trade-window state (M2.5, season-trade-v1). Windows open after
 * accepted checkpoints for blocks 2, 4, 5 (windowIndex 0, 1, 2); a window
 * closes when the following block's rotations are locked (block submission).
 * Offers survive reload in this state so accept/decline commands can be
 * issued across sessions. The run snapshot carries `trade` (null until the
 * first window opens).
 */
export const seasonTradeWindowStatusSchema = z.enum(['open', 'closed']);
export type SeasonTradeWindowStatus = z.infer<typeof seasonTradeWindowStatusSchema>;

/** One persisted window with its generated offers and resolution status. */
export const seasonTradeWindowStateSchema = z.object({
  windowIndex: z.number().int().min(0).max(2),
  /** The accepted checkpoint (block index 2, 4, or 5) that opened it. */
  blockIndex: z.number().int().min(2).max(5),
  status: seasonTradeWindowStatusSchema,
  /** All offers generated in this window (base, extra, AI activity), in generation order. */
  offers: z.array(seasonTradeOfferSchema),
});
export type SeasonTradeWindowState = z.infer<typeof seasonTradeWindowStateSchema>;

/** Run-scoped trade state: every window so far, oldest first. */
export const seasonTradeStateSchema = z.object({
  schemaVersion: z.literal(1),
  tradeVersion: z.literal(SEASON_TRADE_VERSION),
  windows: z.array(seasonTradeWindowStateSchema).max(3),
});
export type SeasonTradeState = z.infer<typeof seasonTradeStateSchema>;
