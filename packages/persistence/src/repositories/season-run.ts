import type { SeasonAcceptedBlock, SeasonActiveRunIndex, SeasonBlockRecap, SeasonCampaignState, SeasonCandidateCheckpoint, SeasonCheckpointState, SeasonCommandActor, SeasonEffectsState, SeasonFreeAgencyState, SeasonGameSummary, SeasonHealthState, SeasonInfluenceState, SeasonInvalidRosterInterruption, SeasonObjectiveState, SeasonPendingBlockCandidate, SeasonRetainedGameDetail, SeasonRotation, SeasonRun, SeasonRunCommand, SeasonStandings, SeasonTeamAggregate, SeasonPlayerAggregate, SeasonTradeState, SeasonTransactionEntry, } from '@hoop-rush/data-contracts';
import { SEASON_RUN_SAVE_SCHEMA_VERSION } from '@hoop-rush/data-contracts';
import type { StoredSeasonDraft } from '../schemas/season-draft-record.ts';
import type { SeasonWindowOpenResult } from '../season/engine-seam-types.ts';
import type { SeasonRunPlayerSliceEntry } from '../schemas/season-run-record.ts';
export interface CommitSeasonBlockInput {
    runId: string;
    revision: number;
    commandId: string;
    rotationDigest: string;
    checkpointDigest: string;
    completedRounds: number;
    standings: SeasonStandings;
    teamAggregates: SeasonTeamAggregate[];
    playerAggregates: SeasonPlayerAggregate[];
    summaries: SeasonGameSummary[];
    retainedDetails: SeasonRetainedGameDetail[];
    recap: SeasonBlockRecap;
    rotations: SeasonRotation[];
    effects: SeasonEffectsState;
    freeAgency: SeasonFreeAgencyState;
    health: SeasonHealthState;
    transactions: SeasonTransactionEntry[];
    influence: SeasonInfluenceState;
    trade: SeasonTradeState | null;
    objectives: SeasonObjectiveState;
    campaign?: SeasonCampaignState | null;
    checkpointState: SeasonCheckpointState;
    stateRevision: number;
    stateDigest: string;
    expectedStateRevision: number;
    expectedStateDigest: string;
    window: SeasonWindowOpenResult | null;
}
export interface SeasonRunSnapshot {
    run: SeasonRun;
    summaries: SeasonGameSummary[];
    retainedDetails: SeasonRetainedGameDetail[];
    acceptedBlocks: SeasonAcceptedBlock[];
    effects: SeasonEffectsState;
}
export interface SeasonRunIncompatibleInfo {
    storedSaveSchemaVersion: number;
    storedRunSchemaVersion: number;
    runId: string;
}
export interface SeasonRunCommandApplication {
    runId: string;
    command: SeasonRunCommand;
    run: SeasonRun;
    effects?: SeasonEffectsState;
    pending: SeasonPendingBlockCandidate | null;
    resultDigest?: string;
    relatedGameIds?: string[];
    transactionIds?: string[];
    actor?: SeasonCommandActor;
}
export class SeasonRunCommandStaleStateError extends Error {
    readonly commandId: string;
    readonly expectedStateRevision: number;
    readonly storedStateRevision: number;
    constructor(commandId: string, expectedStateRevision: number, storedStateRevision: number) {
        super(`season run command ${commandId} asserts stale state (expected revision ` +
            `${String(expectedStateRevision)}, stored ${String(storedStateRevision)})`);
        this.name = 'SeasonRunCommandStaleStateError';
        this.commandId = commandId;
        this.expectedStateRevision = expectedStateRevision;
        this.storedStateRevision = storedStateRevision;
    }
}
export class SeasonRunCommandDuplicateError extends Error {
    readonly commandId: string;
    constructor(commandId: string) {
        super(`season run command ${commandId} was already applied`);
        this.name = 'SeasonRunCommandDuplicateError';
        this.commandId = commandId;
    }
}
export class SeasonRunCommandRunMismatchError extends Error {
    readonly runId: string;
    constructor(runId: string) {
        super(`season run command targets run ${runId}, not the active run`);
        this.name = 'SeasonRunCommandRunMismatchError';
        this.runId = runId;
    }
}
export class SeasonPendingBlockRejectedError extends Error {
    readonly reason: string;
    constructor(reason: string) {
        super(`pending block rejected: ${reason}`);
        this.name = 'SeasonPendingBlockRejectedError';
        this.reason = reason;
    }
}
export interface SeasonRunRepository {
    loadActiveRunIndex(): Promise<SeasonActiveRunIndex | null>;
    loadActiveRun(): Promise<SeasonRunSnapshot | null>;
    loadBlockSummaries(runId: string, blockIndex: number): Promise<SeasonGameSummary[]>;
    loadRetainedDetails(runId: string): Promise<SeasonRetainedGameDetail[]>;
    loadBlockHistory(runId: string): Promise<SeasonAcceptedBlock[]>;
    commitSeasonBlock(input: CommitSeasonBlockInput): Promise<void>;
    promoteSeasonDraftToRun(draft: StoredSeasonDraft, run: SeasonRun, playerSlice?: SeasonRunPlayerSliceEntry[]): Promise<void>;
    clearSeasonRun(runId: string): Promise<void>;
    forceClearActiveSeasonRun(): Promise<void>;
    savePendingBlock(pending: SeasonPendingBlockCandidate, interruption: SeasonInvalidRosterInterruption): Promise<void>;
    loadPendingBlock(runId: string): Promise<SeasonPendingBlockCandidate | null>;
    discardPendingBlock(runId: string): Promise<void>;
    applySeasonRunCommand(input: SeasonRunCommandApplication): Promise<void>;
    loadSeasonRunPlayerSlice(runId: string): Promise<SeasonRunPlayerSliceEntry[] | null>;
    upsertSeasonRunPlayerSlice(runId: string, entries: SeasonRunPlayerSliceEntry[]): Promise<void>;
}
export type { SeasonCandidateCheckpoint, SeasonWindowOpenResult, SeasonRunPlayerSliceEntry };
