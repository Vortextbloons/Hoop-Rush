import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { injuryIdSchema } from './season-health.ts';
import { SEASON_INFLUENCE_VERSION } from './season-versions.ts';

/**
 * M2.5 Influence economy contracts (spec/2.0 M2.5, season-influence-v1).
 * Every franchise receives a +2 initial grant at run creation, +1 per
 * accepted regular-season block, and rewards for completed objectives.
 * Balance has a +8 cap (a grant at cap applies 0 and is recorded) and a -3
 * floor (a spend that would go below -3 is REJECTED by typed validation,
 * never silently clamped). The ledger records every requested/applied delta
 * with its source, block, command, and balance after, so balances always
 * reconcile: `balanceAfter === balanceBefore + appliedDelta`.
 *
 * Balance and debt NEVER modify possession odds or any gameplay mechanic.
 * No hook exists; tests assert the absence of such hooks.
 */

/** How a ledger entry entered the economy. */
export const seasonInfluenceSourceSchema = z.enum([
  'initial-grant',
  'block-grant',
  'objective-reward',
  'extra-trade-offer',
  'risky-rehab',
]);
export type SeasonInfluenceSource = z.infer<typeof seasonInfluenceSourceSchema>;

/** The command id pattern ledger entries record (system-generated or human). */
const influenceCommandId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/);

/**
 * One immutable ledger entry. `requestedDelta` is what the rule asked for
 * (e.g. +1 block grant, -1 extra-trade-offer spend); `appliedDelta` is what
 * actually applied (0 at the +8 cap); `balanceAfter` is the franchise
 * balance after the entry applied. `blockIndex` and `commandId` are null for
 * the run-creation initial grant.
 */
export const seasonInfluenceLedgerEntrySchema = z.object({
  entryId: influenceCommandId,
  franchiseId: franchiseIdSchema,
  source: seasonInfluenceSourceSchema,
  /** Null for the run-creation initial grant. */
  blockIndex: z.number().int().min(0).max(8).nullable(),
  /** Null for the run-creation initial grant; else the producing command. */
  commandId: influenceCommandId.nullable(),
  requestedDelta: z.number().int(),
  appliedDelta: z.number().int(),
  balanceAfter: z.number().int(),
  /** Human-readable summary, max 512 characters. */
  explanation: z.string().min(1).max(512),
});
export type SeasonInfluenceLedgerEntry = z.infer<typeof seasonInfluenceLedgerEntrySchema>;

/**
 * Per-franchise trade-window spend tracking: `extra-trade-offer` costs 1 and
 * may be spent at most once per franchise per open trade window. Windows
 * open after accepted checkpoints for blocks 2, 4, 5 (windowIndex 0, 1, 2).
 */
export const seasonInfluenceWindowStateSchema = z.object({
  windowIndex: z.number().int().min(0).max(2),
  extraOfferSpent: z.boolean(),
});
export type SeasonInfluenceWindowState = z.infer<typeof seasonInfluenceWindowStateSchema>;

/** Outcome of a `risky-rehab` spend (cost 2, at most once per active injury). */
export const seasonInfluenceRehabOutcomeSchema = z.enum(['success', 'failure', 'pending']);
export type SeasonInfluenceRehabOutcome = z.infer<typeof seasonInfluenceRehabOutcomeSchema>;

/**
 * Per-injury risky-rehab spend state. The seeded outcome is rolled by the
 * health engine (`rehab` event) and recorded here AND in the injury record;
 * no unrecorded modifier is ever applied. `pending` until the health engine
 * resolves the roll.
 */
export const seasonInfluenceRehabStateSchema = z.object({
  franchiseId: franchiseIdSchema,
  outcome: seasonInfluenceRehabOutcomeSchema,
  commandId: influenceCommandId,
});
export type SeasonInfluenceRehabState = z.infer<typeof seasonInfluenceRehabStateSchema>;

/** Frozen economy bounds (cap is applied, floor is validated). */
export const SEASON_INFLUENCE_CAP = 8;
export const SEASON_INFLUENCE_FLOOR = -3;

/**
 * The run-scoped Influence state (schema 1, season-influence-v1):
 * `balances` covers ALL 30 franchises (enforced at parse time); `ledger` is
 * the append-only reconciliation source; `windows` tracks extra-trade-offer
 * spends per franchise; `rehabs` tracks risky-rehab spend state per active
 * injury.
 */
export const seasonInfluenceStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    influenceVersion: z.literal(SEASON_INFLUENCE_VERSION),
    /** All 30 franchise balances; values stay within cap/floor. */
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
