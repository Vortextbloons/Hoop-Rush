import { describe, expect, it } from 'vitest';
import { deriveSeasonTransactionId, seasonTransactionEntrySchema, type SeasonTransactionEntryInput, } from '@hoop-rush/data-contracts';
import { normalizeSeasonTransactions } from './normalize-mutable-state.ts';
describe('normalizeSeasonTransactions', () => {
    it('shortens overlong transaction ids before checkpoint validation', () => {
        const commandId = `c${'a'.repeat(63)}`;
        const overlong: SeasonTransactionEntryInput = {
            transactionId: `txn-trade-cash-sent-${commandId}`,
            commandId,
            franchiseId: 'lakers',
            type: 'trade-cash-sent',
            blockIndex: null,
            appliedAtStateRevision: 1,
            payload: { amount: 1, toFranchiseId: 'celtics' },
            explanation: 'Trade cash sent 1',
        };
        expect(() => seasonTransactionEntrySchema.parse(overlong)).toThrow();
        const normalizedEntries = normalizeSeasonTransactions([overlong]);
        const normalized = normalizedEntries[0];
        if (normalized === undefined)
            throw new Error('expected a normalized transaction');
        expect(normalized.transactionId.length).toBeLessThanOrEqual(64);
        expect(seasonTransactionEntrySchema.parse(normalized).transactionId).toBe(deriveSeasonTransactionId(overlong.transactionId));
    });
});
