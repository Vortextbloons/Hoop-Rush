import { describe, expect, it } from 'vitest';
import { deriveSeasonTransactionId, seasonTransactionEntrySchema, type SeasonTransactionEntry, } from '@hoop-rush/data-contracts';
import { normalizeSeasonRunForPersistence, normalizeSeasonTransactions, } from './normalize-mutable-state.ts';
import { seasonRunEngineSeam } from './engine-seam.ts';
import { buildFixtureEffectsState, buildFixtureRun } from '../testing/season-run-fixture.ts';
describe('normalizeSeasonTransactions', () => {
    it('shortens overlong transaction ids before checkpoint validation', () => {
        const commandId = `c${'a'.repeat(63)}`;
        const overlong: SeasonTransactionEntry = {
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
        const normalized = normalizeSeasonTransactions([overlong])[0]!;
        expect(normalized.transactionId.length).toBeLessThanOrEqual(64);
        expect(seasonTransactionEntrySchema.parse(normalized).transactionId).toBe(deriveSeasonTransactionId(overlong.transactionId));
    });
});
describe('normalizeSeasonRunForPersistence', () => {
    it('repairs legacy transaction logs and recomputes stateDigest', () => {
        const baseRun = buildFixtureRun({ seed: 'abc1234567890abcd' });
        const effects = buildFixtureEffectsState(baseRun.rosters);
        const commandId = `c${'b'.repeat(63)}`;
        const overlongId = `txn-trade-inquiry-purchase-${commandId}`;
        const run = normalizeSeasonRunForPersistence({
            ...baseRun,
            transactions: [
                ...baseRun.transactions,
                {
                    transactionId: overlongId,
                    commandId,
                    franchiseId: 'lakers',
                    type: 'trade-inquiry-purchase',
                    blockIndex: null,
                    appliedAtStateRevision: baseRun.stateRevision,
                    payload: { windowIndex: 0 },
                    explanation: 'Purchased trade inquiry for window 0',
                },
            ],
        }, effects);
        expect(run.stateDigest).toBe(seasonRunEngineSeam.seasonRunStateDigest({
            stateRevision: run.stateRevision,
            stage: run.stage,
            postseason: run.postseason,
            awards: run.awards,
            completion: run.completion,
            checkpointState: run.checkpointState,
            health: run.health,
            influence: run.influence,
            transactions: run.transactions,
            trade: run.trade,
            freeAgency: run.freeAgency,
            objectives: run.objectives,
            campaign: run.campaign ?? null,
            rosters: run.rosters,
            ownership: run.ownership,
            rotations: run.rotations,
            effects,
        }));
    });
});
