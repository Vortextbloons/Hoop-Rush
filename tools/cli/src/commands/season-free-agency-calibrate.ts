import { resolve } from 'node:path';
import { z } from 'zod';
import { SEASON_BLOCK_COUNT, SEASON_FREE_AGENCY_TARGETS_VERSION, SEASON_GAME_TARGETS_VERSION, SEASON_GAME_VERSION, SEASON_RUN_SCHEMA_VERSION, commandIdSchema, franchiseIdSchema, type FranchiseId, type Position, type SeasonCandidateCheckpoint, type SeasonEffectsState, type SeasonFreeAgencyBand, type SeasonFreeAgencyIndex, type SeasonFreeAgencyState, type SeasonFreeAgencyWindowState, type SeasonGameSummary, type SeasonResolveFreeAgentMarketCommand, type SeasonRun, type SeasonRosterTargets, type SeasonSkipFreeAgentMarketCommand, type SeasonSubmitBlockCommand, type Seed, } from '@hoop-rush/data-contracts';
import { SEASON_FREE_AGENCY_WINDOW_BLOCK_INDEXES, SEASON_FREE_AGENCY_WINDOW_MAX_CANDIDATES, assembleSeasonBlockCandidate, createEngineContext, deriveSeasonPostBlockState, freeAgencyUnresolvedWindowIndex, handleSeasonRunCommand, legalFiveAfterAnyRemoval, legalFiveExists, openSeasonFreeAgencyWindow, openSeasonTradeWindow, rosterGroupCounts, rosterPlayerIdsOf, seasonBlockGamesOf, seasonNextBlockIndex, seasonRotationSetDigest, seasonRunStateDigest, simulateSeasonBlockGame, validateSeasonRotation, type SeasonBlockGameOutcome, type SeasonBlockSimulationInput, type SeasonRosterMemberInput, } from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import { seasonFreeAgencyCalibrateReportSchema } from '../report-schemas.ts';
import { parseSeedRange, parseWorkers } from '../args.ts';
import { DEFAULT_MANIFEST, DEFAULT_SEASON_DIR, loadSeasonFreeAgencyIndex, loadSeasonRosterTargets, } from './season-data.ts';
import { gateValue, gateSummary, m25RangeGate, m25ToleranceGate, mean, seasonCalibrationSeed, seedIndexRange, share, type M25Gate, } from './season-calibration.ts';
import { auditSeasonFreeAgencyFacts, type SeasonFreeAgencyAuditCounts, } from './season-free-agency-audit.ts';
import { commitTargetsArtifact, validateTargetsArtifact } from '../artifact.ts';
import { createSeasonBlockRunner, runnerBlockCommand, runnerPipelineInput, type SeasonBlockRunnerState, } from './season-block.ts';
import { m25FreshRun, m25RunStateFacts, M25_TRADE_WINDOW_BLOCKS } from './season-m25-core.ts';
export const SEASON_FREE_AGENCY_CALIBRATE_OPTIONS: Record<string, boolean> = {
    input: true,
    'seed-from': true,
    'seed-to': true,
    workers: true,
    out: true,
    manifest: true,
    validate: true,
    format: true,
};
export const DEFAULT_FREE_AGENCY_TARGETS = resolve(DEFAULT_SEASON_DIR, 'free-agency-targets.json');
export const SEASON_FREE_AGENCY_CALIBRATION_SEED_COUNT = 8;
export const SEASON_FREE_AGENCY_VALIDATION_SEED_COUNT = 4;
export const SEASON_FREE_AGENCY_MAX_SIGNINGS = 3;
export const SEASON_FREE_AGENCY_MAX_SEASON_SPEND = 6;
export const SEASON_FREE_AGENCY_OWNERSHIP_MIN = 300;
export const SEASON_FREE_AGENCY_OWNERSHIP_MAX = 450;
export const SEASON_FREE_AGENCY_ABOVE_DRAFTED_MIN = 0;
export const SEASON_FREE_AGENCY_ABOVE_DRAFTED_MAX = 0.5;
export const SEASON_FREE_AGENCY_SKIP_SHARE_MAX = 0.95;
export const SEASON_FREE_AGENCY_MIN_SEASONS = 4;
export interface SeasonFreeAgencyFactsCatalog {
    overallByVersion: Map<string, number>;
    playableByVersion: Map<string, readonly Position[]>;
}
export interface SeasonFreeAgencyOpenedWindow {
    blockIndex: number;
    windowIndex: number;
    window: SeasonFreeAgencyWindowState;
}
export interface SeasonFreeAgencySeasonFacts {
    rootSeed: Seed;
    run: SeasonRun;
    effects: SeasonEffectsState;
    catalog: SeasonFreeAgencyFactsCatalog;
    summaries: SeasonGameSummary[];
    windows: SeasonFreeAgencyOpenedWindow[];
    draftedVersionIds: string[];
    audit: {
        failures: string[];
        counts: SeasonFreeAgencyAuditCounts;
    };
    determinismProbe: {
        probed: boolean;
        identical: boolean;
    };
}
export function simulateSeasonFreeAgencyFacts(options: {
    runPath?: string | null;
    manifestPath?: string | null;
    profileEra?: string | null;
    rootSeed: Seed;
    driveFreeAgency: boolean;
    probeWindow?: boolean;
}): SeasonFreeAgencySeasonFacts {
    const state: SeasonBlockRunnerState = createSeasonBlockRunner({
        runPath: options.runPath,
        manifestPath: options.manifestPath,
        profileEra: options.profileEra,
    });
    const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST;
    const freeAgencyIndex = loadSeasonFreeAgencyIndex(manifestPath);
    const freeAgencyTargets = loadSeasonRosterTargets(manifestPath);
    const franchiseIds = state.run.league.teams.map((team) => team.franchiseId);
    const run = m25FreshRun({
        base: state.run,
        rootSeed: options.rootSeed,
        franchiseIds,
        effects: state.effects,
    });
    state.run = run;
    state.health = run.health;
    state.objectiveId = null;
    state.checkpointState = null;
    state.stateRevision = 0;
    state.stateDigest = run.stateDigest;
    state.summaries = [];
    state.acceptedCommandIds = [];
    const draftedVersionIds = run.rosters.flatMap((roster) => roster.players.map((player) => player.playerVersionId));
    const overallByVersion = new Map<string, number>();
    const playableByVersion = new Map<string, readonly Position[]>();
    for (const candidate of state.catalog.candidates) {
        overallByVersion.set(candidate.playerVersionId, candidate.summaryRatings.overallRating);
        playableByVersion.set(candidate.playerVersionId, candidate.positions.playable);
    }
    const catalog: SeasonFreeAgencyFactsCatalog = { overallByVersion, playableByVersion };
    const windows: SeasonFreeAgencyOpenedWindow[] = [];
    let probed = false;
    let determinismProbe: {
        probed: boolean;
        identical: boolean;
    } = {
        probed: false,
        identical: true,
    };
    for (let blockIndex = 0; blockIndex < SEASON_BLOCK_COUNT; blockIndex += 1) {
        const command = runnerBlockCommand(state, blockIndex);
        const input: SeasonBlockSimulationInput = {
            ...runnerPipelineInput(state, command),
            transactions: state.run.transactions,
        };
        assertBlockPreconditions(state, command, input, blockIndex);
        const checkpoint = simulateBlockGames(state, input, blockIndex);
        state.summaries = [...state.summaries, ...checkpoint.gameSummaries];
        state.acceptedCommandIds = [...state.acceptedCommandIds, command.commandId];
        state.health = checkpoint.health;
        const stateFacts = deriveSeasonPostBlockState({
            run: state.run,
            candidate: checkpoint,
            commandId: command.commandId,
            rotationDigest: command.rotationDigest,
        });
        let run: SeasonRun = {
            ...state.run,
            cursor: { schemaVersion: 1, completedRounds: checkpoint.completedRounds },
            standings: checkpoint.standings,
            health: checkpoint.health,
            influence: checkpoint.influence,
            transactions: checkpoint.transactions,
            checkpointState: stateFacts.checkpointState,
            stateRevision: stateFacts.stateRevision,
            stateDigest: stateFacts.stateDigest,
        };
        let effects: SeasonEffectsState = checkpoint.effects;
        let tradeOpened = false;
        if ((M25_TRADE_WINDOW_BLOCKS as readonly number[]).includes(blockIndex) &&
            run.rosters.every((roster) => roster.players.length === 10)) {
            const trade = openSeasonTradeWindow({
                run,
                blockIndex,
                rootSeed: options.rootSeed,
                humanFranchiseId: state.humanFranchiseId,
                catalog: state.catalog,
                effects,
            });
            if (trade !== null) {
                tradeOpened = true;
                run = {
                    ...run,
                    trade: trade.trade,
                    influence: trade.influence,
                    transactions: trade.transactions,
                    rosters: trade.rosters,
                    ownership: trade.ownership,
                    rotations: trade.rotations,
                    health: trade.health,
                    checkpointState: stateFacts.checkpointState,
                    stateRevision: trade.stateRevision,
                    stateDigest: trade.stateDigest,
                };
                effects = trade.effects;
            }
        }
        let freeAgencyWindow: SeasonFreeAgencyWindowState | null = null;
        if (options.driveFreeAgency &&
            SEASON_FREE_AGENCY_WINDOW_BLOCK_INDEXES.includes(blockIndex) &&
            freeAgencyUnresolvedWindowIndex(run.freeAgency) === null) {
            const windowIndex = SEASON_FREE_AGENCY_WINDOW_BLOCK_INDEXES.indexOf(blockIndex);
            const opened = openSeasonFreeAgencyWindow({
                run,
                effects,
                catalog: state.catalog,
                index: freeAgencyIndex,
                targets: freeAgencyTargets,
                humanFranchiseId: state.humanFranchiseId,
            }, windowIndex, blockIndex);
            if (options.probeWindow && !probed) {
                const again = openSeasonFreeAgencyWindow({
                    run,
                    effects,
                    catalog: state.catalog,
                    index: freeAgencyIndex,
                    targets: freeAgencyTargets,
                    humanFranchiseId: state.humanFranchiseId,
                }, windowIndex, blockIndex);
                determinismProbe = {
                    probed: true,
                    identical: JSON.stringify(again.freeAgency) === JSON.stringify(opened.freeAgency) &&
                        JSON.stringify(again.window) === JSON.stringify(opened.window),
                };
                probed = true;
            }
            const next: SeasonRun = {
                ...run,
                freeAgency: opened.freeAgency,
                stateRevision: run.stateRevision + 1,
                stateDigest: '',
            };
            run = {
                ...next,
                stateDigest: seasonRunStateDigest(m25RunStateFacts(next, effects)),
            };
            freeAgencyWindow = opened.window;
            windows.push({ blockIndex, windowIndex, window: opened.window });
        }
        state.run = run;
        state.effects = effects;
        state.checkpointState = run.checkpointState;
        state.stateRevision = run.stateRevision;
        state.stateDigest = run.stateDigest;
        if (tradeOpened || freeAgencyWindow !== null) {
            state.expanded = expandRostersWidened(state.run, state.catalog);
            state.rosterPlayerIds = rosterPlayerIdsOf(state.run);
        }
        if (freeAgencyWindow !== null) {
            runFreeAgencyCommands(state, freeAgencyWindow.windowIndex, {
                rootSeed: options.rootSeed,
                freeAgencyIndex,
                freeAgencyTargets,
            });
        }
    }
    const audit = auditSeasonFreeAgencyFacts(state.run);
    return {
        rootSeed: options.rootSeed,
        run: state.run,
        effects: state.effects,
        catalog,
        summaries: state.summaries,
        windows,
        draftedVersionIds,
        audit,
        determinismProbe,
    };
}
export function expandRostersWidened(run: SeasonRun, catalog: import('@hoop-rush/data-contracts').SeasonDraftCatalog): Map<string, import('@hoop-rush/data-contracts').SeasonGamePlayerInput> {
    const candidates = new Map(catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]));
    const expanded = new Map<string, import('@hoop-rush/data-contracts').SeasonGamePlayerInput>();
    const seen = new Set<string>();
    for (const roster of run.rosters) {
        for (const player of roster.players) {
            const candidate = candidates.get(player.playerVersionId);
            if (candidate === undefined) {
                throw new Error(`roster ${roster.franchiseId} references unknown catalog version ${player.playerVersionId}`);
            }
            if (seen.has(player.playerVersionId)) {
                throw new Error(`playerVersionId ${player.playerVersionId} appears on more than one roster`);
            }
            seen.add(player.playerVersionId);
            expanded.set(player.playerVersionId, {
                playerVersionId: player.playerVersionId,
                playerId: player.playerId,
                displayName: player.displayName,
                positions: candidate.positions.playable,
                heightInches: candidate.heightInches,
                weightLbs: candidate.weightLbs,
                ratings: candidate.detailedRatings,
                tendencies: candidate.tendencies,
                stamina: {
                    schemaVersion: 1,
                    playerVersionId: player.playerVersionId,
                    rating: candidate.stamina.rating,
                    historicalMpg: candidate.stamina.historicalMpg,
                    derivationVersion: candidate.stamina.derivationVersion,
                },
            });
        }
    }
    return expanded;
}
function assertBlockPreconditions(state: SeasonBlockRunnerState, command: SeasonSubmitBlockCommand, input: SeasonBlockSimulationInput, blockIndex: number): void {
    const next = seasonNextBlockIndex(state.run.cursor.completedRounds);
    if (next !== blockIndex) {
        throw new Error(`block ${String(blockIndex)} expected, cursor is at ${String(next)}`);
    }
    const unresolved = freeAgencyUnresolvedWindowIndex(state.run.freeAgency);
    if (unresolved !== null) {
        throw new Error(`block ${String(blockIndex)} rejected: free-agency window ${String(unresolved)} unresolved`);
    }
    const computedDigest = seasonRotationSetDigest(state.run.rotations);
    if (computedDigest !== command.rotationDigest) {
        throw new Error(`block ${String(blockIndex)} rotation set digest mismatch`);
    }
    const playableByVersion = new Map<string, readonly Position[]>();
    for (const player of input.expanded.values()) {
        playableByVersion.set(player.playerVersionId, player.positions);
    }
    const rosterMembersByFranchise = new Map<string, SeasonRosterMemberInput[]>();
    for (const roster of state.run.rosters) {
        rosterMembersByFranchise.set(roster.franchiseId, roster.players.map((player) => ({
            playerVersionId: player.playerVersionId,
            playable: playableByVersion.get(player.playerVersionId) ?? [],
        })));
    }
    for (const rotation of state.run.rotations) {
        const rosterMembers = rosterMembersByFranchise.get(rotation.franchiseId) ?? [];
        const rosterIds = new Set(rosterMembers.map((member) => member.playerVersionId));
        const members = [...rotation.starters, ...rotation.benchOrder].map((playerVersionId) => {
            if (!rosterIds.has(playerVersionId)) {
                throw new Error(`block ${String(blockIndex)}: rotation of ${rotation.franchiseId} references an unrostered player ${playerVersionId}`);
            }
            return {
                playerVersionId,
                playable: playableByVersion.get(playerVersionId) ?? [],
            };
        });
        if (members.length !== 10) {
            throw new Error(`block ${String(blockIndex)}: rotation of ${rotation.franchiseId} is not ten players`);
        }
        if (!legalFiveAfterAnyRemoval(members)) {
            throw new Error(`block ${String(blockIndex)}: rotation of ${rotation.franchiseId} has no legal five after any removal`);
        }
        const memberPlayable = new Map(members.map((member) => [member.playerVersionId, member.playable]));
        if (validateSeasonRotation(rotation, memberPlayable).length > 0) {
            throw new Error(`block ${String(blockIndex)}: rotation of ${rotation.franchiseId} is illegal`);
        }
    }
}
function simulateBlockGames(state: SeasonBlockRunnerState, input: SeasonBlockSimulationInput, blockIndex: number): SeasonCandidateCheckpoint {
    const summaries: SeasonGameSummary[] = [];
    const retainedDetails: NonNullable<Extract<SeasonBlockGameOutcome, {
        summary: SeasonGameSummary;
    }>['retainedDetail']>[] = [];
    const { fromRound } = blockRoundRangeLocal(blockIndex);
    let previousRound = fromRound - 1;
    let effects = input.effects;
    let health = input.health;
    const rotationIdsByFranchise = new Map(state.run.rotations.map((rotation) => [
        rotation.franchiseId,
        new Set([...rotation.starters, ...rotation.benchOrder]),
    ]));
    const shared = {
        gameNumberById: new Map(input.schedule.games.map((game, index) => [game.gameId, index + 1])),
        rotationByFranchise: new Map(input.run.rotations.map((rotation) => [rotation.franchiseId, rotation])),
        rosterByFranchise: new Map(input.run.rosters.map((roster) => {
            const rotationIds = rotationIdsByFranchise.get(roster.franchiseId) ?? new Set<string>();
            return [
                roster.franchiseId,
                {
                    ...roster,
                    players: roster.players.filter((player) => rotationIds.has(player.playerVersionId)),
                },
            ];
        })),
        staminaByVersion: new Map([...input.expanded.values()].map((player) => {
            if (player.stamina === undefined) {
                throw new Error(`expanded player ${player.playerVersionId} has no stamina profile`);
            }
            return [player.playerVersionId, player.stamina.rating];
        })),
        durabilityByVersion: new Map(input.catalog.candidates.map((candidate) => [
            candidate.playerVersionId,
            candidate.durability.rating,
        ])),
        positions: new Map([...input.expanded.values()].map((player) => [player.playerVersionId, player.positions])),
    };
    for (const game of seasonBlockGamesOf(input.schedule, blockIndex)) {
        const outcome = simulateSeasonBlockGame(input, game, effects, health, {
            skipRecoveryTick: !(previousRound !== 0 && game.round > previousRound),
            ...shared,
        });
        if ('interruption' in outcome) {
            throw new Error(`game ${game.gameId} interrupted: the human franchise cannot field a legal five from health availability`);
        }
        effects = outcome.effects;
        health = outcome.health;
        previousRound = game.round;
        summaries.push(outcome.summary);
        if (outcome.retainedDetail !== null)
            retainedDetails.push(outcome.retainedDetail);
    }
    return assembleSeasonBlockCandidate(input, summaries, retainedDetails, effects, health);
}
function blockRoundRangeLocal(blockIndex: number): {
    fromRound: number;
    toRound: number;
} {
    const fromRound = blockIndex * 10 + 1;
    return { fromRound, toRound: fromRound + 9 };
}
function runFreeAgencyCommands(state: SeasonBlockRunnerState, windowIndex: number, deps: {
    rootSeed: Seed;
    freeAgencyIndex: SeasonFreeAgencyIndex;
    freeAgencyTargets: SeasonRosterTargets;
}): void {
    const commandContext = {
        run: state.run,
        pending: null,
        humanFranchiseId: state.humanFranchiseId,
        catalog: state.catalog,
        effects: state.effects,
        freeAgencyIndex: deps.freeAgencyIndex,
        freeAgencyTargets: deps.freeAgencyTargets,
    };
    if (state.humanFranchiseId !== null) {
        const humanFranchiseId = franchiseIdSchema.parse(state.humanFranchiseId);
        const skipCommand: SeasonSkipFreeAgentMarketCommand = {
            schemaVersion: SEASON_RUN_SCHEMA_VERSION,
            command: 'skip-free-agent-market',
            commandId: commandIdSchema.parse(`fa-skip-${deps.rootSeed}-${String(windowIndex)}`),
            runId: state.run.runId,
            expectedStateRevision: state.stateRevision,
            expectedStateDigest: state.stateDigest,
            franchiseId: humanFranchiseId,
            windowIndex,
        };
        const skipped = handleSeasonRunCommand(skipCommand, commandContext);
        if (skipped.result.result.status === 'rejected') {
            throw new Error(`seed ${deps.rootSeed} window ${String(windowIndex)} skip rejected (${skipped.result.result.rejection.code})`);
        }
        state.run = skipped.run;
        state.effects =
            (skipped.run as SeasonRun & {
                effects?: SeasonEffectsState;
            }).effects ?? state.effects;
        state.stateRevision = skipped.run.stateRevision;
        state.stateDigest = skipped.run.stateDigest;
    }
    const resolveCommand: SeasonResolveFreeAgentMarketCommand = {
        schemaVersion: SEASON_RUN_SCHEMA_VERSION,
        command: 'resolve-free-agent-market',
        commandId: commandIdSchema.parse(`fa-resolve-${deps.rootSeed}-${String(windowIndex)}`),
        runId: state.run.runId,
        expectedStateRevision: state.stateRevision,
        expectedStateDigest: state.stateDigest,
        windowIndex,
    };
    const resolved = handleSeasonRunCommand(resolveCommand, {
        ...commandContext,
        run: state.run,
        effects: state.effects,
    });
    if (resolved.result.result.status === 'rejected') {
        throw new Error(`seed ${deps.rootSeed} window ${String(windowIndex)} resolve rejected (${resolved.result.result.rejection.code})`);
    }
    state.run = resolved.run;
    state.effects =
        (resolved.run as SeasonRun & {
            effects?: SeasonEffectsState;
        }).effects ?? state.effects;
    state.stateRevision = resolved.run.stateRevision;
    state.stateDigest = resolved.run.stateDigest;
    state.expanded = expandRostersWidened(state.run, state.catalog);
    state.rosterPlayerIds = rosterPlayerIdsOf(state.run);
}
export interface SeasonFreeAgencyMeasuredFacts {
    seasonsSimulated: number;
    windowsOpened: number;
    windowsComplete: number;
    candidateTotal: number;
    candidateShortfalls: number;
    uniqueIdentities: number;
    canonicalReuse: number;
    declarations: number;
    declaredTargets: number;
    interestByBand: Record<SeasonFreeAgencyBand, number>;
    winsByBand: Record<SeasonFreeAgencyBand, number>;
    interestFranchises: number;
    skipFranchises: number;
    skipShare: number;
    signings: number;
    signingFranchises: number;
    signingsPerFranchiseMean: number;
    signingsPerFranchiseMin: number;
    signingsPerFranchiseMax: number;
    signingCapReached: number;
    bandCapViolations: number;
    signingCapViolations: number;
    spendCapViolations: number;
    influenceCostsMean: number;
    influenceCostsMin: number;
    influenceCostsMax: number;
    rosterSizesMean: number;
    rosterSizesMin: number;
    rosterSizesMax: number;
    ownershipRows: number;
    activeLoads: number;
    activePairs: number;
    effectsFailures: number;
    rosterIllegal: number;
    rotationIllegal: number;
    traceAuditFailures: number;
    linkFailures: number;
    influenceDecideFailures: number;
    eliteExclusionFailures: number;
    oneOutlierFailures: number;
    signedAboveDraftedMedian: number;
    signedAboveDraftedMedianShare: number;
    signingsByBand: Record<'contender' | 'playoff' | 'average' | 'weaker', number>;
    richGetRicherFailures: number;
    determinismProbe: {
        probed: boolean;
        identical: boolean;
    };
    summaryIdentityProbe: {
        probed: boolean;
        identical: boolean;
    };
}
const BANDS: readonly SeasonFreeAgencyBand[] = ['featured', 'role', 'development', 'emergency'];
type SeasonStrengthBand = 'contender' | 'playoff' | 'average' | 'weaker';
function zeroBandRecord(): Record<SeasonFreeAgencyBand, number> {
    return { featured: 0, role: 0, development: 0, emergency: 0 };
}
function zeroStrengthRecord(): Record<SeasonStrengthBand, number> {
    return { contender: 0, playoff: 0, average: 0, weaker: 0 };
}
export function medianOf(sorted: number[]): number {
    if (sorted.length === 0)
        return 0;
    const mid = Math.floor(sorted.length / 2);
    return sorted[mid] ?? 0;
}
export function seasonFreeAgencyFactsOf(season: SeasonFreeAgencySeasonFacts, draftedMedianOverall: number): SeasonFreeAgencyMeasuredFacts {
    const run = season.run;
    const freeAgency: SeasonFreeAgencyState = run.freeAgency;
    const windows = run.freeAgency.windows;
    const signings = windows.flatMap((window) => window.signings);
    const candidateShortfalls = windows.filter((window) => window.candidates.length < SEASON_FREE_AGENCY_WINDOW_MAX_CANDIDATES).length;
    const uniqueIdentities = new Set(windows.flatMap((window) => window.candidates.map((candidate) => candidate.playerId))).size;
    let canonicalReuse = 0;
    for (const window of windows) {
        for (const candidate of window.candidates) {
            const canonical = freeAgency.canonicalCandidates[candidate.playerId];
            if (canonical !== undefined && canonical.admittedWindowIndex < window.windowIndex) {
                canonicalReuse += 1;
            }
        }
    }
    const declarations = windows.reduce((sum, window) => sum + Object.keys(window.declarations).length, 0);
    const interestByBand = zeroBandRecord();
    const winsByBand = zeroBandRecord();
    let declaredTargets = 0;
    const interestFranchises = new Set<string>();
    const skipFranchises = new Set<string>();
    for (const window of windows) {
        for (const declaration of Object.values(window.declarations)) {
            if (declaration.targets.length === 0) {
                skipFranchises.add(declaration.franchiseId);
                continue;
            }
            interestFranchises.add(declaration.franchiseId);
            declaredTargets += declaration.targets.length;
            for (const target of declaration.targets) {
                const candidate = window.candidates.find((entry) => entry.playerVersionId === target.playerVersionId);
                if (candidate !== undefined)
                    interestByBand[candidate.band] += 1;
            }
        }
    }
    for (const signing of signings)
        winsByBand[signing.band] += 1;
    const signingsPerFranchise = run.league.teams.map((team) => freeAgency.signingCounts[team.franchiseId] ?? 0);
    const rosterSizes = run.rosters.map((roster) => roster.players.length);
    const influenceCosts = signings.map((signing) => signing.influenceCost);
    const bandOf = new Map(run.aiAssignments.map((assignment) => [assignment.franchiseId, assignment.band]));
    const signingsByBand = zeroStrengthRecord();
    const outliersPerFranchise = new Map<string, number>();
    for (const signing of signings) {
        const band = bandOf.get(signing.franchiseId) ?? 'average';
        signingsByBand[band] += 1;
        const overall = season.catalog.overallByVersion.get(signing.playerVersionId) ?? 0;
        if (overall > 100) {
            outliersPerFranchise.set(signing.franchiseId, (outliersPerFranchise.get(signing.franchiseId) ?? 0) + 1);
        }
    }
    let oneOutlierFailures = 0;
    for (const count of outliersPerFranchise.values()) {
        if (count > 1)
            oneOutlierFailures += 1;
    }
    const signedAboveDraftedMedian = signings.filter((signing) => {
        const overall = season.catalog.overallByVersion.get(signing.playerVersionId) ?? 0;
        return overall > draftedMedianOverall;
    }).length;
    const draftedVersionIds = new Set(season.draftedVersionIds);
    const eliteExclusionFailures = signings.filter((signing) => {
        if (draftedVersionIds.has(signing.playerVersionId))
            return true;
        return season.run.rosters
            .filter((roster) => roster.franchiseId !== signing.franchiseId)
            .some((roster) => roster.players.some((player) => player.playerId === signing.playerId));
    }).length;
    let influenceDecideFailures = 0;
    for (const window of windows) {
        const trace = window.traces[0];
        if (trace === undefined)
            continue;
        const candidates = new Set(trace.steps.map((step) => step.candidatePlayerVersionId));
        for (const candidatePlayerVersionId of candidates) {
            const claims = Object.values(window.declarations)
                .filter((declaration) => declaration.targets.some((target) => target.playerVersionId === candidatePlayerVersionId))
                .map((declaration) => declaration.franchiseId)
                .sort();
            if (claims.length < 2)
                continue;
            const winner = trace.firstPriorityWinners
                .concat(trace.secondPriorityWinners)
                .find((entry) => entry.candidatePlayerVersionId === candidatePlayerVersionId);
            const influenceOf = (franchiseId: FranchiseId): number => window.declarations[franchiseId]?.targets.find((target: {
                playerVersionId: string;
                influence: number;
            }) => target.playerVersionId === candidatePlayerVersionId)?.influence ?? 0;
            const steps = trace.steps.filter((step) => step.candidatePlayerVersionId === candidatePlayerVersionId);
            let decisiveCriterion: string | null = null;
            for (const step of steps) {
                if (!(step.criterion === 'legality' && step.category === 'legal')) {
                    decisiveCriterion = step.criterion;
                }
            }
            if ((decisiveCriterion === 'influence' || decisiveCriterion === 'draw') &&
                winner !== undefined &&
                influenceOf(winner.winnerFranchiseId) <
                    Math.max(...claims
                        .filter((franchiseId) => franchiseId !== winner.winnerFranchiseId)
                        .map(influenceOf), 0)) {
                influenceDecideFailures += 1;
            }
        }
    }
    const contenders = run.league.teams.filter((team) => (bandOf.get(team.franchiseId) ?? 'average') === 'contender');
    const weaker = run.league.teams.filter((team) => (bandOf.get(team.franchiseId) ?? 'average') === 'weaker');
    const contenderSignings = contenders.reduce((sum, team) => sum + (freeAgency.signingCounts[team.franchiseId] ?? 0), 0);
    const weakerSignings = weaker.reduce((sum, team) => sum + (freeAgency.signingCounts[team.franchiseId] ?? 0), 0);
    const richGetRicherFailures = weakerSignings > 0 && contenderSignings >= weakerSignings ? 1 : 0;
    const { rosterIllegal, rotationIllegal, activeLoads, activePairs } = effectsAccountingOf(season);
    return {
        seasonsSimulated: 1,
        windowsOpened: windows.length,
        windowsComplete: windows.filter((window) => window.status === 'resolved').length,
        candidateTotal: windows.reduce((sum, window) => sum + window.candidates.length, 0),
        candidateShortfalls,
        uniqueIdentities,
        canonicalReuse,
        declarations,
        declaredTargets,
        interestByBand,
        winsByBand,
        interestFranchises: interestFranchises.size,
        skipFranchises: skipFranchises.size,
        skipShare: share(skipFranchises.size, run.league.teams.length),
        signings: signings.length,
        signingFranchises: new Set(signings.map((signing) => signing.franchiseId)).size,
        signingsPerFranchiseMean: mean(signingsPerFranchise),
        signingsPerFranchiseMin: Math.min(...signingsPerFranchise, 0),
        signingsPerFranchiseMax: Math.max(...signingsPerFranchise, 0),
        signingCapReached: signingsPerFranchise.filter((count) => count >= 3).length,
        bandCapViolations: season.audit.counts.bandCapFailures,
        signingCapViolations: season.audit.counts.signingCapFailures,
        spendCapViolations: season.audit.counts.spendCapFailures,
        influenceCostsMean: mean(influenceCosts),
        influenceCostsMin: Math.min(...influenceCosts, 0),
        influenceCostsMax: Math.max(...influenceCosts, 0),
        rosterSizesMean: mean(rosterSizes),
        rosterSizesMin: Math.min(...rosterSizes, 0),
        rosterSizesMax: Math.max(...rosterSizes, 0),
        ownershipRows: run.ownership.length,
        activeLoads,
        activePairs,
        effectsFailures: season.audit.counts.effectsFailures,
        rosterIllegal,
        rotationIllegal,
        traceAuditFailures: season.audit.counts.traceFailures,
        linkFailures: season.audit.counts.ledgerFailures +
            season.audit.counts.transactionFailures +
            season.audit.counts.ownershipFailures,
        influenceDecideFailures,
        eliteExclusionFailures,
        oneOutlierFailures,
        signedAboveDraftedMedian,
        signedAboveDraftedMedianShare: share(signedAboveDraftedMedian, signings.length),
        signingsByBand,
        richGetRicherFailures,
        determinismProbe: season.determinismProbe,
        summaryIdentityProbe: { probed: false, identical: true },
    };
}
function effectsAccountingOf(season: SeasonFreeAgencySeasonFacts): {
    rosterIllegal: number;
    rotationIllegal: number;
    activeLoads: number;
    activePairs: number;
} {
    const run = season.run;
    let rosterIllegal = 0;
    const versions = new Set<string>();
    const membersByFranchise = new Map<string, SeasonRosterMemberInput[]>();
    for (const roster of run.rosters) {
        const members: SeasonRosterMemberInput[] = roster.players.map((player) => ({
            playerVersionId: player.playerVersionId,
            playable: season.catalog.playableByVersion.get(player.playerVersionId) ?? [],
        }));
        if (members.length < 10 || members.length > 15)
            rosterIllegal += 1;
        const counts = rosterGroupCounts(members);
        if (counts.guards < 3 || counts.forwards < 3 || counts.centers < 2)
            rosterIllegal += 1;
        if (!legalFiveExists(members))
            rosterIllegal += 1;
        if (!legalFiveAfterAnyRemoval(members))
            rosterIllegal += 1;
        for (const player of roster.players) {
            if (versions.has(player.playerVersionId))
                rosterIllegal += 1;
            versions.add(player.playerVersionId);
        }
        membersByFranchise.set(roster.franchiseId, members);
    }
    let rotationIllegal = 0;
    let activeLoads = 0;
    for (const rotation of run.rotations) {
        const rosterMembers = membersByFranchise.get(rotation.franchiseId) ?? [];
        const rosterIds = new Set(rosterMembers.map((member) => member.playerVersionId));
        const rotationMembers = [...rotation.starters, ...rotation.benchOrder].map((playerVersionId) => {
            if (!rosterIds.has(playerVersionId))
                rotationIllegal += 1;
            return {
                playerVersionId,
                playable: season.catalog.playableByVersion.get(playerVersionId) ?? [],
            };
        });
        if (rotationMembers.length !== 10)
            rotationIllegal += 1;
        if (!legalFiveAfterAnyRemoval(rotationMembers))
            rotationIllegal += 1;
        activeLoads += rotationMembers.length;
    }
    const activePairs = run.rotations.length * 45;
    return { rosterIllegal, rotationIllegal, activeLoads, activePairs };
}
function emptyMeasured(): SeasonFreeAgencyMeasuredFacts {
    return {
        seasonsSimulated: 0,
        windowsOpened: 0,
        windowsComplete: 0,
        candidateTotal: 0,
        candidateShortfalls: 0,
        uniqueIdentities: 0,
        canonicalReuse: 0,
        declarations: 0,
        declaredTargets: 0,
        interestByBand: zeroBandRecord(),
        winsByBand: zeroBandRecord(),
        interestFranchises: 0,
        skipFranchises: 0,
        skipShare: 0,
        signings: 0,
        signingFranchises: 0,
        signingsPerFranchiseMean: 0,
        signingsPerFranchiseMin: 0,
        signingsPerFranchiseMax: 0,
        signingCapReached: 0,
        bandCapViolations: 0,
        signingCapViolations: 0,
        spendCapViolations: 0,
        influenceCostsMean: 0,
        influenceCostsMin: 0,
        influenceCostsMax: 0,
        rosterSizesMean: 0,
        rosterSizesMin: 0,
        rosterSizesMax: 0,
        ownershipRows: 0,
        activeLoads: 0,
        activePairs: 0,
        effectsFailures: 0,
        rosterIllegal: 0,
        rotationIllegal: 0,
        traceAuditFailures: 0,
        linkFailures: 0,
        influenceDecideFailures: 0,
        eliteExclusionFailures: 0,
        oneOutlierFailures: 0,
        signedAboveDraftedMedian: 0,
        signedAboveDraftedMedianShare: 0,
        signingsByBand: zeroStrengthRecord(),
        richGetRicherFailures: 0,
        determinismProbe: { probed: false, identical: true },
        summaryIdentityProbe: { probed: false, identical: true },
    };
}
export function foldFreeAgencyCohort(seasons: readonly SeasonFreeAgencySeasonFacts[], draftedMedianOverall: number): SeasonFreeAgencyMeasuredFacts {
    const folded = emptyMeasured();
    const signingsPerFranchiseMean: number[] = [];
    const influenceCostsMean: number[] = [];
    const rosterSizesMean: number[] = [];
    let signingsPerFranchiseMin = Number.POSITIVE_INFINITY;
    let signingsPerFranchiseMax = 0;
    let influenceCostsMin = Number.POSITIVE_INFINITY;
    let influenceCostsMax = 0;
    let rosterSizesMin = Number.POSITIVE_INFINITY;
    let rosterSizesMax = 0;
    let interestFranchises = 0;
    let skipFranchises = 0;
    for (const season of seasons) {
        const facts = seasonFreeAgencyFactsOf(season, draftedMedianOverall);
        folded.seasonsSimulated += facts.seasonsSimulated;
        folded.windowsOpened += facts.windowsOpened;
        folded.windowsComplete += facts.windowsComplete;
        folded.candidateTotal += facts.candidateTotal;
        folded.candidateShortfalls += facts.candidateShortfalls;
        folded.uniqueIdentities += facts.uniqueIdentities;
        folded.canonicalReuse += facts.canonicalReuse;
        folded.declarations += facts.declarations;
        folded.declaredTargets += facts.declaredTargets;
        folded.interestByBand.featured += facts.interestByBand.featured;
        folded.interestByBand.role += facts.interestByBand.role;
        folded.interestByBand.development += facts.interestByBand.development;
        folded.interestByBand.emergency += facts.interestByBand.emergency;
        folded.winsByBand.featured += facts.winsByBand.featured;
        folded.winsByBand.role += facts.winsByBand.role;
        folded.winsByBand.development += facts.winsByBand.development;
        folded.winsByBand.emergency += facts.winsByBand.emergency;
        interestFranchises += facts.interestFranchises;
        skipFranchises += facts.skipFranchises;
        folded.signings += facts.signings;
        folded.signingFranchises += facts.signingFranchises;
        signingsPerFranchiseMean.push(facts.signingsPerFranchiseMean);
        signingsPerFranchiseMin = Math.min(signingsPerFranchiseMin, facts.signingsPerFranchiseMin);
        signingsPerFranchiseMax = Math.max(signingsPerFranchiseMax, facts.signingsPerFranchiseMax);
        folded.signingCapReached += facts.signingCapReached;
        folded.bandCapViolations += facts.bandCapViolations;
        folded.signingCapViolations += facts.signingCapViolations;
        folded.spendCapViolations += facts.spendCapViolations;
        influenceCostsMean.push(facts.influenceCostsMean);
        influenceCostsMin = Math.min(influenceCostsMin, facts.influenceCostsMin);
        influenceCostsMax = Math.max(influenceCostsMax, facts.influenceCostsMax);
        rosterSizesMean.push(facts.rosterSizesMean);
        rosterSizesMin = Math.min(rosterSizesMin, facts.rosterSizesMin);
        rosterSizesMax = Math.max(rosterSizesMax, facts.rosterSizesMax);
        folded.ownershipRows += facts.ownershipRows;
        folded.activeLoads += facts.activeLoads;
        folded.activePairs += facts.activePairs;
        folded.effectsFailures += facts.effectsFailures;
        folded.rosterIllegal += facts.rosterIllegal;
        folded.rotationIllegal += facts.rotationIllegal;
        folded.traceAuditFailures += facts.traceAuditFailures;
        folded.linkFailures += facts.linkFailures;
        folded.influenceDecideFailures += facts.influenceDecideFailures;
        folded.eliteExclusionFailures += facts.eliteExclusionFailures;
        folded.oneOutlierFailures += facts.oneOutlierFailures;
        folded.signedAboveDraftedMedian += facts.signedAboveDraftedMedian;
        folded.signingsByBand.contender += facts.signingsByBand.contender;
        folded.signingsByBand.playoff += facts.signingsByBand.playoff;
        folded.signingsByBand.average += facts.signingsByBand.average;
        folded.signingsByBand.weaker += facts.signingsByBand.weaker;
        folded.richGetRicherFailures += facts.richGetRicherFailures;
        if (facts.determinismProbe.probed) {
            folded.determinismProbe = {
                probed: true,
                identical: folded.determinismProbe.identical && facts.determinismProbe.identical,
            };
        }
    }
    folded.interestFranchises = interestFranchises;
    folded.skipFranchises = skipFranchises;
    folded.skipShare = share(skipFranchises, Math.max(1, seasons.length * 30));
    folded.signingsPerFranchiseMean = mean(signingsPerFranchiseMean);
    folded.signingsPerFranchiseMin =
        signingsPerFranchiseMin === Number.POSITIVE_INFINITY ? 0 : signingsPerFranchiseMin;
    folded.signingsPerFranchiseMax = signingsPerFranchiseMax;
    folded.influenceCostsMean = mean(influenceCostsMean);
    folded.influenceCostsMin = influenceCostsMin === Number.POSITIVE_INFINITY ? 0 : influenceCostsMin;
    folded.influenceCostsMax = influenceCostsMax;
    folded.rosterSizesMean = mean(rosterSizesMean);
    folded.rosterSizesMin = rosterSizesMin === Number.POSITIVE_INFINITY ? 0 : rosterSizesMin;
    folded.rosterSizesMax = rosterSizesMax;
    folded.signedAboveDraftedMedianShare = share(folded.signedAboveDraftedMedian, folded.signings);
    return folded;
}
export function evaluateFreeAgencyGates(calibration: SeasonFreeAgencyMeasuredFacts, heldOut: SeasonFreeAgencyMeasuredFacts, options: {
    summaryIdentity: {
        probed: boolean;
        identical: boolean;
    };
}): M25Gate[] {
    const c = calibration;
    const h = heldOut;
    const min = SEASON_FREE_AGENCY_MIN_SEASONS;
    const expectedWindows = SEASON_FREE_AGENCY_WINDOW_BLOCK_INDEXES.length * c.seasonsSimulated;
    const summaryIdentityGate = options.summaryIdentity.probed
        ? m25ToleranceGate('summaryIdentity', options.summaryIdentity.identical ? 1 : 0, 1, 0, 1, 1)
        : m25ToleranceGate('summaryIdentity', 1, 1, 0, 1, 1);
    const metrics: M25Gate[] = [
        m25ToleranceGate('windowsOpened', c.windowsOpened, expectedWindows, 0, c.seasonsSimulated, min),
        m25ToleranceGate('bandSigningCaps', c.bandCapViolations, 0, 0, c.seasonsSimulated, min),
        m25ToleranceGate('threeSigningsPerSeason', c.signingCapViolations, 0, 0, c.seasonsSimulated, min),
        m25ToleranceGate('sixInfluencePerSeason', c.spendCapViolations, 0, 0, c.seasonsSimulated, min),
        m25ToleranceGate('linkReconciliation', c.linkFailures, 0, 0, c.seasonsSimulated, min),
        m25ToleranceGate('traceAudit', c.traceAuditFailures, 0, 0, c.seasonsSimulated, min),
        m25ToleranceGate('effectsInvariants', c.effectsFailures, 0, 0, c.seasonsSimulated, min),
        m25ToleranceGate('rosterLegality', c.rosterIllegal + c.rotationIllegal, 0, 0, c.seasonsSimulated, min),
        m25RangeGate('ownershipRows', c.ownershipRows / Math.max(1, c.seasonsSimulated), SEASON_FREE_AGENCY_OWNERSHIP_MIN, SEASON_FREE_AGENCY_OWNERSHIP_MAX, c.seasonsSimulated, min),
        m25ToleranceGate('eliteExclusion', c.eliteExclusionFailures, 0, 0, c.seasonsSimulated, min),
        m25ToleranceGate('oneOutlierCeiling', c.oneOutlierFailures, 0, 0, c.seasonsSimulated, min),
        m25ToleranceGate('noRichGetRicher', c.richGetRicherFailures, 0, 0, c.seasonsSimulated, min),
        m25ToleranceGate('influenceTieBreak', c.influenceDecideFailures, 0, 0, c.seasonsSimulated, min),
        m25ToleranceGate('determinismProbe', c.determinismProbe.probed && c.determinismProbe.identical ? 1 : 0, 1, 0, c.seasonsSimulated, 1),
        m25RangeGate('candidateQuality', c.signedAboveDraftedMedianShare, SEASON_FREE_AGENCY_ABOVE_DRAFTED_MIN, SEASON_FREE_AGENCY_ABOVE_DRAFTED_MAX, c.signings, min * 3),
        m25RangeGate('interestActivity', c.skipShare, 0, SEASON_FREE_AGENCY_SKIP_SHARE_MAX, c.declarations, min * 30),
        summaryIdentityGate,
        m25ToleranceGate('heldOut.windowsOpened', h.windowsOpened, SEASON_FREE_AGENCY_WINDOW_BLOCK_INDEXES.length * h.seasonsSimulated, 0, h.seasonsSimulated, min),
        m25ToleranceGate('heldOut.bandSigningCaps', h.bandCapViolations, 0, 0, h.seasonsSimulated, min),
        m25ToleranceGate('heldOut.linkReconciliation', h.linkFailures, 0, 0, h.seasonsSimulated, min),
        m25ToleranceGate('heldOut.effectsInvariants', h.effectsFailures, 0, 0, h.seasonsSimulated, min),
        m25ToleranceGate('heldOut.rosterLegality', h.rosterIllegal + h.rotationIllegal, 0, 0, h.seasonsSimulated, min),
        m25ToleranceGate('heldOut.traceAudit', h.traceAuditFailures, 0, 0, h.seasonsSimulated, min),
        m25ToleranceGate('heldOut.determinism', h.determinismProbe.probed && h.determinismProbe.identical ? 1 : 0, 1, 0, h.seasonsSimulated, 1),
    ];
    return metrics;
}
export const seasonFreeAgencyTargetsSchema = z.object({
    schemaVersion: z.literal(1),
    targetsVersion: z.literal(SEASON_FREE_AGENCY_TARGETS_VERSION),
    policy: z.object({
        bandSigningCaps: z.object({
            contender: z.literal(1),
            playoff: z.literal(2),
            average: z.literal(3),
            weaker: z.literal(3),
        }),
        maxSigningsPerSeason: z.literal(3),
        maxSeasonSpend: z.literal(6),
        windowComposition: z.object({
            featured: z.literal(1),
            role: z.literal(5),
            development: z.literal(3),
            emergency: z.literal(3),
        }),
        maxCandidates: z.literal(12),
        minWindowsPerSeason: z.literal(3),
        ownershipRows: z.tuple([z.literal(300), z.literal(450)]),
        activeEffects: z.tuple([z.literal(300), z.literal(1350)]),
        aboveDraftedShareEnvelope: z.tuple([
            z.literal(SEASON_FREE_AGENCY_ABOVE_DRAFTED_MIN),
            z.literal(SEASON_FREE_AGENCY_ABOVE_DRAFTED_MAX),
        ]),
        skipShareMax: z.literal(SEASON_FREE_AGENCY_SKIP_SHARE_MAX),
        minSeasons: z.literal(4),
    }),
    cohort: z.object({
        seedFrom: z.number().int().nonnegative(),
        seedTo: z.number().int().nonnegative(),
    }),
    heldOut: z.object({
        seedFrom: z.number().int().nonnegative(),
        seedTo: z.number().int().nonnegative(),
    }),
    measured: z.object({
        calibration: z.object({
            seasonsSimulated: z.number().int().nonnegative(),
            windowsOpened: z.number().int().nonnegative(),
            windowsComplete: z.number().int().nonnegative(),
            candidateTotal: z.number().int().nonnegative(),
            candidateShortfalls: z.number().int().nonnegative(),
            uniqueIdentities: z.number().int().nonnegative(),
            canonicalReuse: z.number().int().nonnegative(),
            declarations: z.number().int().nonnegative(),
            declaredTargets: z.number().int().nonnegative(),
            interestByBand: z.object({
                featured: z.number().int().nonnegative(),
                role: z.number().int().nonnegative(),
                development: z.number().int().nonnegative(),
                emergency: z.number().int().nonnegative(),
            }),
            winsByBand: z.object({
                featured: z.number().int().nonnegative(),
                role: z.number().int().nonnegative(),
                development: z.number().int().nonnegative(),
                emergency: z.number().int().nonnegative(),
            }),
            interestFranchises: z.number().int().nonnegative(),
            skipFranchises: z.number().int().nonnegative(),
            skipShare: z.number().min(0).max(1),
            signings: z.number().int().nonnegative(),
            signingFranchises: z.number().int().nonnegative(),
            signingsPerFranchiseMean: z.number(),
            signingsPerFranchiseMin: z.number().int().nonnegative(),
            signingsPerFranchiseMax: z.number().int().nonnegative(),
            signingCapReached: z.number().int().nonnegative(),
            bandCapViolations: z.number().int().nonnegative(),
            signingCapViolations: z.number().int().nonnegative(),
            spendCapViolations: z.number().int().nonnegative(),
            influenceCostsMean: z.number(),
            influenceCostsMin: z.number().int().nonnegative(),
            influenceCostsMax: z.number().int().nonnegative(),
            rosterSizesMean: z.number(),
            rosterSizesMin: z.number().int().nonnegative(),
            rosterSizesMax: z.number().int().nonnegative(),
            ownershipRows: z.number().int().nonnegative(),
            activeLoads: z.number().int().nonnegative(),
            activePairs: z.number().int().nonnegative(),
            effectsFailures: z.number().int().nonnegative(),
            rosterIllegal: z.number().int().nonnegative(),
            rotationIllegal: z.number().int().nonnegative(),
            traceAuditFailures: z.number().int().nonnegative(),
            linkFailures: z.number().int().nonnegative(),
            influenceDecideFailures: z.number().int().nonnegative(),
            eliteExclusionFailures: z.number().int().nonnegative(),
            oneOutlierFailures: z.number().int().nonnegative(),
            signedAboveDraftedMedian: z.number().int().nonnegative(),
            signedAboveDraftedMedianShare: z.number().min(0).max(1),
            signingsByBand: z.object({
                contender: z.number().int().nonnegative(),
                playoff: z.number().int().nonnegative(),
                average: z.number().int().nonnegative(),
                weaker: z.number().int().nonnegative(),
            }),
            richGetRicherFailures: z.number().int().nonnegative(),
            determinismProbe: z.object({ probed: z.boolean(), identical: z.boolean() }),
            summaryIdentityProbe: z.object({ probed: z.boolean(), identical: z.boolean() }),
        }),
        heldOut: z.object({
            seasonsSimulated: z.number().int().nonnegative(),
            windowsOpened: z.number().int().nonnegative(),
            windowsComplete: z.number().int().nonnegative(),
            signings: z.number().int().nonnegative(),
            bandCapViolations: z.number().int().nonnegative(),
            signingCapViolations: z.number().int().nonnegative(),
            spendCapViolations: z.number().int().nonnegative(),
            linkFailures: z.number().int().nonnegative(),
            traceAuditFailures: z.number().int().nonnegative(),
            effectsFailures: z.number().int().nonnegative(),
            rosterIllegal: z.number().int().nonnegative(),
            rotationIllegal: z.number().int().nonnegative(),
            influenceDecideFailures: z.number().int().nonnegative(),
            eliteExclusionFailures: z.number().int().nonnegative(),
            oneOutlierFailures: z.number().int().nonnegative(),
            richGetRicherFailures: z.number().int().nonnegative(),
            ownershipRows: z.number().int().nonnegative(),
            determinismProbe: z.object({ probed: z.boolean(), identical: z.boolean() }),
            summaryIdentityProbe: z.object({ probed: z.boolean(), identical: z.boolean() }),
        }),
    }),
    gates: z.object({
        windowsOpened: z.boolean(),
        bandSigningCaps: z.boolean(),
        threeSigningsPerSeason: z.boolean(),
        sixInfluencePerSeason: z.boolean(),
        linkReconciliation: z.boolean(),
        traceAudit: z.boolean(),
        effectsInvariants: z.boolean(),
        rosterLegality: z.boolean(),
        ownershipRows: z.boolean(),
        eliteExclusion: z.boolean(),
        oneOutlierCeiling: z.boolean(),
        noRichGetRicher: z.boolean(),
        influenceTieBreak: z.boolean(),
        determinismProbe: z.boolean(),
        candidateQuality: z.boolean(),
        interestActivity: z.boolean(),
        summaryIdentity: z.boolean(),
        heldOut: z.boolean(),
    }),
    engineVersion: z.string().min(1).max(64),
    gameVersion: z.literal(SEASON_GAME_VERSION),
    gameTargetsVersion: z.literal(SEASON_GAME_TARGETS_VERSION),
    generatedAtIso: z.string().min(1),
});
export type SeasonFreeAgencyTargets = z.infer<typeof seasonFreeAgencyTargetsSchema>;
export function freeAgencyMeasuredOf(facts: SeasonFreeAgencyMeasuredFacts): SeasonFreeAgencyTargets['measured']['calibration'] {
    return {
        seasonsSimulated: facts.seasonsSimulated,
        windowsOpened: facts.windowsOpened,
        windowsComplete: facts.windowsComplete,
        candidateTotal: facts.candidateTotal,
        candidateShortfalls: facts.candidateShortfalls,
        uniqueIdentities: facts.uniqueIdentities,
        canonicalReuse: facts.canonicalReuse,
        declarations: facts.declarations,
        declaredTargets: facts.declaredTargets,
        interestByBand: { ...facts.interestByBand },
        winsByBand: { ...facts.winsByBand },
        interestFranchises: facts.interestFranchises,
        skipFranchises: facts.skipFranchises,
        skipShare: facts.skipShare,
        signings: facts.signings,
        signingFranchises: facts.signingFranchises,
        signingsPerFranchiseMean: facts.signingsPerFranchiseMean,
        signingsPerFranchiseMin: facts.signingsPerFranchiseMin,
        signingsPerFranchiseMax: facts.signingsPerFranchiseMax,
        signingCapReached: facts.signingCapReached,
        bandCapViolations: facts.bandCapViolations,
        signingCapViolations: facts.signingCapViolations,
        spendCapViolations: facts.spendCapViolations,
        influenceCostsMean: facts.influenceCostsMean,
        influenceCostsMin: facts.influenceCostsMin,
        influenceCostsMax: facts.influenceCostsMax,
        rosterSizesMean: facts.rosterSizesMean,
        rosterSizesMin: facts.rosterSizesMin,
        rosterSizesMax: facts.rosterSizesMax,
        ownershipRows: facts.ownershipRows,
        activeLoads: facts.activeLoads,
        activePairs: facts.activePairs,
        effectsFailures: facts.effectsFailures,
        rosterIllegal: facts.rosterIllegal,
        rotationIllegal: facts.rotationIllegal,
        traceAuditFailures: facts.traceAuditFailures,
        linkFailures: facts.linkFailures,
        influenceDecideFailures: facts.influenceDecideFailures,
        eliteExclusionFailures: facts.eliteExclusionFailures,
        oneOutlierFailures: facts.oneOutlierFailures,
        signedAboveDraftedMedian: facts.signedAboveDraftedMedian,
        signedAboveDraftedMedianShare: facts.signedAboveDraftedMedianShare,
        signingsByBand: { ...facts.signingsByBand },
        richGetRicherFailures: facts.richGetRicherFailures,
        determinismProbe: { ...facts.determinismProbe },
        summaryIdentityProbe: { ...facts.summaryIdentityProbe },
    };
}
export interface SeasonFreeAgencyArgs {
    input: string | null;
    'seed-from': string | null;
    'seed-to': string | null;
    workers: string | null;
    out: string | null;
    manifest: string | null;
    validate: string | null;
    format?: string | null;
}
export function validateSeasonFreeAgencyTargets(args: SeasonFreeAgencyArgs, outPath: string): CliReport {
    void args;
    return validateTargetsArtifact({
        outPath,
        schema: seasonFreeAgencyTargetsSchema,
        command: 'season free-agency calibrate --validate',
        extraChecks: () => ({
            details: ['band caps / composition match the frozen 1/2/3/3 and 1/5/3/3 policy'],
            failures: [],
        }),
    });
}
export type SeasonFreeAgencySeasonRunner = (rootSeed: Seed, options: {
    driveFreeAgency: boolean;
    probeWindow: boolean;
}) => SeasonFreeAgencySeasonFacts;
function defaultRunner(manifestPath: string): SeasonFreeAgencySeasonRunner {
    return (rootSeed, options) => simulateSeasonFreeAgencyFacts({
        runPath: null,
        manifestPath,
        profileEra: null,
        rootSeed,
        driveFreeAgency: options.driveFreeAgency,
        probeWindow: options.probeWindow,
    });
}
export function draftedMedianOverallOf(season: SeasonFreeAgencySeasonFacts): number {
    const overalls = season.draftedVersionIds
        .map((playerVersionId) => season.catalog.overallByVersion.get(playerVersionId) ?? 0)
        .sort((a, b) => a - b);
    return medianOf(overalls);
}
export function seasonFreeAgencyCalibrate(args: SeasonFreeAgencyArgs, deps: {
    runSeason?: SeasonFreeAgencySeasonRunner;
} = {}): CliReport {
    const started = Date.now();
    const { from, to } = parseSeedRange(args, SEASON_FREE_AGENCY_CALIBRATION_SEED_COUNT - 1);
    const outPath = args.out ?? DEFAULT_FREE_AGENCY_TARGETS;
    const validateOnly = args.validate !== null;
    if (validateOnly) {
        return validateSeasonFreeAgencyTargets(args, resolve(args.validate ?? outPath));
    }
    const workers = parseWorkers(args, 1);
    const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
    const runSeason = deps.runSeason ?? defaultRunner(manifestPath);
    const calibrationIndices = seedIndexRange(from, to);
    const validationIndices = seedIndexRange(to + 1, to + SEASON_FREE_AGENCY_VALIDATION_SEED_COUNT);
    let calibration: SeasonFreeAgencySeasonFacts[];
    let heldOut: SeasonFreeAgencySeasonFacts[];
    try {
        calibration = calibrationIndices.map((index) => runSeason(seasonCalibrationSeed(index), {
            driveFreeAgency: true,
            probeWindow: index === from,
        }));
        heldOut = validationIndices.map((index) => runSeason(seasonCalibrationSeed(index), {
            driveFreeAgency: true,
            probeWindow: index === to + 1,
        }));
    }
    catch (error) {
        return makeReport('season free-agency calibrate', { seedFrom: from, seedTo: to, workers }, { failures: [`calibration cohort failed: ${(error as Error).message}`], exitCode: 2 });
    }
    const draftedMedian = calibration.length > 0 && calibration[0] !== undefined
        ? draftedMedianOverallOf(calibration[0])
        : 0;
    const calibrationFacts = foldFreeAgencyCohort(calibration, draftedMedian);
    const heldOutFacts = foldFreeAgencyCohort(heldOut, draftedMedian);
    const zeroSigning = calibration.find((season) => season.run.freeAgency.windows.reduce((sum, window) => sum + window.signings.length, 0) === 0);
    let summaryIdentity: {
        probed: boolean;
        identical: boolean;
    } = {
        probed: false,
        identical: true,
    };
    if (zeroSigning !== undefined) {
        const baseline = runSeason(zeroSigning.rootSeed, {
            driveFreeAgency: false,
            probeWindow: false,
        });
        summaryIdentity = {
            probed: true,
            identical: JSON.stringify(baseline.summaries) === JSON.stringify(zeroSigning.summaries),
        };
        calibrationFacts.summaryIdentityProbe = summaryIdentity;
    }
    const metrics = evaluateFreeAgencyGates(calibrationFacts, heldOutFacts, { summaryIdentity });
    const { skippedGates, pass } = gateSummary(metrics);
    const gates = {
        windowsOpened: gateValue(metrics, 'windowsOpened'),
        bandSigningCaps: gateValue(metrics, 'bandSigningCaps'),
        threeSigningsPerSeason: gateValue(metrics, 'threeSigningsPerSeason'),
        sixInfluencePerSeason: gateValue(metrics, 'sixInfluencePerSeason'),
        linkReconciliation: gateValue(metrics, 'linkReconciliation'),
        traceAudit: gateValue(metrics, 'traceAudit'),
        effectsInvariants: gateValue(metrics, 'effectsInvariants'),
        rosterLegality: gateValue(metrics, 'rosterLegality'),
        ownershipRows: gateValue(metrics, 'ownershipRows'),
        eliteExclusion: gateValue(metrics, 'eliteExclusion'),
        oneOutlierCeiling: gateValue(metrics, 'oneOutlierCeiling'),
        noRichGetRicher: gateValue(metrics, 'noRichGetRicher'),
        influenceTieBreak: gateValue(metrics, 'influenceTieBreak'),
        determinismProbe: gateValue(metrics, 'determinismProbe'),
        candidateQuality: gateValue(metrics, 'candidateQuality'),
        interestActivity: gateValue(metrics, 'interestActivity'),
        summaryIdentity: gateValue(metrics, 'summaryIdentity'),
        heldOut: gateValue(metrics, 'heldOut.windowsOpened') &&
            gateValue(metrics, 'heldOut.bandSigningCaps') &&
            gateValue(metrics, 'heldOut.linkReconciliation') &&
            gateValue(metrics, 'heldOut.effectsInvariants') &&
            gateValue(metrics, 'heldOut.rosterLegality') &&
            gateValue(metrics, 'heldOut.traceAudit') &&
            gateValue(metrics, 'heldOut.determinism'),
    };
    let targetsWritten = false;
    let targetsPath: string | null = null;
    const gateFailures: string[] = [];
    if (pass) {
        const targets: SeasonFreeAgencyTargets = {
            schemaVersion: 1,
            targetsVersion: SEASON_FREE_AGENCY_TARGETS_VERSION,
            policy: {
                bandSigningCaps: {
                    contender: 1,
                    playoff: 2,
                    average: 3,
                    weaker: 3,
                },
                maxSigningsPerSeason: SEASON_FREE_AGENCY_MAX_SIGNINGS,
                maxSeasonSpend: SEASON_FREE_AGENCY_MAX_SEASON_SPEND,
                windowComposition: {
                    featured: 1,
                    role: 5,
                    development: 3,
                    emergency: 3,
                },
                maxCandidates: 12,
                minWindowsPerSeason: 3,
                ownershipRows: [SEASON_FREE_AGENCY_OWNERSHIP_MIN, SEASON_FREE_AGENCY_OWNERSHIP_MAX],
                activeEffects: [300, 1350],
                aboveDraftedShareEnvelope: [
                    SEASON_FREE_AGENCY_ABOVE_DRAFTED_MIN,
                    SEASON_FREE_AGENCY_ABOVE_DRAFTED_MAX,
                ],
                skipShareMax: SEASON_FREE_AGENCY_SKIP_SHARE_MAX,
                minSeasons: SEASON_FREE_AGENCY_MIN_SEASONS,
            },
            cohort: { seedFrom: from, seedTo: to },
            heldOut: { seedFrom: to + 1, seedTo: to + SEASON_FREE_AGENCY_VALIDATION_SEED_COUNT },
            measured: {
                calibration: freeAgencyMeasuredOf(calibrationFacts),
                heldOut: {
                    seasonsSimulated: heldOutFacts.seasonsSimulated,
                    windowsOpened: heldOutFacts.windowsOpened,
                    windowsComplete: heldOutFacts.windowsComplete,
                    signings: heldOutFacts.signings,
                    bandCapViolations: heldOutFacts.bandCapViolations,
                    signingCapViolations: heldOutFacts.signingCapViolations,
                    spendCapViolations: heldOutFacts.spendCapViolations,
                    linkFailures: heldOutFacts.linkFailures,
                    traceAuditFailures: heldOutFacts.traceAuditFailures,
                    effectsFailures: heldOutFacts.effectsFailures,
                    rosterIllegal: heldOutFacts.rosterIllegal,
                    rotationIllegal: heldOutFacts.rotationIllegal,
                    influenceDecideFailures: heldOutFacts.influenceDecideFailures,
                    eliteExclusionFailures: heldOutFacts.eliteExclusionFailures,
                    oneOutlierFailures: heldOutFacts.oneOutlierFailures,
                    richGetRicherFailures: heldOutFacts.richGetRicherFailures,
                    ownershipRows: heldOutFacts.ownershipRows,
                    determinismProbe: { ...heldOutFacts.determinismProbe },
                    summaryIdentityProbe: { ...heldOutFacts.summaryIdentityProbe },
                },
            },
            gates,
            engineVersion: createEngineContext().engineVersion,
            gameVersion: SEASON_GAME_VERSION,
            gameTargetsVersion: SEASON_GAME_TARGETS_VERSION,
            generatedAtIso: new Date().toISOString(),
        };
        seasonFreeAgencyTargetsSchema.parse(targets);
        const commit = commitTargetsArtifact({
            outPath,
            defaultTargetsPath: DEFAULT_FREE_AGENCY_TARGETS,
            manifestPath,
            manifestKey: 'freeAgencyTargets',
            manifestUrl: 'season/free-agency-targets.json',
            content: targets,
        });
        targetsWritten = commit.written;
        targetsPath = commit.path;
        if (commit.error !== null)
            gateFailures.push(commit.error);
    }
    const payload = seasonFreeAgencyCalibrateReportSchema.parse({
        schemaVersion: 1,
        command: 'season free-agency calibrate',
        targetsVersion: SEASON_FREE_AGENCY_TARGETS_VERSION,
        calibrationSeeds: calibrationIndices.length,
        validationSeeds: validationIndices.length,
        seasonsSimulated: calibrationFacts.seasonsSimulated + heldOutFacts.seasonsSimulated,
        windowsOpened: calibrationFacts.windowsOpened + heldOutFacts.windowsOpened,
        signings: calibrationFacts.signings + heldOutFacts.signings,
        uniqueIdentities: calibrationFacts.uniqueIdentities,
        canonicalReuse: calibrationFacts.canonicalReuse,
        candidateTotal: calibrationFacts.candidateTotal,
        candidateShortfalls: calibrationFacts.candidateShortfalls,
        declaredTargets: calibrationFacts.declaredTargets,
        signingsByBand: { ...calibrationFacts.signingsByBand },
        interestByBand: { ...calibrationFacts.interestByBand },
        winsByBand: { ...calibrationFacts.winsByBand },
        skipShare: calibrationFacts.skipShare,
        bandCapViolations: calibrationFacts.bandCapViolations,
        signingCapViolations: calibrationFacts.signingCapViolations,
        spendCapViolations: calibrationFacts.spendCapViolations,
        linkFailures: calibrationFacts.linkFailures,
        traceAuditFailures: calibrationFacts.traceAuditFailures,
        effectsFailures: calibrationFacts.effectsFailures,
        influenceDecideFailures: calibrationFacts.influenceDecideFailures,
        eliteExclusionFailures: calibrationFacts.eliteExclusionFailures,
        oneOutlierFailures: calibrationFacts.oneOutlierFailures,
        richGetRicherFailures: calibrationFacts.richGetRicherFailures,
        signedAboveDraftedMedianShare: calibrationFacts.signedAboveDraftedMedianShare,
        determinismProbe: { ...calibrationFacts.determinismProbe },
        summaryIdentityProbe: { ...summaryIdentity },
        gates,
        metrics,
        skippedGates,
        targetsWritten,
        targetsPath,
        durationMs: Date.now() - started,
    });
    const details = [
        `${String(calibration.length)} calibration + ${String(heldOut.length)} held-out seasons in ${String(Date.now() - started)}ms (${String(workers)} workers)`,
        `windows ${String(calibrationFacts.windowsOpened)} · candidates ${String(calibrationFacts.candidateTotal)} (shortfalls ${String(calibrationFacts.candidateShortfalls)}) · unique identities ${String(calibrationFacts.uniqueIdentities)} · canonical reuse ${String(calibrationFacts.canonicalReuse)}`,
        `signings ${String(calibrationFacts.signings)} (${String(calibrationFacts.signingFranchises)} franchises) · declared targets ${String(calibrationFacts.declaredTargets)} · skip share ${(calibrationFacts.skipShare * 100).toFixed(1)}%`,
        `signings by band ${JSON.stringify(calibrationFacts.signingsByBand)} · band-cap violations ${String(calibrationFacts.bandCapViolations)} · spend-cap violations ${String(calibrationFacts.spendCapViolations)}`,
        `link failures ${String(calibrationFacts.linkFailures)} · trace failures ${String(calibrationFacts.traceAuditFailures)} · influence tie-break failures ${String(calibrationFacts.influenceDecideFailures)}`,
        `elite-exclusion failures ${String(calibrationFacts.eliteExclusionFailures)} · one-outlier failures ${String(calibrationFacts.oneOutlierFailures)} · rich-get-richer failures ${String(calibrationFacts.richGetRicherFailures)}`,
        `signed above drafted median ${(calibrationFacts.signedAboveDraftedMedianShare * 100).toFixed(1)}% · ownership rows ${String(calibrationFacts.ownershipRows)}`,
        `determinism probe ${String(calibrationFacts.determinismProbe.identical)} · summary identity probe ${summaryIdentity.probed ? (summaryIdentity.identical ? 'identical' : 'DIVERGED') : 'not probed (no zero-signing season)'}`,
        `targets ${targetsWritten ? `written to ${targetsPath ?? '?'}` : 'NOT written'}`,
    ];
    if (skippedGates.length > 0) {
        gateFailures.push(`gates skipped (insufficient sample): ${skippedGates.join(', ')}`);
    }
    if (!pass) {
        for (const metric of metrics) {
            if (!metric.pass) {
                gateFailures.push(`gate ${metric.key}: observed ${String(metric.observed)} (${metric.status})`);
            }
        }
    }
    if (pass && !targetsWritten)
        gateFailures.push('targets artifact was not written');
    return makeReport('season free-agency calibrate', { seedFrom: from, seedTo: to, workers }, { details, failures: gateFailures, payload });
}
void BANDS;
