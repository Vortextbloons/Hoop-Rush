import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { SEASON_ALMANAC_VERSION, seasonAlmanacSchema } from '@hoop-rush/data-contracts';
import { buildFixtureCheckpointRow, buildFixtureEffectsState, buildFixtureHealthState, buildFixtureRun, buildFixtureSchedule, buildFixtureStoredDraft, buildFixtureSummaries, buildStubSeasonEngineSeam, } from '../testing/season-run-fixture.ts';
import { TestDatabase, resetIndexedDb, restoreIndexedDb, testDatabaseName, } from '../testing/repo-test-support.ts';
import { DexieSeasonRunRepository } from './season-run-dexie.ts';
import { HoopRushDatabase } from './dexie.ts';
import { SEASON_RUN_RECORD_ID } from '../schemas/season-run-record.ts';
import { seasonRunPlayerSliceEntrySchema } from '../schemas/season-run-record.ts';
import type { StoredClassicDraft } from '../schemas/classic-draft-record.ts';
import { classicDraftRecordSchema } from '../schemas/classic-draft-record.ts';
import type { SeasonHealthState, SeasonGameSummary, SeasonRun, SeasonTradeState, } from '@hoop-rush/data-contracts';
import { seasonCommandLogEntrySchema, seasonPostseasonSummarySchema, } from '@hoop-rush/data-contracts';
import { buildClassicDraftState } from '@hoop-rush/test-fixtures';
const DIGEST_32 = '0'.repeat(32);
function makeAdapters() {
    const db = new TestDatabase(testDatabaseName('season-perf'));
    const seam = buildStubSeasonEngineSeam();
    const schedule = buildFixtureSchedule('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
    const run = buildFixtureRun({
        seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
        runId: 'perf-run',
    });
    const repo = new DexieSeasonRunRepository(db, { schedule, seam });
    return { db, seam, schedule, run, repo };
}
function buildClassicDraftRecord(): StoredClassicDraft {
    return classicDraftRecordSchema.parse({
        recordId: 'classic-draft',
        saveSchemaVersion: 1,
        draft: buildClassicDraftState({ draftId: 'classic-draft-1' }),
        updatedAtIso: '2026-01-01T00:00:00.000Z',
    });
}
function blockFactsFor(seam: ReturnType<typeof buildStubSeasonEngineSeam>, run: SeasonRun, schedule: ReturnType<typeof buildFixtureSchedule>, summaries: ReturnType<typeof buildFixtureSummaries>) {
    const played = seam
        .reconstructSeasonGames(schedule, summaries)
        .filter((game) => game.status !== 'scheduled');
    return {
        standings: seam.reduceSeasonStandings(run.league, played),
        teamAggregates: seam.foldSeasonTeamAggregates(run.league, summaries),
        playerAggregates: seam.foldSeasonPlayerAggregates(run.rosters, summaries),
    };
}
describe('Season Run performance pass (dexie v9)', () => {
    beforeEach(() => {
        resetIndexedDb();
    });
    afterEach(() => {
        restoreIndexedDb();
    });
    it('migration v9 clears every Season Run table and preserves Challenge/Classic saves', async () => {
        const legacy = new Dexie('hoop-rush-saves');
        legacy.version(1).stores({ active: 'recordId', completed: 'recordId', history: 'recordId' });
        legacy.version(2).stores({
            active: 'recordId',
            activeGames: '[runId+gameNumber], runId',
            completed: 'recordId',
            history: 'recordId',
        });
        legacy.version(3).stores({ history: 'recordId, completedAtIso' });
        legacy.version(4).stores({ classicDrafts: 'recordId' });
        legacy.version(5).stores({ seasonDrafts: 'recordId' });
        legacy.version(6).stores({
            seasonRuns: 'recordId',
            seasonRunSummaries: '[runId+gameId], runId, blockIndex',
            seasonRunDetails: '[runId+gameId], runId',
            seasonRunBlocks: '[runId+blockIndex], runId',
            seasonRunIndex: 'recordId',
        });
        legacy.version(7).stores({ seasonPendingBlocks: 'runId' });
        legacy.version(8).stores({
            seasonPostseasonSummaries: '[runId+gameId], runId',
            seasonCommandLog: '[runId+ordinal], runId',
            seasonAlmanacs: 'runId',
            seasonCompletedRuns: 'runId',
            seasonCompletedIndex: 'recordId, completedAtIso',
        });
        await legacy.open();
        const { run } = makeAdapters();
        const checkpoint = buildFixtureCheckpointRow(run);
        await legacy.table('seasonRuns').put(checkpoint);
        await legacy.table('seasonRunIndex').put({
            recordId: SEASON_RUN_RECORD_ID,
            index: {
                runId: run.runId,
                rootSeed: run.rootSeed,
                humanFranchiseId: 'lakers',
                completedRounds: 0,
                revision: 0,
                humanWins: 0,
                humanLosses: 0,
                updatedAtIso: '2026-01-01T00:00:00.000Z',
            },
        });
        await legacy.table('seasonRunSummaries').bulkPut([
            {
                runId: run.runId,
                gameId: 's000001',
                blockIndex: 0,
                round: 1,
                summary: {
                    schemaVersion: 1,
                    summaryVersion: 'season-game-summary-v3',
                    gameId: 's000001',
                    round: 1,
                    homeFranchiseId: 'lakers',
                    awayFranchiseId: 'celtics',
                    status: 'final',
                    overtimePeriods: 0,
                    homeScore: 100,
                    awayScore: 90,
                    forfeitLoserFranchiseId: null,
                    homeBox: {
                        franchiseId: 'lakers',
                        points: 100,
                        fieldGoalsMade: 40,
                        fieldGoalsAttempted: 88,
                        threePointersMade: 10,
                        threePointersAttempted: 30,
                        freeThrowsMade: 20,
                        freeThrowsAttempted: 26,
                        offensiveRebounds: 10,
                        defensiveRebounds: 30,
                        assists: 24,
                        steals: 7,
                        blocks: 4,
                        turnovers: 12,
                        fouls: 18,
                        possessions: 96,
                    },
                    awayBox: {
                        franchiseId: 'celtics',
                        points: 90,
                        fieldGoalsMade: 36,
                        fieldGoalsAttempted: 84,
                        threePointersMade: 9,
                        threePointersAttempted: 27,
                        freeThrowsMade: 18,
                        freeThrowsAttempted: 24,
                        offensiveRebounds: 9,
                        defensiveRebounds: 28,
                        assists: 22,
                        steals: 6,
                        blocks: 5,
                        turnovers: 14,
                        fouls: 20,
                        possessions: 95,
                    },
                    homePlayers: [],
                    awayPlayers: [],
                    injuryEvents: [],
                },
                updatedAtIso: '2026-01-01T00:00:00.000Z',
            },
        ]);
        await legacy.table('seasonRunBlocks').put({
            runId: run.runId,
            blockIndex: 0,
            block: {
                runId: run.runId,
                blockIndex: 0,
                completedRounds: 1,
                revision: 1,
                commandId: 'legacy-cmd',
                rotationDigest: DIGEST_32,
                checkpointDigest: DIGEST_32,
                summaryCount: 1,
                stateRevision: 1,
                stateDigest: DIGEST_32,
            },
            updatedAtIso: '2026-01-01T00:00:00.000Z',
        });
        await legacy.table('seasonPendingBlocks').put({
            runId: run.runId,
            block: {
                schemaVersion: 1,
                blockVersion: 'season-block-v3',
                runId: run.runId,
                commandId: 'legacy-pending',
                blockIndex: 1,
                expectedRevision: 1,
                expectedStateRevision: 1,
                expectedStateDigest: DIGEST_32,
                objectiveId: null,
                nextGameId: 's000016',
                summaries: [],
                retainedDetails: [],
                effects: {
                    schemaVersion: 1,
                    playerStates: [],
                    pairStates: [],
                },
                health: buildFixtureHealthState(),
                standings: {
                    schemaVersion: 1,
                    standingsVersion: 'standings-v1',
                    rows: [],
                },
                teamAggregates: [],
                playerAggregates: [],
                rotationDigest: DIGEST_32,
            },
            interruption: {
                code: 'invalid-roster',
                runId: run.runId,
                blockIndex: 1,
                commandId: 'legacy-pending',
                nextGameId: 's000016',
                humanFranchiseId: 'lakers',
                unavailablePlayerVersionIds: ['pv-legacy'],
            },
            updatedAtIso: '2026-01-01T00:00:00.000Z',
        });
        const almanac = seasonAlmanacSchema.parse({
            schemaVersion: 1,
            almanacVersion: SEASON_ALMANAC_VERSION,
            runId: run.runId,
            rootSeed: run.rootSeed,
            championFranchiseId: 'lakers',
            postseasonDigest: DIGEST_32,
            commandLogDigest: DIGEST_32,
            awardsDigest: DIGEST_32,
            tradeGradesDigest: DIGEST_32,
            digest: DIGEST_32,
        });
        await legacy.table('seasonAlmanacs').put({
            runId: run.runId,
            almanac,
            updatedAtIso: '2026-01-01T00:00:00.000Z',
        });
        await legacy.table('seasonCompletedRuns').put({
            runId: run.runId,
            run: buildFixtureCheckpointRow(run).run,
            updatedAtIso: '2026-01-01T00:00:00.000Z',
        });
        await legacy.table('seasonCompletedIndex').put({
            recordId: run.runId,
            runId: run.runId,
            rootSeed: run.rootSeed,
            humanFranchiseId: 'lakers',
            championFranchiseId: 'lakers',
            almanacDigest: DIGEST_32,
            commandLogDigest: DIGEST_32,
            completedAtIso: '2026-01-01T00:00:00.000Z',
        });
        await legacy.table('active').put({
            recordId: 'active',
            saveSchemaVersion: 2,
            runId: 'challenge-run',
            status: 'active',
            firstLossGameNumber: null,
            gamesPlayed: 0,
            updatedAtIso: '2026-01-01T00:00:00.000Z',
        });
        await legacy.table('classicDrafts').put(buildClassicDraftRecord());
        legacy.close();
        const upgraded = new HoopRushDatabase();
        await upgraded.open();
        for (const table of [
            'seasonRuns',
            'seasonRunSummaries',
            'seasonRunDetails',
            'seasonRunBlocks',
            'seasonRunIndex',
            'seasonPendingBlocks',
            'seasonPostseasonSummaries',
            'seasonCommandLog',
            'seasonAlmanacs',
            'seasonCompletedRuns',
            'seasonCompletedIndex',
        ]) {
            expect(await upgraded.table(table).count(), table).toBe(0);
        }
        expect(await upgraded.table('active').count()).toBe(1);
        expect(await upgraded.table('activeGames').count()).toBe(0);
        expect(await upgraded.table('classicDrafts').count()).toBe(1);
        expect(await upgraded.table('completed').count()).toBe(0);
        upgraded.close();
    });
    it('block summary reads use the [runId+blockIndex] index and never see other runs', async () => {
        const { db, repo, seam, schedule, run } = makeAdapters();
        await repo.promoteSeasonDraftToRun(buildFixtureStoredDraft(run), run);
        const summaries = buildFixtureSummaries({
            runId: run.runId,
            schedule,
            rosters: run.rosters,
            fromRound: 1,
            toRound: 10,
        });
        await db.seasonRunSummaries.bulkPut(summaries.map((summary) => ({
            runId: run.runId,
            gameId: summary.gameId,
            blockIndex: 0,
            round: summary.round,
            summary,
            updatedAtIso: '2026-01-01T00:00:00.000Z',
        })));
        await db.seasonRunSummaries.bulkPut(summaries.map((summary) => ({
            runId: 'other-completed-run',
            gameId: `x${summary.gameId}`,
            blockIndex: 0,
            round: summary.round,
            summary,
            updatedAtIso: '2026-01-01T00:00:00.000Z',
        })));
        const facts = blockFactsFor(seam, run, schedule, summaries);
        const rotationDigest = seam.seasonRotationSetDigest(run.rotations);
        const effects = buildFixtureEffectsState(run.rosters);
        await repo.commitSeasonBlock({
            runId: run.runId,
            revision: 1,
            commandId: 'cmd-1',
            rotationDigest,
            checkpointDigest: DIGEST_32,
            completedRounds: 10,
            standings: facts.standings,
            teamAggregates: facts.teamAggregates,
            playerAggregates: facts.playerAggregates,
            summaries,
            retainedDetails: [],
            rotations: run.rotations,
            recap: {
                schemaVersion: 1,
                recapVersion: 'season-recap-v5',
                runId: run.runId,
                blockIndex: 0,
                completedRounds: 10,
                humanRecord: null,
                standingsMovement: [],
                notablePerformances: [],
                streaks: [],
                versionSpotlights: [],
                upcomingHumanGames: [],
                injuryEvidence: {
                    injuries: 0,
                    bySeverity: { minor: 0, moderate: 0, major: 0, 'season-ending': 0 },
                    sameGameReturns: 0,
                    seasonEnding: 0,
                    returnedThisBlock: 0,
                    activeAtBlockEnd: 0,
                    humanTeamInjuries: [],
                },
                objectiveEvidence: null,
                tradeEvidence: { tradesAccepted: 0, influenceDelta: 0 },
                freeAgencyEvidence: {
                    windowIndex: null,
                    signings: [],
                    influenceDelta: 0,
                    seasonSignings: 0,
                    seasonSpend: 0,
                },
                influenceBalance: { humanBalance: 2 },
            },
            effects,
            health: buildFixtureHealthState(),
            transactions: [],
            influence: run.influence,
            trade: null,
            objectives: run.objectives,
            checkpointState: {
                runId: run.runId,
                blockIndex: 0,
                completedRounds: 10,
                revision: 1,
                commandId: 'cmd-1',
                rotationDigest,
                checkpointDigest: DIGEST_32,
            },
            stateRevision: 1,
            stateDigest: DIGEST_32,
            expectedStateRevision: 0,
            expectedStateDigest: run.stateDigest,
            window: null,
            freeAgency: run.freeAgency,
        });
        const rows = await repo.loadBlockSummaries(run.runId, 0);
        expect(rows.map((row) => row.gameId)).toEqual(summaries.map((row) => row.gameId));
        expect(await db.seasonRunSummaries.where('runId').equals('other-completed-run').count()).toBe(150);
        expect(await repo.loadActiveRunWithSchedule(schedule)).not.toBeNull();
    });
    it('commits the trade-window health so the reload digest recomputes (regression)', async () => {
        const { repo, seam, run, schedule } = makeAdapters();
        await repo.promoteSeasonDraftToRun(buildFixtureStoredDraft(run), run);
        const allSummaries = buildFixtureSummaries({
            runId: run.runId,
            schedule,
            rosters: run.rosters,
            fromRound: 1,
            toRound: 30,
        });
        const effects = buildFixtureEffectsState(run.rosters);
        const rotationDigest = seam.seasonRotationSetDigest(run.rotations);
        const windowHealth: SeasonHealthState = {
            schemaVersion: 1,
            healthVersion: 'season-health-v2',
            injuries: [
                {
                    injuryId: 'inj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    playerVersionId: run.rosters[0]?.players[0]?.playerVersionId ?? 'pv-x',
                    franchiseId: run.rosters[0]?.franchiseId ?? 'lakers',
                    gameId: 's000001',
                    type: 'soft-tissue',
                    severity: 'moderate',
                    occurredBeforeHalftime: false,
                    sameGameReturn: false,
                    sameGameReturned: null,
                    missedGamesTotal: 3,
                    missedGamesRemaining: 2,
                    actualReturnRound: null,
                    seasonEnding: false,
                    rehabModifier: 0 as const,
                    recurrenceWindowRoundsRemaining: 0,
                    seedPath: ['window', '0', 'rehab'],
                },
            ],
        };
        const trade: SeasonTradeState = {
            schemaVersion: 1,
            tradeVersion: 'season-trade-v3' as const,
            windows: [
                {
                    windowIndex: 0,
                    blockIndex: 2,
                    status: 'open' as const,
                    offers: [] as SeasonTradeState['windows'][number]['offers'],
                },
            ],
        };
        let priorStateRevision = 0;
        let priorStateDigest = run.stateDigest;
        const priorSummaries: SeasonGameSummary[] = [];
        for (const blockIndex of [0, 1]) {
            const fromRound = blockIndex * 10 + 1;
            const toRound = (blockIndex + 1) * 10;
            const blockSummaries = allSummaries.filter((summary) => summary.round >= fromRound && summary.round <= toRound);
            const facts = blockFactsFor(seam, run, schedule, [...priorSummaries, ...blockSummaries]);
            const checkpointState = {
                runId: run.runId,
                blockIndex,
                completedRounds: toRound,
                revision: blockIndex + 1,
                commandId: `cmd-${String(blockIndex)}`,
                rotationDigest,
                checkpointDigest: DIGEST_32,
            };
            const stateRevision = priorStateRevision + 1;
            const stateDigest = seam.seasonRunStateDigest({
                stateRevision,
                stage: run.stage,
                postseason: run.postseason,
                awards: run.awards,
                completion: run.completion,
                checkpointState,
                health: buildFixtureHealthState(),
                influence: run.influence,
                transactions: [],
                trade: null,
                objectives: run.objectives,
                campaign: run.campaign ?? null,
                rosters: run.rosters,
                ownership: run.ownership,
                rotations: run.rotations,
                effects,
                freeAgency: run.freeAgency,
            });
            await repo.commitSeasonBlock({
                runId: run.runId,
                revision: blockIndex + 1,
                commandId: `cmd-${String(blockIndex)}`,
                rotationDigest,
                checkpointDigest: DIGEST_32,
                completedRounds: toRound,
                standings: facts.standings,
                teamAggregates: facts.teamAggregates,
                playerAggregates: facts.playerAggregates,
                summaries: blockSummaries,
                retainedDetails: [],
                rotations: run.rotations,
                recap: {
                    schemaVersion: 1,
                    recapVersion: 'season-recap-v5',
                    runId: run.runId,
                    blockIndex,
                    completedRounds: toRound,
                    humanRecord: null,
                    standingsMovement: [],
                    notablePerformances: [],
                    streaks: [],
                    versionSpotlights: [],
                    upcomingHumanGames: [],
                    injuryEvidence: {
                        injuries: 0,
                        bySeverity: { minor: 0, moderate: 0, major: 0, 'season-ending': 0 },
                        sameGameReturns: 0,
                        seasonEnding: 0,
                        returnedThisBlock: 0,
                        activeAtBlockEnd: 0,
                        humanTeamInjuries: [],
                    },
                    objectiveEvidence: null,
                    tradeEvidence: { tradesAccepted: 0, influenceDelta: 0 },
                    freeAgencyEvidence: {
                        windowIndex: null,
                        signings: [],
                        influenceDelta: 0,
                        seasonSignings: 0,
                        seasonSpend: 0,
                    },
                    influenceBalance: { humanBalance: 2 },
                },
                effects,
                health: buildFixtureHealthState(),
                transactions: [],
                influence: run.influence,
                trade: null,
                objectives: run.objectives,
                checkpointState,
                stateRevision,
                stateDigest,
                expectedStateRevision: priorStateRevision,
                expectedStateDigest: priorStateDigest,
                window: null,
                freeAgency: run.freeAgency,
            });
            priorStateRevision = stateRevision;
            priorStateDigest = stateDigest;
            priorSummaries.push(...blockSummaries);
        }
        const blockIndex = 2;
        const blockSummaries = allSummaries.filter((summary) => summary.round >= 21 && summary.round <= 30);
        const facts = blockFactsFor(seam, run, schedule, [...priorSummaries, ...blockSummaries]);
        const checkpointState = {
            runId: run.runId,
            blockIndex,
            completedRounds: 30,
            revision: 3,
            commandId: 'cmd-window',
            rotationDigest,
            checkpointDigest: DIGEST_32,
        };
        const stateRevision = priorStateRevision + 1;
        const stateDigest = seam.seasonRunStateDigest({
            stateRevision,
            stage: run.stage,
            postseason: run.postseason,
            awards: run.awards,
            completion: run.completion,
            checkpointState,
            health: windowHealth,
            influence: run.influence,
            transactions: [],
            trade,
            objectives: run.objectives,
            campaign: run.campaign ?? null,
            rosters: run.rosters,
            ownership: run.ownership,
            rotations: run.rotations,
            effects,
            freeAgency: run.freeAgency,
        });
        const window = {
            trade,
            influence: run.influence,
            transactions: [],
            rosters: run.rosters,
            ownership: run.ownership,
            rotations: run.rotations,
            effects,
            health: windowHealth,
            stateRevision,
            stateDigest,
        };
        await repo.commitSeasonBlock({
            runId: run.runId,
            revision: 3,
            commandId: 'cmd-window',
            rotationDigest,
            checkpointDigest: DIGEST_32,
            completedRounds: 30,
            standings: facts.standings,
            teamAggregates: facts.teamAggregates,
            playerAggregates: facts.playerAggregates,
            summaries: blockSummaries,
            retainedDetails: [],
            rotations: run.rotations,
            recap: {
                schemaVersion: 1,
                recapVersion: 'season-recap-v5',
                runId: run.runId,
                blockIndex,
                completedRounds: 30,
                humanRecord: null,
                standingsMovement: [],
                notablePerformances: [],
                streaks: [],
                versionSpotlights: [],
                upcomingHumanGames: [],
                injuryEvidence: {
                    injuries: 0,
                    bySeverity: { minor: 0, moderate: 0, major: 0, 'season-ending': 0 },
                    sameGameReturns: 0,
                    seasonEnding: 0,
                    returnedThisBlock: 0,
                    activeAtBlockEnd: 0,
                    humanTeamInjuries: [],
                },
                objectiveEvidence: null,
                tradeEvidence: { tradesAccepted: 0, influenceDelta: 0 },
                freeAgencyEvidence: {
                    windowIndex: null,
                    signings: [],
                    influenceDelta: 0,
                    seasonSignings: 0,
                    seasonSpend: 0,
                },
                influenceBalance: { humanBalance: 2 },
            },
            effects,
            health: buildFixtureHealthState(),
            transactions: [],
            influence: run.influence,
            trade: null,
            objectives: run.objectives,
            checkpointState,
            stateRevision,
            stateDigest,
            expectedStateRevision: priorStateRevision,
            expectedStateDigest: priorStateDigest,
            window,
            freeAgency: run.freeAgency,
        });
        const snapshot = await repo.loadActiveRunWithSchedule(schedule);
        expect(snapshot).not.toBeNull();
        expect(snapshot?.run.health.injuries.some((injury) => injury.injuryId === 'inj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
        expect(snapshot?.run.trade?.windows[0]?.status).toBe('open');
    });
    it('every teardown path removes every run-scoped row (centralized lifecycle)', async () => {
        const adapters = makeAdapters();
        const { db, repo, run } = adapters;
        await repo.promoteSeasonDraftToRun(buildFixtureStoredDraft(run), run);
        const sliceRow = {
            runId: run.runId,
            players: [
                {
                    playerVersionId: run.rosters[0]?.players[0]?.playerVersionId ?? 'pv-x',
                    playerId: 'p-x',
                    franchiseId: 'lakers',
                    eraId: '1990s',
                    seasonKey: '1995-96',
                    displayName: 'Slice Player',
                    positionsPlayable: ['PG', 'SG'],
                    summaryRatings: { overallRating: 80, offenseRating: 82, defenseRating: 74 },
                    staminaRating: 70,
                    durabilityRating: 70,
                },
            ],
            updatedAtIso: '2026-01-01T00:00:00.000Z',
        };
        await db.seasonRunPlayerSlices.put(sliceRow);
        const commandEntry = seasonCommandLogEntrySchema.parse({
            runId: run.runId,
            ordinal: 0,
            command: {
                schemaVersion: 11,
                command: 'select-block-objective',
                commandId: 'cmd-ps',
                runId: run.runId,
                expectedStateRevision: 0,
                expectedStateDigest: DIGEST_32,
                blockIndex: 0,
                objectiveId: 'win-six',
            },
            preStateRevision: 0,
            preStateDigest: DIGEST_32,
            postStateRevision: 1,
            postStateDigest: DIGEST_32,
            resultDigest: DIGEST_32,
            previousLogDigest: DIGEST_32,
            relatedGameIds: [],
            transactionIds: [],
        });
        await db.seasonCommandLog.put({
            runId: run.runId,
            ordinal: 0,
            entry: commandEntry,
            updatedAtIso: '2026-01-01T00:00:00.000Z',
        });
        const postseasonLines = (franchiseId: string) => {
            const roster = run.rosters.find((entry) => entry.franchiseId === franchiseId) ?? run.rosters[0];
            return (roster?.players ?? []).map((player, index) => ({
                playerVersionId: player.playerVersionId,
                seconds: 1440,
                started: index < 5,
                points: 0,
                fieldGoalsMade: 0,
                fieldGoalsAttempted: 0,
                threePointersMade: 0,
                threePointersAttempted: 0,
                freeThrowsMade: 0,
                freeThrowsAttempted: 0,
                offensiveRebounds: 0,
                defensiveRebounds: 0,
                assists: 0,
                steals: 0,
                blocks: 0,
                turnovers: 0,
                fouls: 0,
            }));
        };
        const postseasonSummary = seasonPostseasonSummarySchema.parse({
            schemaVersion: 1,
            summaryVersion: 'postseason-summary-v1' as const,
            runId: run.runId,
            gameId: 'pi-east-seven-eight',
            phase: 'play-in' as const,
            round: 'seven-eight',
            seriesId: null,
            gameNumber: 1,
            conference: 'east' as const,
            homeFranchiseId: 'lakers',
            awayFranchiseId: 'celtics',
            winnerFranchiseId: 'lakers',
            loserFranchiseId: 'celtics',
            status: 'final' as const,
            homeScore: 100,
            awayScore: 90,
            forfeitLoserFranchiseId: null,
            homeBox: {
                franchiseId: 'lakers',
                points: 100,
                fieldGoalsMade: 40,
                fieldGoalsAttempted: 88,
                threePointersMade: 10,
                threePointersAttempted: 30,
                freeThrowsMade: 20,
                freeThrowsAttempted: 26,
                offensiveRebounds: 10,
                defensiveRebounds: 30,
                assists: 24,
                steals: 7,
                blocks: 4,
                turnovers: 12,
                fouls: 18,
                possessions: 96,
            },
            awayBox: {
                franchiseId: 'celtics',
                points: 90,
                fieldGoalsMade: 36,
                fieldGoalsAttempted: 84,
                threePointersMade: 9,
                threePointersAttempted: 27,
                freeThrowsMade: 18,
                freeThrowsAttempted: 24,
                offensiveRebounds: 9,
                defensiveRebounds: 28,
                assists: 22,
                steals: 6,
                blocks: 5,
                turnovers: 14,
                fouls: 20,
                possessions: 95,
            },
            homePlayers: postseasonLines('lakers'),
            awayPlayers: postseasonLines('celtics'),
            rotationEvidence: {
                home: { playersUsed: 10, substitutions: 5 },
                away: { playersUsed: 10, substitutions: 5 },
            },
            injuryEvents: [],
            resultDigest: DIGEST_32,
        });
        await db.seasonPostseasonSummaries.put({
            runId: run.runId,
            gameId: 'pi-east-seven-eight',
            phase: 'play-in' as const,
            summary: postseasonSummary,
            updatedAtIso: '2026-01-01T00:00:00.000Z',
        });
        const almanac = seasonAlmanacSchema.parse({
            schemaVersion: 1,
            almanacVersion: SEASON_ALMANAC_VERSION,
            runId: run.runId,
            rootSeed: run.rootSeed,
            championFranchiseId: 'lakers',
            postseasonDigest: DIGEST_32,
            commandLogDigest: DIGEST_32,
            awardsDigest: DIGEST_32,
            tradeGradesDigest: DIGEST_32,
            digest: DIGEST_32,
        });
        await db.seasonAlmanacs.put({
            runId: run.runId,
            almanac,
            updatedAtIso: '2026-01-01T00:00:00.000Z',
        });
        await db.seasonCompletedRuns.put({
            runId: run.runId,
            run: buildFixtureCheckpointRow(run).run,
            updatedAtIso: '2026-01-01T00:00:00.000Z',
        });
        await db.seasonCompletedIndex.put({
            recordId: run.runId,
            runId: run.runId,
            rootSeed: run.rootSeed,
            humanFranchiseId: 'lakers',
            championFranchiseId: 'lakers',
            almanacDigest: DIGEST_32,
            commandLogDigest: DIGEST_32,
            completedAtIso: '2026-01-01T00:00:00.000Z',
        });
        const scopedTables = [
            'seasonRunSummaries',
            'seasonRunDetails',
            'seasonRunBlocks',
            'seasonPendingBlocks',
            'seasonPostseasonSummaries',
            'seasonCommandLog',
            'seasonAlmanacs',
            'seasonCompletedRuns',
            'seasonCompletedIndex',
            'seasonRunPlayerSlices',
        ];
        const expectAllEmpty = async () => {
            for (const table of scopedTables) {
                expect(await db.table(table).count(), table).toBe(0);
            }
            expect(await db.seasonRuns.count()).toBe(0);
            expect(await db.seasonRunIndex.count()).toBe(0);
        };
        await repo.clearSeasonRun(run.runId);
        await expectAllEmpty();
        await repo.promoteSeasonDraftToRun(buildFixtureStoredDraft(run), run);
        await db.seasonRunSummaries.put({
            runId: run.runId,
            gameId: 's000002',
            blockIndex: 0,
            round: 1,
            summary: {
                schemaVersion: 1,
                summaryVersion: 'season-game-summary-v3',
                gameId: 's000002',
                round: 1,
                homeFranchiseId: 'lakers',
                awayFranchiseId: 'celtics',
                status: 'final',
                overtimePeriods: 0,
                homeScore: 100,
                awayScore: 90,
                forfeitLoserFranchiseId: null,
                homeBox: {
                    franchiseId: 'lakers',
                    points: 100,
                    fieldGoalsMade: 40,
                    fieldGoalsAttempted: 88,
                    threePointersMade: 10,
                    threePointersAttempted: 30,
                    freeThrowsMade: 20,
                    freeThrowsAttempted: 26,
                    offensiveRebounds: 10,
                    defensiveRebounds: 30,
                    assists: 24,
                    steals: 7,
                    blocks: 4,
                    turnovers: 12,
                    fouls: 18,
                    possessions: 96,
                },
                awayBox: {
                    franchiseId: 'celtics',
                    points: 90,
                    fieldGoalsMade: 36,
                    fieldGoalsAttempted: 84,
                    threePointersMade: 9,
                    threePointersAttempted: 27,
                    freeThrowsMade: 18,
                    freeThrowsAttempted: 24,
                    offensiveRebounds: 9,
                    defensiveRebounds: 28,
                    assists: 22,
                    steals: 6,
                    blocks: 5,
                    turnovers: 14,
                    fouls: 20,
                    possessions: 95,
                },
                homePlayers: [],
                awayPlayers: [],
                injuryEvents: [],
            },
            updatedAtIso: '2026-01-01T00:00:00.000Z',
        });
        await repo.forceClearActiveSeasonRun();
        await expectAllEmpty();
        await repo.promoteSeasonDraftToRun(buildFixtureStoredDraft(run), run);
        await db.seasonRunSummaries.put({
            runId: run.runId,
            gameId: 's000003',
            blockIndex: 0,
            round: 1,
            summary: {
                schemaVersion: 1,
                summaryVersion: 'season-game-summary-v3',
                gameId: 's000003',
                round: 1,
                homeFranchiseId: 'lakers',
                awayFranchiseId: 'celtics',
                status: 'final',
                overtimePeriods: 0,
                homeScore: 100,
                awayScore: 90,
                forfeitLoserFranchiseId: null,
                homeBox: {
                    franchiseId: 'lakers',
                    points: 100,
                    fieldGoalsMade: 40,
                    fieldGoalsAttempted: 88,
                    threePointersMade: 10,
                    threePointersAttempted: 30,
                    freeThrowsMade: 20,
                    freeThrowsAttempted: 26,
                    offensiveRebounds: 10,
                    defensiveRebounds: 30,
                    assists: 24,
                    steals: 7,
                    blocks: 4,
                    turnovers: 12,
                    fouls: 18,
                    possessions: 96,
                },
                awayBox: {
                    franchiseId: 'celtics',
                    points: 90,
                    fieldGoalsMade: 36,
                    fieldGoalsAttempted: 84,
                    threePointersMade: 9,
                    threePointersAttempted: 27,
                    freeThrowsMade: 18,
                    freeThrowsAttempted: 24,
                    offensiveRebounds: 9,
                    defensiveRebounds: 28,
                    assists: 22,
                    steals: 6,
                    blocks: 5,
                    turnovers: 14,
                    fouls: 20,
                    possessions: 95,
                },
                homePlayers: [],
                awayPlayers: [],
                injuryEvents: [],
            },
            updatedAtIso: '2026-01-01T00:00:00.000Z',
        });
        await db.seasonRunPlayerSlices.put({
            runId: run.runId,
            players: [
                {
                    playerVersionId: run.rosters[0]?.players[0]?.playerVersionId ?? 'pv-x',
                    playerId: 'p-x',
                    franchiseId: 'lakers',
                    eraId: '1990s',
                    seasonKey: '1995-96',
                    displayName: 'Slice Player',
                    positionsPlayable: ['PG', 'SG'],
                    summaryRatings: { overallRating: 80, offenseRating: 82, defenseRating: 74 },
                    staminaRating: 70,
                    durabilityRating: 70,
                },
            ],
            updatedAtIso: '2026-01-01T00:00:00.000Z',
        });
        const replacement = buildFixtureRun({
            seed: 'c1b2c3d4e5f60718293a4b5c6d7e8f9c',
            runId: 'perf-run-replacement',
        });
        await repo.promoteSeasonDraftToRun(buildFixtureStoredDraft(replacement), replacement);
        for (const table of scopedTables) {
            expect(await db.table(table).count(), table).toBe(0);
        }
        expect(await db.seasonRuns.count()).toBe(1);
        expect((await db.seasonRuns.get(SEASON_RUN_RECORD_ID))?.run.runId).toBe('perf-run-replacement');
        expect((await repo.loadActiveRunIndex())?.runId).toBe('perf-run-replacement');
    });
    it('writes the compact player slice at promotion and merges upserts', async () => {
        const { repo, run } = makeAdapters();
        const first = run.rosters[0]?.players[0];
        if (first === undefined)
            throw new Error('no fixture player');
        const slice = [
            {
                playerVersionId: first.playerVersionId,
                playerId: first.playerId,
                franchiseId: first.franchiseId,
                eraId: first.eraId,
                seasonKey: first.seasonKey,
                displayName: first.displayName,
                positionsPlayable: ['PG', 'SG'],
                summaryRatings: { overallRating: 80, offenseRating: 82, defenseRating: 74 },
                staminaRating: 70,
                durabilityRating: 72,
            },
        ];
        await repo.promoteSeasonDraftToRun(buildFixtureStoredDraft(run), run, slice);
        expect(await repo.loadSeasonRunPlayerSlice(run.runId)).toEqual(slice);
        const second = run.rosters[1]?.players[0];
        if (second === undefined)
            throw new Error('no fixture player');
        const traded = [
            {
                playerVersionId: second.playerVersionId,
                playerId: second.playerId,
                franchiseId: second.franchiseId,
                eraId: second.eraId,
                seasonKey: second.seasonKey,
                displayName: second.displayName,
                positionsPlayable: ['SF', 'PF'],
                summaryRatings: { overallRating: 75, offenseRating: 70, defenseRating: 80 },
                staminaRating: 68,
                durabilityRating: 70,
            },
        ];
        await repo.upsertSeasonRunPlayerSlice(run.runId, traded);
        const merged = await repo.loadSeasonRunPlayerSlice(run.runId);
        expect(merged).not.toBeNull();
        expect(merged?.map((entry) => entry.playerVersionId).sort()).toEqual([first.playerVersionId, second.playerVersionId].sort());
        expect(merged?.find((entry) => entry.playerVersionId === first.playerVersionId)?.summaryRatings
            .overallRating).toBe(80);
        await expect(repo.upsertSeasonRunPlayerSlice(run.runId, [
            seasonRunPlayerSliceEntrySchema.parse(slice[0]),
        ] as never)).resolves.toBeUndefined();
        await repo.clearSeasonRun(run.runId);
        expect(await repo.loadSeasonRunPlayerSlice(run.runId)).toBeNull();
    });
});
