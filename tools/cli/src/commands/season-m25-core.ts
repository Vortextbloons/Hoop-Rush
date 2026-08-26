import { SEASON_BLOCK_COUNT, SEASON_HEALTH_VERSION, SEASON_OBJECTIVE_CATALOG, SEASON_OBJECTIVE_VERSION, buildInitialPostseasonState, seasonHealthStateSchema, seasonObjectiveStateSchema, type SeasonCandidateCheckpoint, type SeasonCheckpointState, type SeasonDraftCatalog, type SeasonEffectsState, type SeasonGameSummary, type SeasonHealthState, type SeasonInfluenceState, type SeasonObjectiveState, type SeasonRun, type SeasonTradeState, } from '@hoop-rush/data-contracts';
import { createInitialSeasonInfluenceState, expandSeasonRunRosters, openSeasonTradeWindow, rosterPlayerIdsOf, seasonObjectiveChoicesForBlock, seasonRunStateDigest, type SeasonWindowOpenResult, } from '@hoop-rush/engine';
import { createSeasonBlockRunner, runBlockThroughHandler, type SeasonBlockRunnerState, } from './season-block.ts';
export function m25EmptyHealthState(): SeasonHealthState {
    return seasonHealthStateSchema.parse({
        schemaVersion: 1,
        healthVersion: SEASON_HEALTH_VERSION,
        injuries: [],
    });
}
export function m25InitialObjectivesState(): SeasonObjectiveState {
    return seasonObjectiveStateSchema.parse({
        schemaVersion: 1,
        objectiveVersion: SEASON_OBJECTIVE_VERSION,
        catalog: [...SEASON_OBJECTIVE_CATALOG],
        selections: {},
    });
}
export function m25InitialInfluenceState(franchiseIds: readonly string[]): SeasonInfluenceState {
    return createInitialSeasonInfluenceState(franchiseIds);
}
export interface SeasonM25RunStateFacts {
    stateRevision: number;
    stage: SeasonRun['stage'];
    postseason: SeasonRun['postseason'];
    awards: SeasonRun['awards'];
    completion: SeasonRun['completion'];
    checkpointState: SeasonCheckpointState | null;
    health: SeasonHealthState;
    influence: SeasonInfluenceState;
    transactions: SeasonRun['transactions'];
    trade: SeasonTradeState | null;
    freeAgency: SeasonRun['freeAgency'];
    objectives: SeasonObjectiveState;
    rosters: SeasonRun['rosters'];
    ownership: SeasonRun['ownership'];
    rotations: SeasonRun['rotations'];
    effects: SeasonEffectsState;
}
export function m25RunStateFacts(run: SeasonRun, effects: SeasonEffectsState): SeasonM25RunStateFacts {
    return {
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
        rosters: run.rosters,
        ownership: run.ownership,
        rotations: run.rotations,
        effects,
    };
}
export function m25FreshRun(base: SeasonRun, rootSeed: string, franchiseIds: readonly string[], effects: SeasonEffectsState): SeasonRun {
    const fresh: SeasonRun = {
        ...base,
        rootSeed,
        stage: 'regular-season',
        postseason: buildInitialPostseasonState(rootSeed),
        awards: null,
        completion: null,
        health: m25EmptyHealthState(),
        transactions: [],
        influence: m25InitialInfluenceState(franchiseIds),
        trade: null,
        objectives: m25InitialObjectivesState(),
        checkpointState: null,
        stateRevision: 0,
        stateDigest: '0'.repeat(32),
    };
    return { ...fresh, stateDigest: seasonRunStateDigest(m25RunStateFacts(fresh, effects)) };
}
export interface SeasonM25WindowOpen {
    blockIndex: number;
    result: SeasonWindowOpenResult | null;
}
export interface SeasonM25SeasonFacts {
    rootSeed: string;
    run: SeasonRun;
    checkpoints: SeasonCandidateCheckpoint[];
    postBlock: Array<{
        stateRevision: number;
        stateDigest: string;
    }>;
    windows: SeasonM25WindowOpen[];
    balanceSnapshots: Array<Record<string, number>>;
    effects: SeasonEffectsState;
    catalog: SeasonDraftCatalog;
    summaries: SeasonGameSummary[];
}
export interface SeasonM25DriverOptions {
    runPath?: string | null;
    manifestPath?: string | null;
    profileEra?: string | null;
    rootSeed: string;
    driveWindows: boolean;
    pickObjectives: boolean;
    probeWindow?: boolean;
}
export const M25_TRADE_WINDOW_BLOCKS = [2, 4, 5] as const;
export function runSeasonM25(options: SeasonM25DriverOptions): SeasonM25SeasonFacts {
    const state: SeasonBlockRunnerState = createSeasonBlockRunner({
        runPath: options.runPath,
        manifestPath: options.manifestPath,
        profileEra: options.profileEra,
    });
    const franchiseIds = state.run.league.teams.map((team) => team.franchiseId);
    const run = m25FreshRun(state.run, options.rootSeed, franchiseIds, state.effects);
    state.run = run;
    state.health = run.health;
    state.objectiveId = null;
    state.checkpointState = null;
    state.stateRevision = 0;
    state.stateDigest = run.stateDigest;
    state.summaries = [];
    state.acceptedCommandIds = [];
    const checkpoints: SeasonCandidateCheckpoint[] = [];
    const postBlock: Array<{
        stateRevision: number;
        stateDigest: string;
    }> = [];
    const windows: SeasonM25WindowOpen[] = [];
    const balanceSnapshots: Array<Record<string, number>> = [];
    let probed = false;
    for (let blockIndex = 0; blockIndex < SEASON_BLOCK_COUNT; blockIndex += 1) {
        if (options.pickObjectives && blockIndex <= 7) {
            const choices = seasonObjectiveChoicesForBlock(options.rootSeed, blockIndex);
            const first = choices[0];
            if (first === undefined) {
                throw new Error(`seed ${options.rootSeed} offered no objective for block ${String(blockIndex)}`);
            }
            state.objectiveId = first;
        }
        else {
            state.objectiveId = null;
        }
        const checkpoint = runBlockThroughHandler(state, blockIndex);
        checkpoints.push(checkpoint);
        postBlock.push({ stateRevision: state.stateRevision, stateDigest: state.stateDigest });
        balanceSnapshots.push({ ...checkpoint.influence.balances });
        if (state.objectiveId !== null && checkpoint.objective.objectiveId !== null) {
            state.run = {
                ...state.run,
                objectives: {
                    ...state.run.objectives,
                    selections: {
                        ...state.run.objectives.selections,
                        [blockIndex]: {
                            objectiveId: state.objectiveId,
                            selectedByCommandId: `season-block-${String(blockIndex)}-${String(state.acceptedCommandIds.length)}`,
                            success: checkpoint.objective.success,
                        },
                    },
                },
            };
        }
        if (options.driveWindows &&
            (M25_TRADE_WINDOW_BLOCKS as readonly number[]).includes(blockIndex)) {
            const windowInput = {
                run: state.run,
                blockIndex,
                rootSeed: options.rootSeed,
                humanFranchiseId: state.humanFranchiseId,
                catalog: state.catalog,
                effects: state.effects,
            };
            const result = openSeasonTradeWindow(windowInput);
            windows.push({ blockIndex, result });
            if (result !== null) {
                if (options.probeWindow && !probed) {
                    const again = openSeasonTradeWindow(windowInput);
                    if (JSON.stringify(again?.trade) !== JSON.stringify(result.trade)) {
                        throw new Error(`seed ${options.rootSeed} window ${String(blockIndex)} offer generation is not deterministic`);
                    }
                    probed = true;
                }
                state.run = {
                    ...state.run,
                    trade: result.trade,
                    influence: result.influence,
                    transactions: result.transactions,
                    rosters: result.rosters,
                    ownership: result.ownership,
                    rotations: result.rotations,
                    stateRevision: result.stateRevision,
                    stateDigest: result.stateDigest,
                };
                state.stateRevision = result.stateRevision;
                state.stateDigest = result.stateDigest;
                state.effects = result.effects;
                state.expanded = expandSeasonRunRosters(state.run, state.catalog);
                state.rosterPlayerIds = rosterPlayerIdsOf(state.run);
            }
        }
    }
    return {
        rootSeed: options.rootSeed,
        run: state.run,
        checkpoints,
        postBlock,
        windows,
        balanceSnapshots,
        effects: state.effects,
        catalog: state.catalog,
        summaries: state.summaries,
    };
}
