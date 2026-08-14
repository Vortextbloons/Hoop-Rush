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
export type SeasonTradeOfferChemistryDisruption = z.infer<
  typeof seasonTradeOfferChemistryDisruptionSchema
>;

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

export const seasonTradeWindowStatusSchema = z.enum(['open', 'closed']);
export type SeasonTradeWindowStatus = z.infer<typeof seasonTradeWindowStatusSchema>;

export const seasonTradeWindowStateSchema = z.object({
  windowIndex: z.number().int().min(0).max(2),

  blockIndex: z.number().int().min(2).max(5),
  status: seasonTradeWindowStatusSchema,

  offers: z.array(seasonTradeOfferSchema),
});
export type SeasonTradeWindowState = z.infer<typeof seasonTradeWindowStateSchema>;

export const seasonTradeStateSchema = z.object({
  schemaVersion: z.literal(1),
  tradeVersion: z.literal(SEASON_TRADE_VERSION),
  windows: z.array(seasonTradeWindowStateSchema).max(3),
});
export type SeasonTradeState = z.infer<typeof seasonTradeStateSchema>;
