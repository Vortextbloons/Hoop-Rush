import { deriveSeasonInfluenceEntryId, deriveSeasonTransactionId, idSchema, seasonTransactionEntry, type SeasonEffectsState, type SeasonFreeAgencyState, type SeasonInfluenceState, type SeasonRun, type SeasonTransactionEntry, type SeasonTransactionEntryInput, } from '@hoop-rush/data-contracts';
import { seasonRunEngineSeam } from './engine-seam.ts';
import type { SeasonRunStateDigestFacts } from './engine-seam-types.ts';
export function normalizeSeasonTransactions(transactions: readonly SeasonTransactionEntryInput[]): SeasonTransactionEntry[] {
    return transactions.map((entry) => seasonTransactionEntry(entry));
}
export function normalizeSeasonInfluenceState(state: SeasonInfluenceState): SeasonInfluenceState {
    return {
        ...state,
        ledger: state.ledger.map((entry) => ({
            ...entry,
            entryId: idSchema.parse(deriveSeasonInfluenceEntryId(entry.entryId)),
        })),
    };
}
export function normalizeSeasonFreeAgencyState(state: SeasonFreeAgencyState): SeasonFreeAgencyState {
    return {
        ...state,
        windows: state.windows.map((window) => ({
            ...window,
            signings: window.signings.map((signing) => ({
                ...signing,
                transactionId: idSchema.parse(deriveSeasonTransactionId(signing.transactionId)),
                ledgerEntryId: idSchema.parse(deriveSeasonInfluenceEntryId(signing.ledgerEntryId)),
            })),
        })),
    };
}
type MutableSnapshotInput = Omit<SeasonRun, 'transactions'> & {
    transactions: readonly SeasonTransactionEntryInput[];
};
export function normalizeSeasonRunForPersistence(run: MutableSnapshotInput, effects: SeasonEffectsState): SeasonRun {
    const normalized: SeasonRun = {
        ...run,
        transactions: normalizeSeasonTransactions(run.transactions),
        influence: normalizeSeasonInfluenceState(run.influence),
        freeAgency: normalizeSeasonFreeAgencyState(run.freeAgency),
    };
    const facts: SeasonRunStateDigestFacts = {
        stateRevision: normalized.stateRevision,
        stage: normalized.stage,
        postseason: normalized.postseason,
        awards: normalized.awards,
        completion: normalized.completion,
        checkpointState: normalized.checkpointState,
        health: normalized.health,
        influence: normalized.influence,
        transactions: normalized.transactions,
        trade: normalized.trade,
        freeAgency: normalized.freeAgency,
        objectives: normalized.objectives,
        campaign: normalized.campaign ?? null,
        rosters: normalized.rosters,
        ownership: normalized.ownership,
        rotations: normalized.rotations,
        effects,
        authority: normalized.authority,
    };
    return {
        ...normalized,
        stateDigest: seasonRunEngineSeam.seasonRunStateDigest(facts),
    };
}
