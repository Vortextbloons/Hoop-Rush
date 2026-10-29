import { z } from 'zod';
import { positionSchema } from './positions.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { capRushCardIdSchema } from './cap-rush-versions.ts';
import {
  CAP_RUSH_CAP_LINE_DOLLARS,
  CAP_RUSH_DRAFT_ROUNDS,
  CAP_RUSH_SPIN_PURCHASES,
  capRushDigestSchema,
  capRushSpinPurchaseSchema,
} from './cap-rush-versions.ts';
import { havocEffectiveProfileSchema } from './havoc-profile.ts';
import { havocMutationEntrySchema, havocTierSchema } from './havoc-mutations.ts';

export const capRushSpinTargetSchema = z.object({
  pickOrdinal: z
    .number()
    .int()
    .min(0)
    .max(CAP_RUSH_DRAFT_ROUNDS - 1),
  cardId: capRushCardIdSchema,
  slot: positionSchema,
  playerVersionId: playerVersionIdSchema,
});
export type CapRushSpinTarget = z.infer<typeof capRushSpinTargetSchema>;

export const capRushSpinReceiptSchema = z
  .object({
    purchase: capRushSpinPurchaseSchema,
    priceDollars: z.number().int().nonnegative(),
    payrollDollars: z.number().int().nonnegative(),
    tier: havocTierSchema,
    target: capRushSpinTargetSchema,
    entry: havocMutationEntrySchema,
    effective: havocEffectiveProfileSchema,
    receiptDigest: capRushDigestSchema,
  })
  .superRefine((receipt, ctx) => {
    const price = CAP_RUSH_SPIN_PURCHASES[receipt.purchase].priceDollars;
    if (receipt.priceDollars !== price) {
      ctx.addIssue({
        code: 'custom',
        message: `${receipt.purchase} spin costs $${String(price)}, not $${String(receipt.priceDollars)}`,
      });
    }
    if (receipt.payrollDollars + price > CAP_RUSH_CAP_LINE_DOLLARS) {
      ctx.addIssue({
        code: 'custom',
        message: 'a purchased spin must fit under the normal cap',
      });
    }
  });
export type CapRushSpinReceipt = z.infer<typeof capRushSpinReceiptSchema>;

export const capRushSpinStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unavailable') }),
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('skipped') }),
  z.object({
    status: z.literal('purchased'),
    receipt: capRushSpinReceiptSchema,
    additionalReceipts: z.array(capRushSpinReceiptSchema).max(4).optional(),
  }),
]);
export type CapRushSpinState = z.infer<typeof capRushSpinStateSchema>;
