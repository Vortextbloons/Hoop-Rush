import { z } from 'zod';
import { commandIdSchema, franchiseIdSchema, idSchema } from './ids.ts';

/**
 * M2.5 transaction log contracts (spec/2.0 M2.5). Every economic fact that
 * moves value in a Season Run — trades, objective rewards, block grants,
 * Influence spends, and the initial grant — is recorded as one immutable,
 * append-only transaction entry. The log is run-scoped (not per-block), so
 * reload and replay reconstruct the full economic history exactly. Entries
 * are never mutated; corrections append new entries.
 *
 * M2.6.5 (spec/2.0/15): free-agency signings append immutable
 * `free-agent-signing` entries linked to their ledger entries.
 */

/** The six transaction kinds that can appear in the run-scoped log. */
export const seasonTransactionTypeSchema = z.enum([
  'trade',
  'objective-reward',
  'block-grant',
  'influence-spend',
  'initial-grant',
  'free-agent-signing',
]);
export type SeasonTransactionType = z.infer<typeof seasonTransactionTypeSchema>;

/**
 * One immutable transaction entry. `commandId` is the typed command that
 * produced it (system-generated entries such as block grants use a
 * deterministic synthetic command id; the initial grant carries null).
 * `franchiseId` is null for league-wide entries (e.g. block grants apply to
 * all franchises). `payload` is canonicalizable JSON carrying the recorded
 * facts (ownership moves, ledger references, explanations), and
 * `explanation` is the bounded human-readable summary (max 512).
 */
export const seasonTransactionEntrySchema = z.object({
  transactionId: idSchema,
  /** Null for system-generated entries without a command. */
  commandId: commandIdSchema.nullable(),
  /** Null for league-wide entries. */
  franchiseId: franchiseIdSchema.nullable(),
  type: seasonTransactionTypeSchema,
  /** Null for the run-creation initial grant. */
  blockIndex: z.number().int().min(0).max(8).nullable(),
  /** The run stateRevision this entry applied at. */
  appliedAtStateRevision: z.number().int().nonnegative(),
  /** Canonicalizable JSON (ownership moves, ledger refs, explanation). */
  payload: z.record(z.string(), z.unknown()),
  /** Human-readable summary, max 512 characters. */
  explanation: z.string().min(1).max(512),
});
export type SeasonTransactionEntry = z.infer<typeof seasonTransactionEntrySchema>;

/**
 * Versioned array-level wrapper for the transaction log (LEAD DECISION:
 * the run stores the raw `SeasonTransactionEntry[]`; this wrapper gives the
 * array its own versioned boundary wherever a self-contained artifact is
 * needed).
 */
export const seasonTransactionLogSchema = z.object({
  schemaVersion: z.literal(1),
  transactions: z.array(seasonTransactionEntrySchema),
});
export type SeasonTransactionLog = z.infer<typeof seasonTransactionLogSchema>;
