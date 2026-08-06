import {
  seasonTransactionEntrySchema,
  type SeasonTransactionEntry,
  type SeasonTransactionType,
} from '@hoop-rush/data-contracts';

/**
 * M2.5 immutable transaction-log entries (engine side). Every economic fact
 * that moves value (trades, objective rewards, block grants, Influence
 * spends, the initial grant) records one entry; the log is append-only and
 * run-scoped. This builder is the single construction path so every entry
 * passes the contract shape before it enters the log.
 */

export interface SeasonTransactionEntryInput {
  transactionId: string;
  commandId: string | null;
  franchiseId: string | null;
  type: SeasonTransactionType;
  blockIndex: number | null;
  appliedAtStateRevision: number;
  payload: Record<string, unknown>;
  explanation: string;
}

/** Builds one validated transaction entry (throws on malformed input). */
export function seasonTransactionEntry(input: SeasonTransactionEntryInput): SeasonTransactionEntry {
  return seasonTransactionEntrySchema.parse(input);
}
