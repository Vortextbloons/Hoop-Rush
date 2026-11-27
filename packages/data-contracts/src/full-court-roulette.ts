import { z } from 'zod';
import { commandIdSchema, idSchema, playerIdSchema } from './ids.ts';
import { positionSchema } from './positions.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import {
  CAP_RUSH_SPIN_PURCHASES,
  capRushDigestSchema,
  capRushPayrollStatusSchema,
  capRushSpinPurchaseSchema,
} from './cap-rush-versions.ts';
import { capRushSourcePlayerSchema } from './cap-rush-draft.ts';
import { simulationPlayerSchema } from './simulation.ts';
import { havocEffectiveProfileSchema } from './havoc-profile.ts';
import {
  havocMutationEntrySchema,
  havocMutationPackageSchema,
  havocTierSchema,
} from './havoc-mutations.ts';

export const FULL_COURT_ROULETTE_SCHEMA_VERSION = 1;

export const fullCourtSpinTargetSchema = z.object({
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema,
  slot: positionSchema,
});
export type FullCourtSpinTarget = z.infer<typeof fullCourtSpinTargetSchema>;

/**
 * One Full Court Roulette draw and its War Chest debit.
 *
 * `payrollDollars` follows Cap Rush's spin receipt accounting: it is the locked payroll
 * plus every earlier spin, so `payrollDollars + priceDollars` is the cap-line figure.
 * The apron itself keeps reading the locked payroll alone.
 */
export const fullCourtSpinReceiptSchema = z
  .object({
    purchase: capRushSpinPurchaseSchema,
    priceDollars: z.number().int().nonnegative(),
    payrollDollars: z.number().int().nonnegative(),
    tier: havocTierSchema,
    target: fullCourtSpinTargetSchema,
    entry: havocMutationEntrySchema,
    additionalEntries: z.array(havocMutationEntrySchema).max(2).optional(),
    effective: havocEffectiveProfileSchema,
    commandId: commandIdSchema,
    receiptDigest: capRushDigestSchema,
  })
  .superRefine((receipt, ctx) => {
    const count = 1 + (receipt.additionalEntries?.length ?? 0);
    const expectedCount =
      receipt.purchase === 'standard' ? 1 : receipt.tier === 1 ? 3 : receipt.tier === 2 ? 2 : 1;
    if (count !== expectedCount || (receipt.purchase === 'standard' && receipt.tier === 3)) {
      ctx.addIssue({
        code: 'custom',
        message: 'mutation outcome does not match the purchased spin',
      });
    }
    const price = CAP_RUSH_SPIN_PURCHASES[receipt.purchase].priceDollars;
    if (receipt.priceDollars !== price) {
      ctx.addIssue({
        code: 'custom',
        message: `${receipt.purchase} spin costs $${String(price)}, not $${String(receipt.priceDollars)}`,
      });
    }
  });
export type FullCourtSpinReceipt = z.infer<typeof fullCourtSpinReceiptSchema>;

/**
 * The persisted, already-resolved Roulette attachment for one team. It mirrors the
 * engine's `FullCourtRouletteTeamInput` so worker envelopes can validate it without
 * importing engine types.
 */
export const fullCourtRoulettePlayerAttachmentSchema = z.object({
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema,
  slot: positionSchema,
  mutationPackage: havocMutationPackageSchema,
  sourcePlayer: z.union([simulationPlayerSchema, capRushSourcePlayerSchema]).optional(),
  effectiveProfile: havocEffectiveProfileSchema.optional(),
  participantKey: z.string().min(1).max(96).optional(),
});
export type FullCourtRoulettePlayerAttachment = z.infer<
  typeof fullCourtRoulettePlayerAttachmentSchema
>;

export const fullCourtRouletteTeamSchema = z.object({
  payrollStatus: capRushPayrollStatusSchema.optional(),
  attachments: z.array(fullCourtRoulettePlayerAttachmentSchema).max(12),
});
export type FullCourtRouletteTeam = z.infer<typeof fullCourtRouletteTeamSchema>;

export const fullCourtPurchaseSpinCommandSchema = z.object({
  command: z.literal('purchase-full-court-spin'),
  commandId: commandIdSchema,
  runId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  purchase: capRushSpinPurchaseSchema,
  targetPlayerVersionId: playerVersionIdSchema,
});
export type FullCourtPurchaseSpinCommand = z.infer<typeof fullCourtPurchaseSpinCommandSchema>;

export const fullCourtSkipSpinCommandSchema = z.object({
  command: z.literal('skip-full-court-spin'),
  commandId: commandIdSchema,
  runId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
});
export type FullCourtSkipSpinCommand = z.infer<typeof fullCourtSkipSpinCommandSchema>;

export const fullCourtFinalizeRouletteCommandSchema = z.object({
  command: z.literal('finalize-full-court-roulette'),
  commandId: commandIdSchema,
  runId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
});
export type FullCourtFinalizeRouletteCommand = z.infer<
  typeof fullCourtFinalizeRouletteCommandSchema
>;
