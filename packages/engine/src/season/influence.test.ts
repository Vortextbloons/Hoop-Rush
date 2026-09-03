import { describe, expect, it } from 'vitest';
import { SEASON_INFLUENCE_CAP, SEASON_INFLUENCE_FLOOR, seasonBlockRunContextSchema, type SeasonInfluenceState, type SeasonRun, } from '@hoop-rush/data-contracts';
import { applySeasonBlockInfluenceGrants, applySeasonInfluenceSpend, SeasonInfluenceFloorError, } from './influence.ts';
import { buildEconomyTestRun, injuryIdOf } from './season-economy-test-support.ts';
function fixture(): {
    run: SeasonRun;
    franchiseIds: string[];
    humanFranchiseId: string;
} {
    const { run } = buildEconomyTestRun();
    return {
        run,
        franchiseIds: Object.keys(run.influence.balances),
        humanFranchiseId: 'lakers',
    };
}
function ledgerBalancesOf(influence: SeasonInfluenceState): Map<string, number> {
    const balances = new Map<string, number>();
    for (const entry of influence.ledger) {
        const before = balances.get(entry.franchiseId) ?? 0;
        balances.set(entry.franchiseId, before + entry.appliedDelta);
    }
    return balances;
}
describe('season influence creation', () => {
    it('grants +2 to every franchise with one initial ledger entry each', () => {
        const { run } = fixture();
        const state = run.influence;
        expect(Object.keys(state.balances)).toHaveLength(30);
        for (const franchiseId of Object.keys(state.balances)) {
            expect(state.balances[franchiseId]).toBe(2);
            const entries = state.ledger.filter((entry) => entry.franchiseId === franchiseId);
            expect(entries).toHaveLength(1);
            expect(entries[0]?.source).toBe('initial-grant');
            expect(entries[0]?.blockIndex).toBeNull();
            expect(entries[0]?.commandId).toBeNull();
            expect(entries[0]?.balanceAfter).toBe(2);
        }
        expect(Object.keys(state.windows)).toHaveLength(30);
        expect(Object.keys(state.rehabs)).toHaveLength(0);
    });
});
describe('season influence block grants', () => {
    it('applies +1 to all 30 franchises and records ledger + transaction entries', () => {
        const { run, humanFranchiseId } = fixture();
        const blockIndex = 2;
        const outcome = applySeasonBlockInfluenceGrants({
            influence: run.influence,
            blockIndex,
            humanFranchiseId,
            objectiveSuccess: true,
        });
        for (const franchiseId of Object.keys(outcome.influence.balances)) {
            expect(outcome.influence.balances[franchiseId]).toBe(franchiseId === humanFranchiseId ? 4 : 3);
        }
        const grantEntries = outcome.influence.ledger.filter((entry) => entry.source === 'block-grant');
        expect(grantEntries).toHaveLength(30);
        for (const entry of grantEntries) {
            expect(entry.requestedDelta).toBe(1);
            expect(entry.appliedDelta).toBe(1);
            expect(entry.balanceAfter).toBe(3);
            expect(entry.blockIndex).toBe(blockIndex);
            expect(entry.commandId).toBeNull();
        }
        const rewardEntries = outcome.influence.ledger.filter((entry) => entry.source === 'objective-reward');
        expect(rewardEntries).toHaveLength(1);
        expect(rewardEntries[0]?.franchiseId).toBe(humanFranchiseId);
        expect(rewardEntries[0]?.balanceAfter).toBe(4);
        expect(outcome.entries).toHaveLength(2);
        expect(outcome.entries[0]?.type).toBe('block-grant');
        expect(outcome.entries[0]?.franchiseId).toBeNull();
        expect(outcome.entries[1]?.type).toBe('objective-reward');
        expect(outcome.entries[1]?.franchiseId).toBe(humanFranchiseId);
        expect(outcome.entries[0]?.blockIndex).toBe(blockIndex);
    });
    it('reconciles every balance from the ledger (balanceAfter === before + applied)', () => {
        const { run, humanFranchiseId } = fixture();
        const first = applySeasonBlockInfluenceGrants({
            influence: run.influence,
            blockIndex: 0,
            humanFranchiseId,
            objectiveSuccess: false,
        }).influence;
        const second = applySeasonBlockInfluenceGrants({
            influence: first,
            blockIndex: 1,
            humanFranchiseId,
            objectiveSuccess: true,
        }).influence;
        const fromLedger = ledgerBalancesOf(second);
        for (const franchiseId of Object.keys(second.balances)) {
            expect(second.balances[franchiseId]).toBe(fromLedger.get(franchiseId));
            expect(second.balances[franchiseId]).toBe(2 + (franchiseId === humanFranchiseId ? 3 : 2));
        }
    });
    it('cap-applies a grant at +8: appliedDelta 0 with the cap-reached explanation', () => {
        const { run, humanFranchiseId } = fixture();
        let influence = run.influence;
        for (let blockIndex = 0; blockIndex < 6; blockIndex += 1) {
            influence = applySeasonBlockInfluenceGrants({
                influence,
                blockIndex,
                humanFranchiseId,
                objectiveSuccess: false,
            }).influence;
        }
        expect(influence.balances[humanFranchiseId]).toBe(SEASON_INFLUENCE_CAP);
        const atCap = applySeasonBlockInfluenceGrants({
            influence,
            blockIndex: 4,
            humanFranchiseId,
            objectiveSuccess: false,
        });
        expect(atCap.influence.balances[humanFranchiseId]).toBe(SEASON_INFLUENCE_CAP);
        const capped = atCap.influence.ledger.filter((entry) => entry.franchiseId === humanFranchiseId && entry.source === 'block-grant');
        const last = capped[capped.length - 1];
        expect(last?.requestedDelta).toBe(1);
        expect(last?.appliedDelta).toBe(0);
        expect(last?.explanation).toContain('cap');
        const rewardAtCap = applySeasonBlockInfluenceGrants({
            influence: atCap.influence,
            blockIndex: 5,
            humanFranchiseId,
            objectiveSuccess: true,
        });
        const reward = rewardAtCap.influence.ledger.filter((entry) => entry.source === 'objective-reward');
        expect(reward[reward.length - 1]?.appliedDelta).toBe(0);
        expect(reward[reward.length - 1]?.explanation).toContain('cap');
    });
    it('defaults appliedAtStateRevision to blockIndex + 1 and honors an explicit revision', () => {
        const { run, humanFranchiseId } = fixture();
        const defaulted = applySeasonBlockInfluenceGrants({
            influence: run.influence,
            blockIndex: 2,
            humanFranchiseId,
            objectiveSuccess: false,
        });
        expect(defaulted.entries[0]?.appliedAtStateRevision).toBe(3);
        const explicit = applySeasonBlockInfluenceGrants({
            influence: run.influence,
            blockIndex: 2,
            humanFranchiseId,
            objectiveSuccess: false,
            appliedAtStateRevision: 17,
        });
        expect(explicit.entries[0]?.appliedAtStateRevision).toBe(17);
    });
});
describe('season influence spends', () => {
    it('applies an extra-trade-offer spend, tracks the window, and reconciles', () => {
        const { run, humanFranchiseId } = fixture();
        const result = applySeasonInfluenceSpend({
            influence: run.influence,
            franchiseId: humanFranchiseId,
            source: 'extra-trade-offer',
            requestedDelta: -1,
            blockIndex: 2,
            commandId: 'cmd-spend-1',
            explanation: 'extra offer',
            windowIndex: 0,
        });
        expect(result.entry.requestedDelta).toBe(-1);
        expect(result.entry.appliedDelta).toBe(-1);
        expect(result.entry.balanceAfter).toBe(1);
        expect(result.entry.commandId).toBe('cmd-spend-1');
        expect(result.influence.balances[humanFranchiseId]).toBe(1);
        expect(result.influence.windows[humanFranchiseId]).toEqual([
            { windowIndex: 0, extraOfferSpent: true },
        ]);
        expect(ledgerBalancesOf(result.influence).get(humanFranchiseId)).toBe(1);
    });
    it('tracks risky-rehab spends per injury with the recorded outcome', () => {
        const { run, humanFranchiseId } = fixture();
        const injuryId = injuryIdOf('rehab-seed');
        const result = applySeasonInfluenceSpend({
            influence: run.influence,
            franchiseId: humanFranchiseId,
            source: 'risky-rehab',
            requestedDelta: -2,
            blockIndex: null,
            commandId: 'cmd-rehab-1',
            explanation: 'risky rehab',
            injuryId,
            rehabOutcome: 'failure',
        });
        expect(result.influence.balances[humanFranchiseId]).toBe(0);
        expect(result.influence.rehabs[injuryId]).toEqual({
            franchiseId: humanFranchiseId,
            outcome: 'failure',
            commandId: 'cmd-rehab-1',
        });
    });
    it('rejects a spend that would cross the -3 floor with a typed error', () => {
        const { run, humanFranchiseId } = fixture();
        let influence = run.influence;
        influence = applySeasonInfluenceSpend({
            influence,
            franchiseId: humanFranchiseId,
            source: 'extra-trade-offer',
            requestedDelta: -1,
            blockIndex: 2,
            commandId: 'cmd-a',
            explanation: 'a',
            windowIndex: 0,
        }).influence;
        influence = applySeasonInfluenceSpend({
            influence,
            franchiseId: humanFranchiseId,
            source: 'extra-trade-offer',
            requestedDelta: -1,
            blockIndex: 2,
            commandId: 'cmd-b',
            explanation: 'b',
            windowIndex: 0,
        }).influence;
        expect(influence.balances[humanFranchiseId]).toBe(SEASON_INFLUENCE_FLOOR);
        expect(() => applySeasonInfluenceSpend({
            influence,
            franchiseId: humanFranchiseId,
            source: 'extra-trade-offer',
            requestedDelta: -1,
            blockIndex: 2,
            commandId: 'cmd-c',
            explanation: 'c',
            windowIndex: 0,
        })).toThrow(SeasonInfluenceFloorError);
        expect(influence.balances[humanFranchiseId]).toBe(SEASON_INFLUENCE_FLOOR);
    });
    it('spends never exceed the floor and never clamp silently', () => {
        const { run, humanFranchiseId } = fixture();
        const balance = run.influence.balances[humanFranchiseId] ?? 0;
        expect(SEASON_INFLUENCE_FLOOR).toBe(0);
        expect(balance + -6).toBeLessThan(SEASON_INFLUENCE_FLOOR);
        expect(() => applySeasonInfluenceSpend({
            influence: run.influence,
            franchiseId: humanFranchiseId,
            source: 'risky-rehab',
            requestedDelta: -6,
            blockIndex: null,
            commandId: 'cmd-g',
            explanation: 'g',
            injuryId: injuryIdOf('x'),
            rehabOutcome: 'pending',
        })).toThrow(SeasonInfluenceFloorError);
    });
});
describe('season influence has no gameplay hooks', () => {
    it('the block simulation wire cannot carry influence state', () => {
        const { run } = fixture();
        const context = {
            schemaVersion: run.schemaVersion,
            runId: run.runId,
            rootSeed: run.rootSeed,
            versions: run.versions,
            league: run.league,
            rosters: run.rosters,
            rotations: run.rotations,
            cursor: run.cursor,
            influence: run.influence,
        };
        const parsed = seasonBlockRunContextSchema.parse(context);
        expect('influence' in parsed).toBe(false);
    });
    it('the influence module exports only economy functions (no gameplay surface)', async () => {
        const exported = Object.keys(await import('./influence.ts')).sort();
        for (const name of exported) {
            expect(name.toLowerCase()).not.toMatch(/possession|simulate|game|shoot|rebound|turnover/);
        }
    });
});
