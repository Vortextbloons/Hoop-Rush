import { describe, expect, it } from 'vitest';
import { deriveSeasonInfluenceEntryId, deriveSeasonTransactionId, seasonTransactionEntry, } from './transactions.ts';
describe('deriveSeasonTransactionId', () => {
    it('keeps short logical ids unchanged', () => {
        expect(deriveSeasonTransactionId('txn-block-grant-0')).toBe('txn-block-grant-0');
    });
    it('hashes ids that exceed the 64 character contract limit', () => {
        const commandId = `c${'a'.repeat(63)}`;
        const logical = `txn-trade-inquiry-purchase-${commandId}`;
        const derived = deriveSeasonTransactionId(logical);
        expect(logical.length).toBeGreaterThan(64);
        expect(derived.length).toBeLessThanOrEqual(64);
        expect(derived).toMatch(/^txn-[0-9a-f]{32}$/);
        expect(deriveSeasonTransactionId(logical)).toBe(derived);
    });
    it('validates through seasonTransactionEntry', () => {
        const commandId = `c${'a'.repeat(63)}`;
        const entry = seasonTransactionEntry({
            transactionId: `txn-${commandId}`,
            commandId,
            franchiseId: 'lakers',
            type: 'influence-spend',
            blockIndex: null,
            appliedAtStateRevision: 1,
            payload: { purpose: 'extra-trade-offer', windowIndex: 0 },
            explanation: 'Spent 1 Influence on an extra trade offer',
        });
        expect(entry.transactionId.length).toBeLessThanOrEqual(64);
    });
});
describe('deriveSeasonInfluenceEntryId', () => {
    it('hashes long campaign ledger ids deterministically', () => {
        const rewardId = 'rew-12345678';
        const logical = `influence-campaign-0-timberwolves-${rewardId}-extra-tail-${'x'.repeat(20)}`;
        const derived = deriveSeasonInfluenceEntryId(logical);
        expect(logical.length).toBeGreaterThan(64);
        expect(derived.length).toBeLessThanOrEqual(64);
        expect(derived).toMatch(/^inf-[0-9a-f]{32}$/);
        expect(deriveSeasonInfluenceEntryId(logical)).toBe(derived);
    });
});
