import { z } from 'zod';
import { commandIdSchema, franchiseIdSchema, idSchema } from './ids.ts';
import { injuryIdSchema } from './season-health.ts';
import {
  SEASON_INFLUENCE_VERSION,
  SEASON_INFLUENCE_VERSION_V1,
  SEASON_INFLUENCE_VERSION_V2,
} from './season-versions.ts';
export const seasonInfluenceSourceSchema = z.enum([
  'initial-grant',
  'block-grant',
  'objective-reward',
  'challenge-reward',
  'campaign-reward',
  'extra-trade-offer',
  'trade-inquiry-purchase',
  'trade-cash-sent',
  'trade-cash-received',
  'risky-rehab',
  'free-agent-signing',
]);
export type SeasonInfluenceSource = z.infer<typeof seasonInfluenceSourceSchema>;
export const seasonInfluenceLedgerEntrySchema = z.object({
  entryId: idSchema,
  franchiseId: franchiseIdSchema,
  source: seasonInfluenceSourceSchema,
  blockIndex: z.number().int().min(0).max(8).nullable(),
  commandId: commandIdSchema.nullable(),
  requestedDelta: z.number().int(),
  appliedDelta: z.number().int(),
  balanceAfter: z.number().int(),
  explanation: z.string().min(1).max(512),
});
export type SeasonInfluenceLedgerEntry = z.infer<typeof seasonInfluenceLedgerEntrySchema>;
export const seasonInfluenceWindowStateSchema = z.object({
  windowIndex: z.number().int().min(0).max(2),
  extraOfferSpent: z.boolean().optional(),
  purchasedInquiryUsed: z.boolean().optional(),
  earnedInquiryUsed: z.boolean().optional(),
  tradeCashSent: z.number().int().min(0).max(2).optional(),
  tradeCashReceived: z.number().int().min(0).max(2).optional(),
});
export type SeasonInfluenceWindowState = z.infer<typeof seasonInfluenceWindowStateSchema>;
export const seasonInfluenceRehabOutcomeSchema = z.enum(['success', 'failure', 'pending']);
export type SeasonInfluenceRehabOutcome = z.infer<typeof seasonInfluenceRehabOutcomeSchema>;
export const seasonInfluenceRehabStateSchema = z.object({
  franchiseId: franchiseIdSchema,
  outcome: seasonInfluenceRehabOutcomeSchema,
  commandId: commandIdSchema,
});
export type SeasonInfluenceRehabState = z.infer<typeof seasonInfluenceRehabStateSchema>;
export const SEASON_INFLUENCE_CAP = 8;
export const SEASON_INFLUENCE_FLOOR = 0;
export const seasonInfluenceStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    influenceVersion: z.union([
      z.literal(SEASON_INFLUENCE_VERSION),
      z.literal(SEASON_INFLUENCE_VERSION_V2),
      z.literal(SEASON_INFLUENCE_VERSION_V1),
    ]),
    balances: z.record(
      franchiseIdSchema,
      z.number().int().min(SEASON_INFLUENCE_FLOOR).max(SEASON_INFLUENCE_CAP),
    ),
    ledger: z.array(seasonInfluenceLedgerEntrySchema),
    windows: z.record(franchiseIdSchema, z.array(seasonInfluenceWindowStateSchema)),
    rehabs: z.record(injuryIdSchema, seasonInfluenceRehabStateSchema),
  })
  .superRefine((state, ctx) => {
    if (Object.keys(state.balances).length !== 30) {
      ctx.addIssue({
        code: 'custom',
        message: `influence balances must cover all 30 franchises (found ${String(Object.keys(state.balances).length)})`,
      });
    }
  });
export type SeasonInfluenceState = z.infer<typeof seasonInfluenceStateSchema>;
