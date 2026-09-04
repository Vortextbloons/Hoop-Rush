import { SEASON_INFLUENCE_CAP, SEASON_INFLUENCE_FLOOR, commandIdSchema, franchiseIdSchema, idSchema, type SeasonInfluenceLedgerEntry, type SeasonInfluenceState, type SeasonTransactionEntry, } from '@hoop-rush/data-contracts';
import { deriveSeasonInfluenceEntryId, seasonTransactionEntry } from './transactions.ts';
export function createInitialSeasonInfluenceState(franchiseIds: readonly string[]): SeasonInfluenceState {
    const balances: Record<string, number> = {};
    const ledger: SeasonInfluenceLedgerEntry[] = [];
    const windows: Record<string, {
        windowIndex: number;
        extraOfferSpent: boolean;
    }[]> = {};
    for (const franchiseId of franchiseIds) {
        const fid = franchiseIdSchema.parse(franchiseId);
        balances[fid] = 2;
        ledger.push({
            entryId: idSchema.parse(`influence-initial-${franchiseId}`),
            franchiseId: fid,
            source: 'initial-grant',
            blockIndex: null,
            commandId: null,
            requestedDelta: 2,
            appliedDelta: 2,
            balanceAfter: 2,
            explanation: 'Initial +2 Influence grant at run creation',
        });
        windows[fid] = [];
    }
    return {
        schemaVersion: 1,
        influenceVersion: 'season-influence-v2',
        balances,
        ledger,
        windows,
        rehabs: {},
    };
}
export interface SeasonBlockInfluenceGrantInput {
    influence: SeasonInfluenceState;
    blockIndex: number;
    humanFranchiseId: string | null;
    participantFranchiseIds?: readonly string[] | null;
    objectiveSuccess: boolean | null;
    objectiveSuccessByFranchise?: Readonly<Record<string, boolean | null>> | null;
    appliedAtStateRevision?: number;
}
export interface SeasonBlockInfluenceGrantOutput {
    influence: SeasonInfluenceState;
    entries: SeasonTransactionEntry[];
}
export function applySeasonBlockInfluenceGrants(input: SeasonBlockInfluenceGrantInput): SeasonBlockInfluenceGrantOutput {
    const { influence, blockIndex, humanFranchiseId, objectiveSuccess } = input;
    const appliedAtStateRevision = input.appliedAtStateRevision ?? blockIndex + 1;
    const balances: Record<string, number> = { ...influence.balances };
    const ledger: SeasonInfluenceLedgerEntry[] = [...influence.ledger];
    const capReachedFranchiseIds: string[] = [];
    for (const franchiseId of Object.keys(balances)) {
        const fid = franchiseIdSchema.parse(franchiseId);
        const requestedDelta = 1;
        const appliedDelta = (balances[franchiseId] ?? 0) < SEASON_INFLUENCE_CAP ? 1 : 0;
        if (appliedDelta === 0)
            capReachedFranchiseIds.push(franchiseId);
        balances[franchiseId] = (balances[franchiseId] ?? 0) + appliedDelta;
        ledger.push({
            entryId: idSchema.parse(`influence-block-${String(blockIndex)}-${franchiseId}`),
            franchiseId: fid,
            source: 'block-grant',
            blockIndex,
            commandId: null,
            requestedDelta,
            appliedDelta,
            balanceAfter: balances[franchiseId] ?? 0,
            explanation: appliedDelta === 1
                ? `+1 Influence block grant (block ${String(blockIndex)})`
                : `Block grant at the +8 cap (block ${String(blockIndex)})`,
        });
    }
    const entries: SeasonTransactionEntry[] = [
        seasonTransactionEntry({
            transactionId: idSchema.parse(`txn-block-grant-${String(blockIndex)}`),
            commandId: commandIdSchema.parse(`sys-block-grant-${String(blockIndex)}`),
            franchiseId: null,
            type: 'block-grant',
            blockIndex,
            appliedAtStateRevision,
            payload: {
                blockIndex,
                franchiseCount: Object.keys(balances).length,
                appliedDelta: 1,
                capReachedCount: capReachedFranchiseIds.length,
                capReachedFranchiseIds,
            },
            explanation: `+1 Influence block grant for all 30 franchises (block ${String(blockIndex)})`,
        }),
    ];
    const participantIds = input.participantFranchiseIds ?? (humanFranchiseId ? [humanFranchiseId] : []);
    const successMap = input.objectiveSuccessByFranchise ??
        (humanFranchiseId && objectiveSuccess !== null ? { [humanFranchiseId]: objectiveSuccess } : {});
    for (const pid of participantIds) {
        const fid = franchiseIdSchema.parse(pid);
        const success = successMap[pid] ?? (pid === humanFranchiseId ? objectiveSuccess : null);
        if (success === true) {
            const requestedDelta = 1;
            const appliedDelta = (balances[pid] ?? 0) < SEASON_INFLUENCE_CAP ? 1 : 0;
            balances[pid] = (balances[pid] ?? 0) + appliedDelta;
            ledger.push({
                entryId: idSchema.parse(`influence-objective-${String(blockIndex)}-${pid}`),
                franchiseId: fid,
                source: 'objective-reward',
                blockIndex,
                commandId: null,
                requestedDelta,
                appliedDelta,
                balanceAfter: balances[pid] ?? 0,
                explanation: appliedDelta === 1
                    ? `+1 Influence objective reward (block ${String(blockIndex)})`
                    : `Objective reward at the +8 cap (block ${String(blockIndex)})`,
            });
            entries.push(seasonTransactionEntry({
                transactionId: idSchema.parse(`txn-objective-reward-${String(blockIndex)}-${pid}`),
                commandId: commandIdSchema.parse(`sys-objective-reward-${String(blockIndex)}-${pid}`),
                franchiseId: fid,
                type: 'objective-reward',
                blockIndex,
                appliedAtStateRevision,
                payload: { blockIndex, appliedDelta, objectiveSuccess: true },
                explanation: `+1 Influence objective reward for ${pid} (block ${String(blockIndex)})`,
            }));
        }
    }
    return {
        influence: { ...influence, balances, ledger },
        entries,
    };
}
export interface SeasonInfluenceSpendInput {
    influence: SeasonInfluenceState;
    franchiseId: string;
    source: import('@hoop-rush/data-contracts').SeasonInfluenceSource;
    requestedDelta: number;
    blockIndex: number | null;
    commandId: string | null;
    explanation: string;
    windowIndex?: number;
    injuryId?: string;
    rehabOutcome?: 'success' | 'failure' | 'pending';
}
export class SeasonInfluenceFloorError extends Error {
    readonly code = 'insufficient-balance' as const;
    readonly franchiseId: string;
    readonly balance: number;
    readonly requestedDelta: number;
    readonly floor: number = SEASON_INFLUENCE_FLOOR;
    constructor(input: {
        franchiseId: string;
        balance: number;
        requestedDelta: number;
    }) {
        super(`influence spend for ${input.franchiseId} would cross the -3 floor ` +
            `(balance ${String(input.balance)}, requested ${String(input.requestedDelta)})`);
        this.name = 'SeasonInfluenceFloorError';
        this.franchiseId = input.franchiseId;
        this.balance = input.balance;
        this.requestedDelta = input.requestedDelta;
    }
}
export function applySeasonInfluenceSpend(input: SeasonInfluenceSpendInput): {
    influence: SeasonInfluenceState;
    entry: SeasonInfluenceLedgerEntry;
} {
    const { influence, franchiseId, source, requestedDelta, blockIndex, commandId, explanation } = input;
    const fid = franchiseIdSchema.parse(franchiseId);
    const cid = commandId === null ? null : commandIdSchema.parse(commandId);
    const balanceBefore = influence.balances[fid] ?? 0;
    if (balanceBefore + requestedDelta < SEASON_INFLUENCE_FLOOR) {
        throw new SeasonInfluenceFloorError({ franchiseId, balance: balanceBefore, requestedDelta });
    }
    const balanceAfter = balanceBefore + requestedDelta;
    const entry: SeasonInfluenceLedgerEntry = {
        entryId: idSchema.parse(deriveSeasonInfluenceEntryId(`influence-spend-${commandId ?? 'system'}`)),
        franchiseId: fid,
        source,
        blockIndex,
        commandId: cid,
        requestedDelta,
        appliedDelta: requestedDelta,
        balanceAfter,
        explanation,
    };
    const balances: Record<string, number> = { ...influence.balances, [fid]: balanceAfter };
    const ledger: SeasonInfluenceLedgerEntry[] = [...influence.ledger, entry];
    let windows = influence.windows;
    let rehabs = influence.rehabs;
    if (input.windowIndex !== undefined && source === 'extra-trade-offer') {
        windows = {
            ...windows,
            [fid]: [...(windows[fid] ?? []), { windowIndex: input.windowIndex, extraOfferSpent: true }],
        };
    }
    if (input.injuryId !== undefined && source === 'risky-rehab') {
        rehabs = {
            ...rehabs,
            [input.injuryId]: {
                franchiseId: fid,
                outcome: input.rehabOutcome ?? 'pending',
                commandId: commandIdSchema.parse(commandId ?? 'system'),
            },
        };
    }
    return { influence: { ...influence, balances, ledger, windows, rehabs }, entry };
}
export { SEASON_INFLUENCE_CAP, SEASON_INFLUENCE_FLOOR };
