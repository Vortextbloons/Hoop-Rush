import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEASON_COMMAND_LOG_VERSION, SEASON_EMPTY_COMMAND_LOG_DIGEST, SEASON_GAME_COUNT, commandIdSchema, franchiseIdSchema, idSchema, seasonAlmanacDigest, seasonCommandLogDigest, seasonReplayExportDigest, seasonRunCommandSchema, type SeasonAlmanac, type SeasonCommandLog, type SeasonPostseasonSummary, type SeasonRun, type SeasonRunCommand, } from '@hoop-rush/data-contracts';
import { DexieSeasonRunRepository, SeasonRunLoadError } from './season-run-dexie.ts';
import { SeasonPostseasonIntegrityError, type CommitPostseasonAdvancementInput, } from './season-postseason.ts';
import { SeasonRunCommandDuplicateError, SeasonRunCommandRunMismatchError } from './season-run.ts';
import { TestDatabase, restoreIndexedDb, testDatabaseName } from '../testing/repo-test-support.ts';
import { buildFixtureEffectsState, buildFixtureRetainedDetail, buildFixtureRun, buildFixtureSchedule, buildFixtureStoredDraft, buildFixtureSummaries, buildStubSeasonEngineSeam, seasonRotationSetDigestFixture, } from '../testing/season-run-fixture.ts';
const DIGEST_32 = '0'.repeat(32);
interface Adapters {
    db: TestDatabase;
    repo: DexieSeasonRunRepository;
    schedule: ReturnType<typeof buildFixtureSchedule>;
    run: SeasonRun;
    seam: ReturnType<typeof buildStubSeasonEngineSeam>;
}
function makeAdapters(): Adapters {
    const db = new TestDatabase(testDatabaseName('season-postseason'));
    const seam = buildStubSeasonEngineSeam();
    const schedule = buildFixtureSchedule('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
    const run = buildFixtureRun({ seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a', runId: 'ps-test-run' });
    const repo = new DexieSeasonRunRepository(db, { schedule, seam });
    return { db, repo, schedule, run, seam };
}
async function promote(adapters: Adapters): Promise<void> {
    await adapters.repo.promoteSeasonDraftToRun(buildFixtureStoredDraft(adapters.run), adapters.run);
}
function advancedRun(adapters: Adapters, stage: SeasonRun['stage']): SeasonRun {
    const next: SeasonRun = {
        ...adapters.run,
        stage,
        postseason: {
            ...adapters.run.postseason,
            tiebreakResolutions: [
                {
                    resolutionId: idSchema.parse('tie-resolve-1'),
                    conference: 'east',
                    kind: 'qualification',
                    rule: 'head-to-head',
                    teams: [franchiseIdSchema.parse('lakers'), franchiseIdSchema.parse('celtics')],
                    slots: [7, 8],
                    evidence: [{ label: 'h2h', value: 2 }],
                    drawSeed: null,
                },
            ],
        },
        stateRevision: adapters.run.stateRevision + 1,
        stateDigest: DIGEST_32,
    };
    return { ...next, stateDigest: stateDigestOf(adapters, next) };
}
function stateDigestOf(adapters: Adapters, run: SeasonRun): string {
    const effects = buildFixtureEffectsState(run.rosters);
    return adapters.seam.seasonRunStateDigest({
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
        objectives: run.objectives,
        campaign: run.campaign ?? null,
        rosters: run.rosters,
        ownership: run.ownership,
        rotations: run.rotations,
        effects,
        freeAgency: run.freeAgency,
        authority: run.authority,
    });
}
function completedPostseasonOf(adapters: Adapters, champion: string) {
    const parsedChampion = franchiseIdSchema.parse(champion);
    const east = adapters.run.league.teams
        .filter((team) => team.conference === 'east')
        .map((team) => team.franchiseId)
        .slice(0, 8);
    const west = adapters.run.league.teams
        .filter((team) => team.conference === 'west')
        .map((team) => team.franchiseId)
        .slice(0, 8);
    if (east.length !== 8 || west.length !== 8)
        throw new Error('fixture league conferences');
    const pending = (seriesId: string, round: 'first-round' | 'conference-semifinal' | 'conference-final' | 'finals', conference: 'east' | 'west') => ({
        seriesId: idSchema.parse(seriesId),
        round,
        conference,
        higherSeed: null,
        lowerSeed: null,
        homeCourtFranchiseId: null,
        challengerFranchiseId: null,
        homeCourtWins: 0,
        challengerWins: 0,
        games: [],
        winnerFranchiseId: null,
    });
    const conferenceBracket = (conference: 'east' | 'west', seeds: ReturnType<typeof franchiseIdSchema.parse>[]) => ({
        conference,
        seeds,
        firstRound: [1, 2, 3, 4].map((n) => pending(`${conference}-first-round-${String(n)}`, 'first-round', conference)),
        semifinals: [1, 2].map((n) => pending(`${conference}-semifinal-${String(n)}`, 'conference-semifinal', conference)),
        conferenceFinal: pending(`${conference}-conference-final`, 'conference-final', conference),
    });
    const homeIsEast = east.includes(parsedChampion);
    const challengerRaw = homeIsEast ? west[0] : east[0];
    if (challengerRaw === undefined)
        throw new Error('missing challenger seed');
    const challenger = challengerRaw;
    const game = (gameNumber: number, atChallenger: boolean, winner: string) => {
        const parsedWinner = franchiseIdSchema.parse(winner);
        return {
            gameId: `po-finals-g${String(gameNumber)}`,
            gameNumber,
            homeFranchiseId: atChallenger ? challenger : parsedChampion,
            awayFranchiseId: atChallenger ? parsedChampion : challenger,
            status: 'final' as const,
            homeScore: 100,
            awayScore: 90,
            winnerFranchiseId: parsedWinner,
        };
    };
    return {
        ...adapters.run.postseason,
        playIn: {
            east: { ...adapters.run.postseason.playIn.east, playoffSeeds: east },
            west: { ...adapters.run.postseason.playIn.west, playoffSeeds: west },
        },
        bracket: {
            schemaVersion: 1 as const,
            postseasonVersion: 'postseason-v2' as const,
            east: conferenceBracket('east', east),
            west: conferenceBracket('west', west),
            finals: {
                seriesId: idSchema.parse('finals'),
                round: 'finals' as const,
                conference: null,
                higherSeed: null,
                lowerSeed: null,
                homeCourtFranchiseId: parsedChampion,
                challengerFranchiseId: challenger,
                homeCourtWins: 4,
                challengerWins: 2,
                games: [
                    game(1, false, champion),
                    game(2, false, champion),
                    game(3, true, champion),
                    game(4, true, challenger),
                    game(5, false, champion),
                    game(6, true, champion),
                ],
                winnerFranchiseId: parsedChampion,
            },
            championFranchiseId: parsedChampion,
        },
        championFranchiseId: parsedChampion,
    };
}
function completedRunOf(adapters: Adapters, stateRevision: number): SeasonRun {
    const parsedChampion = adapters.run.rosters[0]?.franchiseId ?? franchiseIdSchema.parse('lakers');
    const base: SeasonRun = {
        ...adapters.run,
        stage: 'completed',
        postseason: completedPostseasonOf(adapters, parsedChampion),
        completion: {
            championFranchiseId: parsedChampion,
            almanacDigest: 'a'.repeat(32),
            finalizedAtStateRevision: stateRevision,
        },
        stateRevision,
        stateDigest: '0'.repeat(32),
    };
    return { ...base, stateDigest: stateDigestOf(adapters, base) };
}
function buildAlmanac(run: SeasonRun, champion: string, commandLogDigestValue: string): SeasonAlmanac {
    const parsedChampion = franchiseIdSchema.parse(champion);
    const base = {
        schemaVersion: 1 as const,
        almanacVersion: 'almanac-v1' as const,
        runId: run.runId,
        rootSeed: run.rootSeed,
        championFranchiseId: parsedChampion,
        postseasonDigest: 'd'.repeat(32),
        commandLogDigest: commandLogDigestValue,
        awardsDigest: 'e'.repeat(32),
        tradeGradesDigest: 'f'.repeat(32),
        digest: DIGEST_32,
    };
    return { ...base, digest: seasonAlmanacDigest(base) };
}
function commandOf(run: SeasonRun, command: Extract<SeasonRunCommand, {
    command: string;
}>['command'], commandId: string): SeasonRunCommand {
    return seasonRunCommandSchema.parse({
        schemaVersion: 13,
        command,
        commandId: commandIdSchema.parse(commandId),
        runId: run.runId,
        expectedStateRevision: run.stateRevision,
        expectedStateDigest: run.stateDigest,
    });
}
function basePostseasonSummary(adapters: Adapters): SeasonPostseasonSummary {
    const players = adapters.run.rosters[0]?.players.slice(0, 10).map((player) => ({
        playerVersionId: player.playerVersionId,
        seconds: 1800,
        points: 10,
        fieldGoalsMade: 4,
        fieldGoalsAttempted: 9,
        threePointersMade: 1,
        threePointersAttempted: 3,
        freeThrowsMade: 1,
        freeThrowsAttempted: 1,
        offensiveRebounds: 1,
        defensiveRebounds: 3,
        assists: 3,
        steals: 1,
        blocks: 0,
        turnovers: 1,
        fouls: 2,
    }));
    if (players === undefined)
        throw new Error('no fixture players');
    const homeFallback = adapters.run.rosters[0]?.franchiseId ?? franchiseIdSchema.parse('lakers');
    const awayFallback = adapters.run.rosters[1]?.franchiseId ?? franchiseIdSchema.parse('celtics');
    const box = (franchiseId: string) => ({
        franchiseId: franchiseIdSchema.parse(franchiseId),
        points: 100,
        fieldGoalsMade: 40,
        fieldGoalsAttempted: 90,
        threePointersMade: 10,
        threePointersAttempted: 30,
        freeThrowsMade: 10,
        freeThrowsAttempted: 12,
        offensiveRebounds: 10,
        defensiveRebounds: 30,
        assists: 25,
        steals: 8,
        blocks: 5,
        turnovers: 12,
        fouls: 18,
        possessions: 100,
    });
    return {
        schemaVersion: 1,
        summaryVersion: 'postseason-summary-v1',
        runId: adapters.run.runId,
        gameId: 'pi-east-seven-eight',
        phase: 'play-in',
        round: 'seven-eight',
        seriesId: null,
        gameNumber: 1,
        conference: 'east',
        homeFranchiseId: homeFallback,
        awayFranchiseId: awayFallback,
        winnerFranchiseId: homeFallback,
        loserFranchiseId: awayFallback,
        status: 'final',
        homeScore: 104,
        awayScore: 99,
        forfeitLoserFranchiseId: null,
        homeBox: box(homeFallback),
        awayBox: box(awayFallback),
        homePlayers: players,
        awayPlayers: players,
        rotationEvidence: {
            home: { playersUsed: 10, substitutions: 24 },
            away: { playersUsed: 10, substitutions: 22 },
        },
        injuryEvents: [],
        resultDigest: 'a'.repeat(32),
    };
}
function completionOf(finalRun: SeasonRun): NonNullable<SeasonRun['completion']> {
    const completion = finalRun.completion;
    if (completion === null) {
        throw new Error('a completed run must carry completion state');
    }
    return completion;
}
function finalRunWithAlmanac(finalRun: SeasonRun, almanacDigest: string): SeasonRun {
    return { ...finalRun, completion: { ...completionOf(finalRun), almanacDigest } };
}
function advancementInput(adapters: Adapters, command: SeasonRunCommand, summary: SeasonPostseasonSummary, next: SeasonRun): CommitPostseasonAdvancementInput {
    return {
        runId: adapters.run.runId,
        run: next,
        summaries: [summary],
        command,
        preStateRevision: command.expectedStateRevision,
        preStateDigest: command.expectedStateDigest,
        resultDigest: 'b'.repeat(32),
        relatedGameIds: [summary.gameId],
        transactionIds: [],
    };
}
async function advanceN(adapters: Adapters, count: number, summary: SeasonPostseasonSummary = basePostseasonSummary(adapters), firstOrdinal = 0): Promise<void> {
    for (let index = 0; index < count; index += 1) {
        const ordinal = firstOrdinal + index;
        const command = commandOf(adapters.run, ordinal === 0 ? 'start-postseason' : 'advance-postseason', `cmd-${String(ordinal + 1)}`);
        const next = advancedRun(adapters, index === 0 ? 'play-in' : 'playoffs');
        await adapters.repo.commitPostseasonAdvancement(advancementInput(adapters, command, summary, next));
        adapters.run = next;
    }
}
async function storeRegularSeasonRows(adapters: Adapters): Promise<number> {
    const regularSummaries = buildFixtureSummaries({
        runId: adapters.run.runId,
        schedule: adapters.schedule,
        rosters: adapters.run.rosters,
        fromRound: 1,
        toRound: 2,
    });
    await adapters.db.seasonRunSummaries.bulkPut(regularSummaries.map((summary) => ({
        runId: adapters.run.runId,
        gameId: summary.gameId,
        blockIndex: 0,
        round: summary.round,
        summary,
    })));
    const first = regularSummaries[0];
    if (first === undefined)
        throw new Error('no fixture regular summaries');
    const detail = buildFixtureRetainedDetail({
        runId: adapters.run.runId,
        summary: first,
        rosters: adapters.run.rosters,
    });
    await adapters.db.seasonRunDetails.put({
        runId: adapters.run.runId,
        gameId: detail.gameId,
        round: detail.round,
        detail,
    });
    await adapters.db.seasonRunBlocks.put({
        runId: adapters.run.runId,
        blockIndex: 0,
        block: {
            runId: adapters.run.runId,
            blockIndex: 0,
            completedRounds: 2,
            revision: 1,
            commandId: 'block-cmd-0',
            rotationDigest: seasonRotationSetDigestFixture(adapters.run.rotations),
            checkpointDigest: DIGEST_32,
            summaryCount: regularSummaries.length,
            stateRevision: 0,
            stateDigest: adapters.run.stateDigest,
        },
    });
    return regularSummaries.length;
}
describe('season postseason repository contract extension (M2.6)', () => {
    afterEach(() => {
        restoreIndexedDb();
        vi.restoreAllMocks();
    });
    it('records N advancements as N dense command-log entries with a chained digest stable across reloads', async () => {
        const adapters = makeAdapters();
        await promote(adapters);
        await advanceN(adapters, 3);
        const log = await adapters.repo.loadCommandLog(adapters.run.runId);
        expect(log).not.toBeNull();
        const entries = log?.entries ?? [];
        expect(entries).toHaveLength(3);
        expect(entries.map((entry) => entry.ordinal)).toEqual([0, 1, 2]);
        expect(entries[0]?.previousLogDigest).toBe(SEASON_EMPTY_COMMAND_LOG_DIGEST);
        for (let ordinal = 1; ordinal < entries.length; ordinal += 1) {
            expect(entries[ordinal]?.previousLogDigest).toBe(seasonCommandLogDigest(entries.slice(0, ordinal)));
        }
        expect(seasonCommandLogDigest(entries)).toBe(seasonCommandLogDigest((await adapters.repo.loadCommandLog(adapters.run.runId))?.entries ?? []));
    });
    it('rejects repeated command ids so a duplicate ordinal cannot be appended through the interface', async () => {
        const adapters = makeAdapters();
        await promote(adapters);
        await advanceN(adapters, 3);
        const before = await adapters.repo.loadCommandLog(adapters.run.runId);
        const replay = commandOf(adapters.run, 'start-postseason', 'cmd-1');
        await expect(adapters.repo.commitPostseasonAdvancement(advancementInput(adapters, replay, basePostseasonSummary(adapters), adapters.run))).rejects.toBeInstanceOf(SeasonRunCommandDuplicateError);
        const after = await adapters.repo.loadCommandLog(adapters.run.runId);
        expect(after?.entries).toHaveLength(3);
        expect(after?.entries.map((entry) => entry.ordinal)).toEqual([0, 1, 2]);
        expect(seasonCommandLogDigest(after?.entries ?? [])).toBe(seasonCommandLogDigest(before?.entries ?? []));
        const snapshot = await adapters.repo.loadActiveRun();
        expect(snapshot?.run.stateRevision).toBe(3);
    });
    it('surfaces a corrupt command-log row (row ordinal disagrees with the entry ordinal) as SeasonRunLoadError', async () => {
        const adapters = makeAdapters();
        await promote(adapters);
        await advanceN(adapters, 1);
        const row = await adapters.db.seasonCommandLog.get([adapters.run.runId, 0]);
        if (row === undefined)
            throw new Error('expected a command log row');
        await adapters.db.seasonCommandLog.put({ ...row, ordinal: 5 });
        await expect(adapters.repo.loadCommandLog(adapters.run.runId)).rejects.toBeInstanceOf(SeasonRunLoadError);
    });
    it('surfaces corrupt postseason summary rows as SeasonRunLoadError from both loaders', async () => {
        const adapters = makeAdapters();
        await promote(adapters);
        await advanceN(adapters, 1);
        const corrupted = { ...basePostseasonSummary(adapters), gameId: 'pi-east-nine-ten' };
        await adapters.db.seasonPostseasonSummaries.put({
            runId: adapters.run.runId,
            gameId: 'pi-east-seven-eight',
            phase: corrupted.phase,
            summary: corrupted,
        });
        await expect(adapters.repo.loadPostseasonSummaries(adapters.run.runId)).rejects.toBeInstanceOf(SeasonRunLoadError);
        await expect(adapters.repo.loadPostseasonSummary(adapters.run.runId, 'pi-east-seven-eight')).rejects.toBeInstanceOf(SeasonRunLoadError);
    });
    it('rejects an advancement whose summary names a different run without writing anything', async () => {
        const adapters = makeAdapters();
        await promote(adapters);
        const command = commandOf(adapters.run, 'start-postseason', 'cmd-wrong-run');
        const next = advancedRun(adapters, 'play-in');
        const foreign = { ...basePostseasonSummary(adapters), runId: 'other-run' };
        await expect(adapters.repo.commitPostseasonAdvancement(advancementInput(adapters, command, foreign, next))).rejects.toBeInstanceOf(SeasonRunCommandRunMismatchError);
        expect(await adapters.repo.loadCommandLog(adapters.run.runId)).toBeNull();
        expect(await adapters.repo.loadPostseasonSummaries(adapters.run.runId)).toEqual([]);
        const snapshot = await adapters.repo.loadActiveRun();
        expect(snapshot?.run.stage).toBe('regular-season');
    });
    it('assembles the full validated completed view and nulls before promotion and after deletion', async () => {
        const adapters = makeAdapters();
        await promote(adapters);
        await advanceN(adapters, 1);
        expect(await adapters.repo.loadCompletedSeason(adapters.run.runId)).toBeNull();
        const regularSummaryCount = await storeRegularSeasonRows(adapters);
        const champion = adapters.run.rosters[0]?.franchiseId ?? 'lakers';
        const finalRun = completedRunOf(adapters, adapters.run.stateRevision + 1);
        const log = await adapters.repo.loadCommandLog(adapters.run.runId);
        if (log === null)
            throw new Error('expected a command log');
        const almanac = buildAlmanac(adapters.run, champion, seasonCommandLogDigest(log.entries));
        await adapters.repo.promoteChampionToCompleted({
            runId: adapters.run.runId,
            run: finalRunWithAlmanac(finalRun, almanac.digest),
            almanac,
            commandLog: log,
            postseasonSummaries: await adapters.repo.loadPostseasonSummaries(adapters.run.runId),
        });
        const completedSeason = await adapters.repo.loadCompletedSeason(adapters.run.runId);
        expect(completedSeason).not.toBeNull();
        expect(completedSeason?.run.games).toHaveLength(SEASON_GAME_COUNT);
        expect(completedSeason?.run.games.filter((game) => game.status === 'final')).toHaveLength(regularSummaryCount);
        expect(completedSeason?.run.games.filter((game) => game.status === 'scheduled')).toHaveLength(SEASON_GAME_COUNT - regularSummaryCount);
        expect(completedSeason?.run.stage).toBe('completed');
        expect(completedSeason?.almanac.runId).toBe(adapters.run.runId);
        expect(completedSeason?.almanac.commandLogDigest).toBe(seasonCommandLogDigest(completedSeason?.commandLog.entries ?? []));
        expect(completedSeason?.commandLog.entries).toHaveLength(1);
        expect(completedSeason?.summaries).toHaveLength(regularSummaryCount);
        expect(completedSeason?.postseasonSummaries).toHaveLength(1);
        await adapters.repo.deleteCompletedSeason(adapters.run.runId);
        expect(await adapters.repo.loadCompletedSeason(adapters.run.runId)).toBeNull();
        expect(await adapters.db.seasonPostseasonSummaries.where('runId').equals(adapters.run.runId).count()).toBe(0);
        expect(await adapters.db.seasonCommandLog.where('runId').equals(adapters.run.runId).count()).toBe(0);
        expect(await adapters.db.seasonAlmanacs.get(adapters.run.runId)).toBeUndefined();
        expect(await adapters.db.seasonCompletedRuns.get(adapters.run.runId)).toBeUndefined();
        expect(await adapters.db.seasonCompletedIndex.get(adapters.run.runId)).toBeUndefined();
        expect(await adapters.db.seasonRunSummaries.where('runId').equals(adapters.run.runId).count()).toBe(0);
        expect(await adapters.db.seasonRunDetails.where('runId').equals(adapters.run.runId).count()).toBe(0);
        expect(await adapters.db.seasonRunBlocks.where('runId').equals(adapters.run.runId).count()).toBe(0);
    });
    it('rejects a promotion whose run completion almanac digest does not match the almanac', async () => {
        const adapters = makeAdapters();
        await promote(adapters);
        await advanceN(adapters, 1);
        const champion = adapters.run.rosters[0]?.franchiseId ?? 'lakers';
        const finalRun = completedRunOf(adapters, adapters.run.stateRevision + 1);
        const log = await adapters.repo.loadCommandLog(adapters.run.runId);
        if (log === null)
            throw new Error('expected a command log');
        const almanac = buildAlmanac(adapters.run, champion, seasonCommandLogDigest(log.entries));
        const foreignCompletion = {
            ...completionOf(finalRun),
            almanacDigest: 'f'.repeat(32),
        };
        await expect(adapters.repo.promoteChampionToCompleted({
            runId: adapters.run.runId,
            run: { ...finalRun, completion: foreignCompletion },
            almanac,
            commandLog: log,
            postseasonSummaries: await adapters.repo.loadPostseasonSummaries(adapters.run.runId),
        })).rejects.toBeInstanceOf(SeasonPostseasonIntegrityError);
        expect(await adapters.db.seasonCompletedRuns.count()).toBe(0);
        expect(await adapters.db.seasonAlmanacs.count()).toBe(0);
        expect(await adapters.repo.loadActiveRun()).not.toBeNull();
        expect(await adapters.repo.loadCommandLog(adapters.run.runId)).not.toBeNull();
    });
    it('finalizes the command log to the provided entries, overwriting stored rows at the same ordinals', async () => {
        const adapters = makeAdapters();
        await promote(adapters);
        await advanceN(adapters, 1);
        const champion = adapters.run.rosters[0]?.franchiseId ?? 'lakers';
        const finalRun = completedRunOf(adapters, adapters.run.stateRevision + 1);
        const storedLog = await adapters.repo.loadCommandLog(adapters.run.runId);
        if (storedLog === null)
            throw new Error('expected a command log');
        const storedEntry = storedLog.entries[0];
        if (storedEntry === undefined)
            throw new Error('expected a log entry');
        const rewritten = {
            ...storedEntry,
            command: { ...storedEntry.command, commandId: commandIdSchema.parse('cmd-rewritten-0') },
        };
        const providedLog: SeasonCommandLog = {
            schemaVersion: 1,
            commandLogVersion: SEASON_COMMAND_LOG_VERSION,
            runId: adapters.run.runId,
            entries: [rewritten],
        };
        const almanac = buildAlmanac(adapters.run, champion, seasonCommandLogDigest(providedLog.entries));
        await adapters.repo.promoteChampionToCompleted({
            runId: adapters.run.runId,
            run: finalRunWithAlmanac(finalRun, almanac.digest),
            almanac,
            commandLog: providedLog,
            postseasonSummaries: await adapters.repo.loadPostseasonSummaries(adapters.run.runId),
        });
        expect((await adapters.repo.loadCommandLog(adapters.run.runId))?.entries).toEqual([rewritten]);
        const completedSeason = await adapters.repo.loadCompletedSeason(adapters.run.runId);
        expect(completedSeason?.commandLog.entries).toEqual([rewritten]);
        expect(completedSeason?.almanac.commandLogDigest).toBe(seasonCommandLogDigest(completedSeason?.commandLog.entries ?? []));
    });
    it('builds byte-identical replay exports with a digest that reconciles with the export facts', async () => {
        const adapters = makeAdapters();
        await promote(adapters);
        await advanceN(adapters, 1);
        const first = await adapters.repo.buildReplayExport(adapters.run.runId, 'pi-east-seven-eight');
        const second = await adapters.repo.buildReplayExport(adapters.run.runId, 'pi-east-seven-eight');
        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
        expect(first?.digest).toBe(second?.digest);
        expect(first?.digest).toBe(seasonReplayExportDigest(first as NonNullable<typeof first>));
        expect(first?.gameId).toBe('pi-east-seven-eight');
    });
    it('changes the replay export digest when the summary facts change and returns null for the wrong run', async () => {
        const adapters = makeAdapters();
        await promote(adapters);
        await advanceN(adapters, 1);
        const before = await adapters.repo.buildReplayExport(adapters.run.runId, 'pi-east-seven-eight');
        expect(before).not.toBeNull();
        const changed = { ...basePostseasonSummary(adapters), homeScore: 121, awayScore: 88 };
        await advanceN(adapters, 1, changed, 1);
        const after = await adapters.repo.buildReplayExport(adapters.run.runId, 'pi-east-seven-eight');
        expect(after).not.toBeNull();
        expect(after?.summary.homeScore).toBe(121);
        expect(after?.digest).not.toBe(before?.digest);
        expect(after?.digest).toBe(seasonReplayExportDigest(after as NonNullable<typeof after>));
        expect(await adapters.repo.buildReplayExport('other-run', 'pi-east-seven-eight')).toBeNull();
    });
});
