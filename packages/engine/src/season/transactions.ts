import {
  seasonTransactionEntrySchema,
  type SeasonTransactionEntry,
  type SeasonTransactionType,
} from '@hoop-rush/data-contracts';

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

export function seasonTransactionEntry(input: SeasonTransactionEntryInput): SeasonTransactionEntry {
  return seasonTransactionEntrySchema.parse(input);
}
