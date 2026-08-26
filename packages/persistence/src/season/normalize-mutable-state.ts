import { deriveSeasonInfluenceEntryId, deriveSeasonTransactionId, normalizeSeasonTransactionEntry, type SeasonEffectsState, type SeasonFreeAgencyState, type SeasonInfluenceState, type SeasonRun, type SeasonTransactionEntry, } from '@hoop-rush/data-contracts';
import { seasonRunEngineSeam } from './engine-seam.ts';
export function normalizeSeasonTransactions(transactions: readonly SeasonTransactionEntry[]): SeasonTransactionEntry[] {
    return transactions.map(normalizeSeasonTransactionEntry);
}
export function normalizeSeasonInfluenceState(state: SeasonInfluenceState): SeasonInfluenceState {
    return {
        ...state,
        ledger: state.ledger.map((entry) => ({
            ...entry,
            entryId: deriveSeasonInfluenceEntryId(entry.entryId),
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
                transactionId: deriveSeasonTransactionId(signing.transactionId),
                ledgerEntryId: deriveSeasonInfluenceEntryId(signing.ledgerEntryId),
            })),
        })),
    };
}
export function normalizeSeasonRunMutableSnapshot(run: SeasonRun): SeasonRun {
    return {
        ...run,
        transactions: normalizeSeasonTransactions(run.transactions),
        influence: normalizeSeasonInfluenceState(run.influence),
        freeAgency: normalizeSeasonFreeAgencyState(run.freeAgency),
    };
}
export function normalizeSeasonRunForPersistence(run: SeasonRun, effects: SeasonEffectsState): SeasonRun {
    const normalized = normalizeSeasonRunMutableSnapshot(run);
    return {
        ...normalized,
        stateDigest: seasonRunEngineSeam.seasonRunStateDigest({
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
        }),
    };
}
