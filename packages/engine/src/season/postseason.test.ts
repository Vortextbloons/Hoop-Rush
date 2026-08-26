import { describe, expect, it } from 'vitest';
import { SEASON_ENDING_MISSED_GAMES_SENTINEL, buildInitialPostseasonState, playoffGameIdOf, playInGameIdOf, seasonNamespaceSeed, seasonPostseasonSummarySchema, seasonRunSchema, type SeasonDraftCatalog, type SeasonEffectsState, type SeasonGamePlayerInput, type SeasonGameSimulationInput, type SeasonGameSimulationResult, type SeasonGameSideResult, type SeasonLeague, type SeasonPostseasonState, type SeasonPostseasonSummary, type SeasonRotation, type SeasonRun, type SeasonRunCommand, type SeasonStandings, type Position, } from '@hoop-rush/data-contracts';
import { buildEraSimulationProfile } from '@hoop-rush/test-fixtures';
import { createRng } from '../sim/rng.ts';
import { expandSeasonRunRosters } from './block.ts';
import { seasonPlayerAvailable } from './injuries.ts';
import { POSTSEASON_ALMANAC_DIGEST_PLACEHOLDER, decideSeasonFinalsHomeCourt, rollPostseasonRehabOutcome, seasonPostseasonApplyGameResult, seasonPostseasonGameOrdinal, seasonPostseasonGameTeamsOf, seasonPostseasonHumanEliminated, seasonPostseasonNextGame, seasonPostseasonSetRankings, seasonPostseasonStageOf, seasonPostseasonSummaryFromGame, seasonPostseasonUpcomingGames, simulateSeasonPostseasonGame, zeroSeasonGameTransition, type SeasonPostseasonGameFacts, type SeasonPostseasonGameResolver, } from './postseason.ts';
import { matchStartingFive } from './rotation.ts';
import { handleSeasonRunCommand, type SeasonRunCommandContext } from './season-commands.ts';
import { buildEconomyTestRun, zeroEffectsOf } from './season-economy-test-support.ts';
const HUMAN = 'lakers';
const TEST_SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
function fixture(seed = TEST_SEED): {
    run: SeasonRun;
    catalog: SeasonDraftCatalog;
    effects: SeasonEffectsState;
    profile: ReturnType<typeof buildEraSimulationProfile>;
    expanded: ReadonlyMap<string, SeasonGamePlayerInput>;
} {
    const { run, catalog } = buildEconomyTestRun({ seed });
    const effects = zeroEffectsOf(run);
    return {
        run,
        catalog,
        effects,
        profile: buildEraSimulationProfile(),
        expanded: expandSeasonRunRosters(run, catalog),
    };
}
function rankedEast(league: SeasonLeague): string[] {
    return league.teams
        .filter((team) => team.conference === 'east')
        .map((team) => team.franchiseId)
        .slice(0, 10);
}
function rankedWestWithHuman(league: SeasonLeague, human = HUMAN): string[] {
    const west = league.teams
        .filter((team) => team.conference === 'west')
        .map((team) => team.franchiseId);
    const withoutHuman = west.filter((id) => id !== human);
    return [...withoutHuman.slice(0, 6), human, ...withoutHuman.slice(6, 9)];
}
function rankedWestWithout(league: SeasonLeague, excluded: string): string[] {
    return league.teams
        .filter((team) => team.conference === 'west')
        .map((team) => team.franchiseId)
        .filter((id) => id !== excluded)
        .slice(0, 10);
}
function rankedWest(league: SeasonLeague): string[] {
    return league.teams.filter((team) => team.conference === 'west').map((team) => team.franchiseId);
}
function westTopTen(league: SeasonLeague): string[] {
    return rankedWest(league).slice(0, 10);
}
function rankedState(league: SeasonLeague, seed = TEST_SEED): SeasonPostseasonState {
    return seasonPostseasonSetRankings(buildInitialPostseasonState(seed), league, {
        east: rankedEast(league),
        west: rankedWestWithHuman(league),
    });
}
function finalFacts(gameId: string, winner: string, loser: string, homeFranchiseId: string): SeasonPostseasonGameFacts {
    const homeWon = winner === homeFranchiseId;
    return {
        gameId,
        status: 'final',
        winnerFranchiseId: winner,
        loserFranchiseId: loser,
        homeScore: homeWon ? 110 : 100,
        awayScore: homeWon ? 100 : 110,
    };
}
function forfeitFacts(gameId: string, winner: string, loser: string): SeasonPostseasonGameFacts {
    return {
        gameId,
        status: 'forfeit',
        winnerFranchiseId: winner,
        loserFranchiseId: loser,
        homeScore: null,
        awayScore: null,
    };
}
function playTournament(state: SeasonPostseasonState, league: SeasonLeague, standings: SeasonStandings, policy: (input: {
    home: string;
    away: string;
    gameId: string;
}) => 'home' | 'away'): SeasonPostseasonState {
    return driveUntil(state, league, standings, policy, (current) => {
        const decision = seasonPostseasonNextGame(current);
        return decision.kind === 'complete' || decision.kind === 'integrity-failure';
    });
}
function driveUntil(state: SeasonPostseasonState, league: SeasonLeague, standings: SeasonStandings, policy: (input: {
    home: string;
    away: string;
    gameId: string;
}) => 'home' | 'away', stop: (state: SeasonPostseasonState) => boolean): SeasonPostseasonState {
    let current = state;
    for (;;) {
        if (stop(current))
            return current;
        const decision = seasonPostseasonNextGame(current);
        if (decision.kind === 'integrity-failure')
            throw new Error(decision.reason);
        if (decision.kind === 'complete')
            return current;
        const teams = seasonPostseasonGameTeamsOf(current, decision.gameId);
        if (teams === null)
            throw new Error(`${decision.gameId} is not scheduleable`);
        const winnerSide = policy({ home: teams.home, away: teams.away, gameId: decision.gameId });
        const homeWon = winnerSide === 'home';
        const winner = homeWon ? teams.home : teams.away;
        const loser = homeWon ? teams.away : teams.home;
        current = seasonPostseasonApplyGameResult(current, finalFacts(decision.gameId, winner, loser, teams.home), league, standings);
    }
}
function homeWins(): 'home' {
    return 'home';
}
function humanAlwaysWins({ home, away }: {
    home: string;
    away: string;
}): 'home' | 'away' {
    if (home === HUMAN)
        return 'home';
    if (away === HUMAN)
        return 'away';
    return 'home';
}
function humanLosesEarly({ home, away }: {
    home: string;
    away: string;
}): 'home' | 'away' {
    if (home === HUMAN)
        return 'away';
    if (away === HUMAN)
        return 'home';
    return 'home';
}
function seriesOfBracket(state: SeasonPostseasonState, seriesId: string): NonNullable<SeasonPostseasonState['bracket']>['east']['firstRound'][number] {
    const bracket = state.bracket;
    if (bracket === null)
        throw new Error('no bracket');
    const series = [
        ...bracket.east.firstRound,
        ...bracket.east.semifinals,
        bracket.east.conferenceFinal,
        ...bracket.west.firstRound,
        ...bracket.west.semifinals,
        bracket.west.conferenceFinal,
        bracket.finals,
    ].find((entry) => entry.seriesId === seriesId);
    if (series === undefined)
        throw new Error(`unknown series ${seriesId}`);
    return series;
}
function standingsWith(run: SeasonRun, records: Record<string, {
    wins: number;
    losses: number;
    pf?: number;
    pa?: number;
    h2h?: Record<string, [
        number,
        number
    ]>;
}>): SeasonStandings {
    const rows = run.standings.rows.map((row) => {
        const record = records[row.franchiseId];
        if (record === undefined)
            return row;
        return {
            ...row,
            wins: record.wins,
            losses: record.losses,
            gamesPlayed: record.wins + record.losses,
            homeWins: record.wins,
            homeLosses: 0,
            awayWins: 0,
            awayLosses: record.losses,
            conferenceWins: record.wins,
            conferenceLosses: record.losses,
            divisionWins: 0,
            divisionLosses: 0,
            pointsFor: record.pf ?? 0,
            pointsAgainst: record.pa ?? 0,
            headToHead: row.headToHead.map((entry) => {
                const h2h = record.h2h?.[entry.franchiseId];
                return h2h === undefined
                    ? entry
                    : { franchiseId: entry.franchiseId, wins: h2h[0], losses: h2h[1] };
            }),
        };
    });
    return { ...run.standings, rows };
}
function expectValidRun(run: SeasonRun): void {
    const parsed = seasonRunSchema.safeParse(run);
    if (!parsed.success) {
        throw new Error(`run fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
    }
}
function seasonEndingInjuries(run: SeasonRun, franchiseId: string, count: number, prefix: string): SeasonRun['health']['injuries'] {
    const roster = run.rosters.find((entry) => entry.franchiseId === franchiseId);
    if (roster === undefined)
        throw new Error(`no roster for ${franchiseId}`);
    return roster.players.slice(0, count).map((player, index) => ({
        injuryId: `inj-${(prefix + String(index)).padStart(32, '0')}`,
        playerVersionId: player.playerVersionId,
        franchiseId,
        gameId: 's000001',
        type: 'lower-body' as const,
        severity: 'season-ending' as const,
        occurredBeforeHalftime: true,
        sameGameReturn: false,
        sameGameReturned: null,
        missedGamesTotal: SEASON_ENDING_MISSED_GAMES_SENTINEL,
        missedGamesRemaining: SEASON_ENDING_MISSED_GAMES_SENTINEL,
        actualReturnRound: null,
        seasonEnding: true,
        rehabModifier: 0,
        recurrenceWindowRoundsRemaining: 0,
        seedPath: ['injuries', 's000001', player.playerVersionId, 'occurrence'],
    }));
}
function repairedRotation(run: SeasonRun, franchiseId: string, catalog: SeasonDraftCatalog): SeasonRotation {
    const roster = run.rosters.find((entry) => entry.franchiseId === franchiseId);
    if (roster === undefined)
        throw new Error(`no roster for ${franchiseId}`);
    const playableOf = new Map<string, readonly Position[]>();
    for (const player of roster.players) {
        const candidate = catalog.candidates.find((entry) => entry.playerVersionId === player.playerVersionId);
        playableOf.set(player.playerVersionId, candidate?.positions.playable ?? []);
    }
    const members = roster.players.map((player) => ({
        playerVersionId: player.playerVersionId,
        playable: playableOf.get(player.playerVersionId) ?? [],
    }));
    const available = members.filter((member) => seasonPlayerAvailable(run.health, member.playerVersionId));
    const starters = matchStartingFive(available);
    if (starters === null)
        throw new Error(`no legal five available for ${franchiseId}`);
    const starterIds = new Set(starters.map((starter) => starter.playerVersionId));
    const benchAvailable = available.filter((member) => !starterIds.has(member.playerVersionId));
    const benchInjured = members.filter((member) => !starterIds.has(member.playerVersionId) && !available.includes(member));
    const benchOrder = [...benchAvailable, ...benchInjured].map((member) => member.playerVersionId);
    const plan = new Map<string, number>();
    for (const starter of starters)
        plan.set(starter.playerVersionId, 32);
    for (const member of benchAvailable)
        plan.set(member.playerVersionId, 16);
    for (const member of benchInjured)
        plan.set(member.playerVersionId, 0);
    const capacity = (id: string): number => 48 - (plan.get(id) ?? 0);
    let total = [...plan.values()].reduce((sum, value) => sum + value, 0);
    const orderedIds = [...plan.keys()].sort();
    for (;;) {
        if (total >= 240)
            break;
        const candidate = orderedIds.find((id) => capacity(id) > 0);
        if (candidate === undefined)
            throw new Error(`cannot fill 240 minutes for ${franchiseId}`);
        plan.set(candidate, (plan.get(candidate) ?? 0) + 1);
        total += 1;
    }
    const targetMinutes = roster.players.map((player) => ({
        playerVersionId: player.playerVersionId,
        minutes: plan.get(player.playerVersionId) ?? 0,
    }));
    if (targetMinutes.reduce((sum, entry) => sum + entry.minutes, 0) !== 240) {
        throw new Error('repaired rotation minutes do not total 240');
    }
    return {
        franchiseId,
        starters: starters.map((starter) => starter.playerVersionId),
        benchOrder,
        targetMinutes,
        closingFive: starters.map((starter) => starter.playerVersionId),
        minutePolicy: { policyVersion: 'minute-policy-v1', strategy: 'balanced' },
        rotationVersion: 'season-rotation-v3',
    };
}
type SeasonRunCommandFragment = {
    [K in SeasonRunCommand['command']]: Omit<Extract<SeasonRunCommand, {
        command: K;
    }>, 'schemaVersion' | 'runId' | 'expectedStateRevision' | 'expectedStateDigest'>;
}[SeasonRunCommand['command']];
function commandOf(run: SeasonRun, fragment: SeasonRunCommandFragment): SeasonRunCommand {
    return {
        schemaVersion: 11,
        runId: run.runId,
        expectedStateRevision: run.stateRevision,
        expectedStateDigest: run.stateDigest,
        ...fragment,
    };
}
function postseasonContext(seed = TEST_SEED, resolver?: SeasonPostseasonGameResolver): SeasonRunCommandContext & {
    run: SeasonRun;
    catalog: SeasonDraftCatalog;
    profile: ReturnType<typeof buildEraSimulationProfile>;
} {
    const { run: base, catalog } = buildEconomyTestRun({ seed });
    const run: SeasonRun = {
        ...base,
        cursor: { schemaVersion: 1, completedRounds: 82 },
    };
    return {
        run,
        pending: null,
        humanFranchiseId: HUMAN,
        catalog,
        effects: zeroEffectsOf(run),
        profile: buildEraSimulationProfile(),
        rankings: ({ league }) => ({
            east: rankedEast(league),
            west: rankedWestWithHuman(league),
        }),
        postseasonGameResolver: resolver,
    };
}
function playThroughCommands(context: SeasonRunCommandContext & {
    catalog: SeasonDraftCatalog;
}): {
    run: SeasonRun;
    summaries: SeasonPostseasonSummary[];
} {
    let ctx = context;
    const allSummaries: SeasonPostseasonSummary[] = [];
    const start = handleSeasonRunCommand(commandOf(ctx.run, { command: 'start-postseason', commandId: 'start-1' }), ctx);
    if (start.result.result.status !== 'accepted') {
        throw new Error('start-postseason rejected');
    }
    ctx = { ...ctx, run: start.run };
    for (let index = 1; index < 400; index += 1) {
        const advance = handleSeasonRunCommand(commandOf(ctx.run, { command: 'advance-postseason', commandId: `adv-${String(index)}` }), ctx);
        const advanceOutput = advance.result;
        if (advanceOutput.command !== 'advance-postseason')
            throw new Error('unexpected command');
        const result = advanceOutput.result;
        if (result.status === 'rejected') {
            throw new Error(`advance rejected: ${result.rejection.code}`);
        }
        ctx = { ...ctx, run: advance.run };
        allSummaries.push(...(advance.postseasonSummaries ?? []));
        if (result.nextDecision === 'rotation' && result.nextGameId !== null) {
            const rotation = repairedRotation(ctx.run, HUMAN, ctx.catalog);
            const submit = handleSeasonRunCommand(commandOf(ctx.run, {
                command: 'submit-postseason-rotation',
                commandId: `sub-${String(index)}`,
                targetGameId: result.nextGameId,
                rotation: { franchiseId: HUMAN, rotation },
            }), ctx);
            const submitOutput = submit.result;
            if (submitOutput.command !== 'submit-postseason-rotation') {
                throw new Error('unexpected command');
            }
            if (submitOutput.result.status === 'rejected') {
                throw new Error(`submit rejected: ${submitOutput.result.rejection.code}`);
            }
            ctx = { ...ctx, run: submit.run };
            continue;
        }
        if (result.stage === 'completed') {
            return { run: ctx.run, summaries: allSummaries };
        }
    }
    throw new Error('the postseason did not complete');
}
function forcedCompletedResult(gameInput: SeasonGameSimulationInput, homeScore: number, awayScore: number, pregameEffects: SeasonEffectsState): {
    result: SeasonGameSimulationResult;
    transition: ReturnType<typeof zeroSeasonGameTransition>;
} {
    const homeWon = homeScore > awayScore;
    const sideOf = (side: 'home' | 'away', score: number): SeasonGameSideResult => {
        const team = side === 'home' ? gameInput.home : gameInput.away;
        const fgm = Math.floor(score / 2);
        const ftm = score % 2;
        const playerOf = (player: SeasonGamePlayerInput, index: number) => ({
            playerVersionId: player.playerVersionId,
            playerId: player.playerId,
            seconds: 1440,
            minutes: 24,
            points: index === 0 ? score : 0,
            fieldGoals: { made: index === 0 ? fgm : 0, attempted: index === 0 ? fgm : 0 },
            threes: { made: 0, attempted: 0 },
            freeThrows: { made: index === 0 ? ftm : 0, attempted: index === 0 ? ftm : 0 },
            rebounds: { total: 0, offensive: 0, defensive: 0 },
            assists: 0,
            steals: 0,
            blocks: 0,
            turnovers: 0,
            fouls: 0,
            diagnostics: {
                usage: 0,
                shotZones: [],
                assistOpportunities: 0,
                offensiveReboundChances: 0,
                defensiveReboundChances: 0,
                contestedShots: 0,
            },
        });
        return {
            teamId: team.teamId,
            displayName: team.displayName,
            franchiseId: team.franchiseId,
            score,
            periodScores: [score],
            box: {
                points: score,
                fieldGoals: { made: fgm, attempted: fgm },
                threes: { made: 0, attempted: 0 },
                freeThrows: { made: ftm, attempted: ftm },
                rebounds: { total: 0, offensive: 0, defensive: 0, team: 0 },
                assists: 0,
                steals: 0,
                blocks: 0,
                turnovers: 0,
                fouls: 0,
                possessions: 60,
                diagnostics: {
                    assistedFieldGoals: 0,
                    unassistedFieldGoals: fgm,
                    reboundOpportunities: 0,
                    contestedShots: 0,
                },
            },
            players: team.players.map((player, index) => playerOf(player, index)),
            shotZones: [],
            returns: [],
        };
    };
    return {
        result: {
            schemaVersion: 1,
            outcome: 'completed',
            seed: gameInput.seed,
            gameNumber: gameInput.gameNumber,
            dataVersion: gameInput.dataVersion,
            engineVersion: 'engine-v1',
            profileVersion: gameInput.profile.profileVersion,
            winner: homeWon ? 'home' : 'away',
            overtimePeriods: 0,
            home: sideOf('home', homeScore),
            away: sideOf('away', awayScore),
            substitutions: [],
            unitStints: [],
            deviations: [],
            foulOuts: [],
            removals: [],
        },
        transition: zeroSeasonGameTransition(pregameEffects),
    };
}
function forcedResolver(plan: (input: {
    gameId: string;
    home: string;
    away: string;
}) => 'home' | 'away'): SeasonPostseasonGameResolver {
    return ({ gameId, gameInput, pregameEffects }) => {
        const winnerSide = plan({
            gameId,
            home: gameInput.home.franchiseId,
            away: gameInput.away.franchiseId,
        });
        return forcedCompletedResult(gameInput, winnerSide === 'home' ? 110 : 90, winnerSide === 'home' ? 90 : 110, pregameEffects);
    };
}
describe('play-in machine', () => {
    it('derives the matchups from the ranking and resolves seeds 7 and 8', () => {
        const { run } = fixture();
        const state = rankedState(run.league);
        const east = state.playIn.east;
        const ranking = east.ranking ?? [];
        expect(seasonPostseasonGameTeamsOf(state, 'pi-east-seven-eight')).toEqual({
            home: ranking[6],
            away: ranking[7],
        });
        expect(seasonPostseasonGameTeamsOf(state, 'pi-east-nine-ten')).toEqual({
            home: ranking[8],
            away: ranking[9],
        });
        expect(seasonPostseasonGameTeamsOf(state, 'pi-east-final')).toBeNull();
        expect(seasonPostseasonUpcomingGames(state)).not.toContain('pi-east-final');
        let after = seasonPostseasonApplyGameResult(state, finalFacts('pi-east-seven-eight', ranking[6] ?? '', ranking[7] ?? '', ranking[6] ?? ''), run.league, run.standings);
        after = seasonPostseasonApplyGameResult(after, finalFacts('pi-east-nine-ten', ranking[9] ?? '', ranking[8] ?? '', ranking[8] ?? ''), run.league, run.standings);
        expect(seasonPostseasonGameTeamsOf(after, 'pi-east-final')).toEqual({
            home: ranking[7],
            away: ranking[9],
        });
        after = seasonPostseasonApplyGameResult(after, finalFacts('pi-east-final', ranking[7] ?? '', ranking[9] ?? '', ranking[7] ?? ''), run.league, run.standings);
        expect(after.playIn.east.playoffSeeds).toEqual([
            ...ranking.slice(0, 6),
            ranking[6],
            ranking[7],
        ]);
    });
    it('produces the correct seeds 7/8 for every winner combination', () => {
        const { run } = fixture();
        const state = rankedState(run.league);
        const ranking = state.playIn.east.ranking ?? [];
        const sevenTop = ranking[6] ?? '';
        const sevenBottom = ranking[7] ?? '';
        const nineTop = ranking[8] ?? '';
        const nineBottom = ranking[9] ?? '';
        for (const sevenEightWinner of [sevenTop, sevenBottom]) {
            for (const nineTenWinner of [nineTop, nineBottom]) {
                const sevenLoser = sevenEightWinner === sevenTop ? sevenBottom : sevenTop;
                const nineLoser = nineTenWinner === nineTop ? nineBottom : nineTop;
                const finalHome = sevenLoser;
                const finalAway = nineTenWinner;
                let next = seasonPostseasonApplyGameResult(state, finalFacts('pi-east-seven-eight', sevenEightWinner, sevenLoser, sevenTop), run.league, run.standings);
                next = seasonPostseasonApplyGameResult(next, finalFacts('pi-east-nine-ten', nineTenWinner, nineLoser, nineTop), run.league, run.standings);
                next = seasonPostseasonApplyGameResult(next, finalFacts('pi-east-final', finalHome, finalAway, finalHome), run.league, run.standings);
                expect(next.playIn.east.playoffSeeds).toEqual([
                    ...ranking.slice(0, 6),
                    sevenEightWinner,
                    finalHome,
                ]);
            }
        }
    });
    it('advances forfeited play-in games through the same seed rules (official 2-0)', () => {
        const { run } = fixture();
        const state = rankedState(run.league);
        const ranking = state.playIn.east.ranking ?? [];
        const sevenTop = ranking[6] ?? '';
        const sevenBottom = ranking[7] ?? '';
        const nineTop = ranking[8] ?? '';
        const nineBottom = ranking[9] ?? '';
        let next = seasonPostseasonApplyGameResult(state, forfeitFacts('pi-east-seven-eight', sevenTop, sevenBottom), run.league, run.standings);
        next = seasonPostseasonApplyGameResult(next, forfeitFacts('pi-east-nine-ten', nineBottom, nineTop), run.league, run.standings);
        expect(seasonPostseasonGameTeamsOf(next, 'pi-east-final')).toEqual({
            home: sevenBottom,
            away: nineBottom,
        });
        next = seasonPostseasonApplyGameResult(next, forfeitFacts('pi-east-final', sevenBottom, nineBottom), run.league, run.standings);
        expect(next.playIn.east.playoffSeeds).toEqual([...ranking.slice(0, 6), sevenTop, sevenBottom]);
    });
    it('resolves the games one at a time in canonical conference order', () => {
        const { run } = fixture();
        const state = rankedState(run.league);
        expect(seasonPostseasonNextGame(state)).toEqual({
            kind: 'game',
            gameId: 'pi-east-seven-eight',
        });
        let next = state;
        for (const gameId of [
            'pi-east-seven-eight',
            'pi-east-nine-ten',
            'pi-east-final',
            'pi-west-seven-eight',
            'pi-west-nine-ten',
            'pi-west-final',
        ]) {
            expect(seasonPostseasonNextGame(next)).toEqual({ kind: 'game', gameId });
            const teams = seasonPostseasonGameTeamsOf(next, gameId);
            if (teams === null)
                throw new Error(`${gameId} not scheduleable`);
            next = seasonPostseasonApplyGameResult(next, finalFacts(gameId, teams.home, teams.away, teams.home), run.league, run.standings);
        }
        expect(next.bracket).not.toBeNull();
        expect(seasonPostseasonNextGame(next)).toEqual({
            kind: 'game',
            gameId: playoffGameIdOf('east-first-round-1', 1),
        });
        expect(seasonPostseasonStageOf(next)).toBe('playoffs');
    });
    it('keeps the rankings free of tiebreak resolutions', () => {
        const { run } = fixture();
        const state = rankedState(run.league);
        expect(state.tiebreakResolutions).toEqual([]);
    });
});
describe('playoff bracket machine', () => {
    function bracketState(stop: (state: SeasonPostseasonState) => boolean): {
        state: SeasonPostseasonState;
        league: SeasonLeague;
        standings: SeasonStandings;
        eastSeeds: string[];
    } {
        const { run } = fixture();
        const state = rankedState(run.league);
        const completed = driveUntil(state, run.league, run.standings, homeWins, stop);
        return {
            state: completed,
            league: run.league,
            standings: run.standings,
            eastSeeds: completed.playIn.east.playoffSeeds ?? [],
        };
    }
    const atPlayoffStart = (state: SeasonPostseasonState): boolean => {
        const decision = seasonPostseasonNextGame(state);
        return state.bracket !== null && decision.kind === 'game' && decision.gameId.startsWith('po-');
    };
    const atEastConferenceFinal = (state: SeasonPostseasonState): boolean => {
        const decision = seasonPostseasonNextGame(state);
        return decision.kind === 'game' && decision.gameId.startsWith('east-conference-final');
    };
    it('pairs the first round 1-8, 4-5, 3-6, 2-7 with the higher seed at home', () => {
        const { state, eastSeeds } = bracketState(atPlayoffStart);
        const bracket = state.bracket;
        if (bracket === null)
            throw new Error('no bracket');
        const expected = [
            [0, 7],
            [3, 4],
            [2, 5],
            [1, 6],
        ];
        bracket.east.firstRound.forEach((series, index) => {
            const pair = expected[index];
            const higher = pair?.[0] ?? 0;
            const lower = pair?.[1] ?? 0;
            expect(series.homeCourtFranchiseId).toBe(eastSeeds[higher]);
            expect(series.challengerFranchiseId).toBe(eastSeeds[lower]);
            expect(series.higherSeed).toBe(higher + 1);
            expect(series.lowerSeed).toBe(lower + 1);
            expect(series.winnerFranchiseId).toBeNull();
        });
    });
    it('never creates a series before both feeders complete', () => {
        const { run } = fixture();
        const state = bracketState(atPlayoffStart).state;
        const series = seriesOfBracket(state, 'east-first-round-1');
        const homeCourt = series.homeCourtFranchiseId ?? '';
        const challenger = series.challengerFranchiseId ?? '';
        let next = state;
        for (let gameNumber = 1; gameNumber <= 4; gameNumber += 1) {
            const teams = seasonPostseasonGameTeamsOf(next, playoffGameIdOf('east-first-round-1', gameNumber));
            if (teams === null)
                throw new Error('not scheduleable');
            next = seasonPostseasonApplyGameResult(next, finalFacts(playoffGameIdOf('east-first-round-1', gameNumber), homeCourt, challenger, teams.home), run.league, run.standings);
        }
        const semifinal = next.bracket?.east.semifinals[0];
        expect(semifinal?.challengerFranchiseId).toBeNull();
        expect(semifinal?.games.length ?? 0).toBe(0);
        expect(seasonPostseasonNextGame(next)).toEqual({
            kind: 'game',
            gameId: playoffGameIdOf('east-first-round-2', 1),
        });
    });
    it('pairs the semifinals and conference final with the higher remaining seed at home', () => {
        const { state, eastSeeds } = bracketState(atEastConferenceFinal);
        const semifinal = seriesOfBracket(state, 'east-semifinal-1');
        expect(semifinal.homeCourtFranchiseId).toBe(eastSeeds[0]);
        expect(semifinal.challengerFranchiseId).toBe(eastSeeds[3]);
        const semifinalTwo = seriesOfBracket(state, 'east-semifinal-2');
        expect(semifinalTwo.homeCourtFranchiseId).toBe(eastSeeds[1]);
        expect(semifinalTwo.challengerFranchiseId).toBe(eastSeeds[2]);
        const conferenceFinal = seriesOfBracket(state, 'east-conference-final');
        expect(conferenceFinal.homeCourtFranchiseId).toBe(eastSeeds[0]);
        expect(conferenceFinal.challengerFranchiseId).toBe(eastSeeds[1]);
    });
    it('never reseeds: the fixed bracket slots keep their winners', () => {
        const { run } = fixture();
        const { state, eastSeeds } = bracketState(atPlayoffStart);
        const seeds = eastSeeds;
        const upsetPolicy = ({ home, gameId }: {
            home: string;
            gameId: string;
        }): 'home' | 'away' => {
            if (gameId.startsWith('po-east-first-round-1')) {
                return home === seeds[0] ? 'away' : 'home';
            }
            return 'home';
        };
        const played = playTournament(state, run.league, run.standings, upsetPolicy);
        const semifinalOne = seriesOfBracket(played, 'east-semifinal-1');
        expect(semifinalOne.homeCourtFranchiseId).toBe(seeds[3]);
        expect(semifinalOne.challengerFranchiseId).toBe(seeds[7]);
        const conferenceFinal = seriesOfBracket(played, 'east-conference-final');
        expect(conferenceFinal.homeCourtFranchiseId).toBe(seeds[1]);
        expect(conferenceFinal.challengerFranchiseId).toBe(seeds[3]);
    });
    it('ends a series immediately at four wins for every legal length', () => {
        const { state, league, standings } = bracketState(atPlayoffStart);
        const series = seriesOfBracket(state, 'east-first-round-1');
        const homeCourt = series.homeCourtFranchiseId ?? '';
        const challenger = series.challengerFranchiseId ?? '';
        for (const challengerWins of [0, 1, 2, 3]) {
            let next = state;
            let challengerWinsSoFar = 0;
            for (let gameNumber = 1; gameNumber <= 4 + challengerWins; gameNumber += 1) {
                const teams = seasonPostseasonGameTeamsOf(next, playoffGameIdOf('east-first-round-1', gameNumber));
                if (teams === null)
                    throw new Error('not scheduleable');
                const challengerHomeGame = [3, 4, 6].includes(gameNumber);
                const challengerWinsGame = challengerHomeGame && challengerWinsSoFar < challengerWins;
                if (challengerWinsGame)
                    challengerWinsSoFar += 1;
                const winner = challengerWinsGame ? challenger : homeCourt;
                const loser = winner === homeCourt ? challenger : homeCourt;
                next = seasonPostseasonApplyGameResult(next, finalFacts(playoffGameIdOf('east-first-round-1', gameNumber), winner, loser, teams.home), league, standings);
            }
            const finished = seriesOfBracket(next, 'east-first-round-1');
            expect(finished.games.length).toBe(4 + challengerWins);
            expect(finished.homeCourtWins + finished.challengerWins).toBe(finished.games.length);
            expect(finished.homeCourtWins === 4 || finished.challengerWins === 4).toBe(true);
            expect(finished.winnerFranchiseId).not.toBeNull();
            const nextGame = seasonPostseasonNextGame(next);
            if (nextGame.kind === 'game') {
                expect(nextGame.gameId.startsWith('east-first-round-1')).toBe(false);
            }
        }
    });
    it('follows the 2-2-1-1-1 home pattern in every game', () => {
        const { state } = bracketState(() => false);
        const bracket = state.bracket;
        if (bracket === null)
            throw new Error('no bracket');
        const allSeries = [
            ...bracket.east.firstRound,
            ...bracket.east.semifinals,
            bracket.east.conferenceFinal,
            ...bracket.west.firstRound,
            ...bracket.west.semifinals,
            bracket.west.conferenceFinal,
            bracket.finals,
        ];
        expect(allSeries.length).toBe(15);
        for (const series of allSeries) {
            if (series.homeCourtFranchiseId === null || series.challengerFranchiseId === null)
                continue;
            const homeCourt = series.homeCourtFranchiseId;
            const challenger = series.challengerFranchiseId;
            series.games.forEach((game) => {
                const homeSide = [1, 2, 5, 7].includes(game.gameNumber) ? homeCourt : challenger;
                expect(game.homeFranchiseId).toBe(homeSide);
                expect(game.awayFranchiseId).toBe(homeSide === homeCourt ? challenger : homeCourt);
            });
        }
    });
    it('pairs the Finals only after both conference finals and applies the home-court decision', () => {
        const { run } = fixture();
        const state = rankedState(run.league);
        const beforeWestFinal = driveUntil(state, run.league, run.standings, homeWins, (current) => {
            const decision = seasonPostseasonNextGame(current);
            return decision.kind === 'game' && decision.gameId.startsWith('po-west-conference-final');
        });
        const eastChamp = beforeWestFinal.bracket?.east.conferenceFinal.winnerFranchiseId;
        expect(eastChamp).not.toBeNull();
        expect(beforeWestFinal.bracket?.finals.challengerFranchiseId).toBeNull();
        expect(seasonPostseasonNextGame(beforeWestFinal)).toEqual({
            kind: 'game',
            gameId: playoffGameIdOf('west-conference-final', 1),
        });
        const westChamp = beforeWestFinal.bracket?.west.conferenceFinal.homeCourtFranchiseId ?? '';
        let next = beforeWestFinal;
        for (let gameNumber = 1; gameNumber <= 4; gameNumber += 1) {
            const teams = seasonPostseasonGameTeamsOf(next, playoffGameIdOf('west-conference-final', gameNumber));
            if (teams === null)
                throw new Error('not scheduleable');
            next = seasonPostseasonApplyGameResult(next, finalFacts(playoffGameIdOf('west-conference-final', gameNumber), westChamp, teams.away, teams.home), run.league, run.standings);
        }
        const finals = next.bracket?.finals;
        expect(finals?.homeCourtFranchiseId).not.toBeNull();
        expect(finals?.challengerFranchiseId).not.toBeNull();
        expect(finals?.higherSeed).toBeNull();
        expect(finals?.lowerSeed).toBeNull();
        expect(finals?.conference).toBeNull();
        const resolution = next.tiebreakResolutions.at(-1);
        expect(resolution?.kind).toBe('finals-home-court');
        expect(resolution?.slots).toEqual([1]);
    });
    it('decides the Finals home court by overall record, head-to-head, differential, then draw', () => {
        const { run } = fixture();
        const league = run.league;
        const east = rankedEast(league)[0] ?? '';
        const west = westTopTen(league)[0] ?? '';
        const drawSeed = buildInitialPostseasonState(TEST_SEED).finalsHomeCourtDrawSeed;
        let decision = decideSeasonFinalsHomeCourt({
            league,
            standings: standingsWith(run, {
                [east]: { wins: 57, losses: 25 },
                [west]: { wins: 55, losses: 27 },
            }),
            eastChampionFranchiseId: east,
            westChampionFranchiseId: west,
            drawSeed,
        });
        expect(decision.homeCourtFranchiseId).toBe(east);
        expect(decision.resolution.rule).toBe('overall-record');
        expect(decision.resolution.kind).toBe('finals-home-court');
        expect(decision.resolution.slots).toEqual([1]);
        expect(decision.resolution.teams).toEqual([east, west]);
        expect(decision.resolution.drawSeed).toBeNull();
        decision = decideSeasonFinalsHomeCourt({
            league,
            standings: standingsWith(run, {
                [east]: { wins: 56, losses: 26, h2h: { [west]: [2, 1] } },
                [west]: { wins: 56, losses: 26, h2h: { [east]: [1, 2] } },
            }),
            eastChampionFranchiseId: east,
            westChampionFranchiseId: west,
            drawSeed,
        });
        expect(decision.homeCourtFranchiseId).toBe(east);
        expect(decision.resolution.rule).toBe('head-to-head');
        expect(decision.resolution.evidence[0]?.value).toBe('2-1');
        decision = decideSeasonFinalsHomeCourt({
            league,
            standings: standingsWith(run, {
                [east]: { wins: 56, losses: 26, pf: 9000, pa: 8700, h2h: { [west]: [1, 1] } },
                [west]: { wins: 56, losses: 26, pf: 8800, pa: 8600, h2h: { [east]: [1, 1] } },
            }),
            eastChampionFranchiseId: east,
            westChampionFranchiseId: west,
            drawSeed,
        });
        expect(decision.homeCourtFranchiseId).toBe(east);
        expect(decision.resolution.rule).toBe('points-differential');
        expect(decision.resolution.evidence[0]?.value).toBe(300);
        const equalStandings = standingsWith(run, {
            [east]: { wins: 56, losses: 26, pf: 8800, pa: 8600, h2h: { [west]: [1, 1] } },
            [west]: { wins: 56, losses: 26, pf: 8800, pa: 8600, h2h: { [east]: [1, 1] } },
        });
        decision = decideSeasonFinalsHomeCourt({
            league,
            standings: equalStandings,
            eastChampionFranchiseId: east,
            westChampionFranchiseId: west,
            drawSeed,
        });
        const expectedDraw = createRng(drawSeed).chance(0.5) ? east : west;
        expect(decision.homeCourtFranchiseId).toBe(expectedDraw);
        expect(decision.resolution.rule).toBe('random-draw');
        expect(decision.resolution.drawSeed).toBe(drawSeed);
        const second = decideSeasonFinalsHomeCourt({
            league,
            standings: equalStandings,
            eastChampionFranchiseId: east,
            westChampionFranchiseId: west,
            drawSeed,
        });
        expect(second).toEqual(decision);
    });
    it('sets the champion only after the Finals reach four wins', () => {
        const { run } = fixture();
        const state = rankedState(run.league);
        const beforeFinals = driveUntil(state, run.league, run.standings, homeWins, (current) => {
            const decision = seasonPostseasonNextGame(current);
            return decision.kind === 'game' && decision.gameId.startsWith('po-finals');
        });
        const finals = seriesOfBracket(beforeFinals, 'finals');
        const homeCourt = finals.homeCourtFranchiseId ?? '';
        const challenger = finals.challengerFranchiseId ?? '';
        let next = beforeFinals;
        for (let gameNumber = 1; gameNumber <= 6; gameNumber += 1) {
            const teams = seasonPostseasonGameTeamsOf(next, playoffGameIdOf('finals', gameNumber));
            if (teams === null)
                throw new Error('not scheduleable');
            const homeWon = [1, 2, 5].includes(gameNumber);
            const winner = homeWon ? homeCourt : challenger;
            const loser = winner === homeCourt ? challenger : homeCourt;
            next = seasonPostseasonApplyGameResult(next, finalFacts(playoffGameIdOf('finals', gameNumber), winner, loser, teams.home), run.league, run.standings);
        }
        expect(next.championFranchiseId).toBeNull();
        expect(seasonPostseasonNextGame(next)).toEqual({
            kind: 'game',
            gameId: playoffGameIdOf('finals', 7),
        });
        const teams = seasonPostseasonGameTeamsOf(next, playoffGameIdOf('finals', 7));
        if (teams === null)
            throw new Error('not scheduleable');
        next = seasonPostseasonApplyGameResult(next, finalFacts(playoffGameIdOf('finals', 7), homeCourt, challenger, teams.home), run.league, run.standings);
        expect(next.championFranchiseId).toBe(homeCourt);
        expect(next.bracket?.championFranchiseId).toBe(homeCourt);
        expect(seasonPostseasonNextGame(next)).toEqual({ kind: 'complete' });
        expect(seasonPostseasonStageOf(next)).toBe('completed');
    });
});
describe('postseason game simulation', () => {
    it('produces a schema-valid summary with the result digest and identity facts', () => {
        const { run, catalog, effects, profile, expanded } = fixture();
        const runWithState = { ...run, postseason: rankedState(run.league) };
        const outcome = simulateSeasonPostseasonGame({
            run: runWithState,
            effects,
            expanded,
            catalog,
            profile,
            gameId: 'pi-east-seven-eight',
            humanFranchiseId: null,
        });
        if (outcome.kind !== 'simulated')
            throw new Error(`unexpected: ${outcome.reason}`);
        const parsed = seasonPostseasonSummarySchema.safeParse(outcome.summary);
        expect(parsed.success).toBe(true);
        expect(outcome.summary.phase).toBe('play-in');
        expect(outcome.summary.round).toBe('seven-eight');
        expect(outcome.summary.seriesId).toBeNull();
        expect(outcome.summary.gameNumber).toBe(1);
        expect(outcome.summary.conference).toBe('east');
        expect(outcome.summary.resultDigest).toMatch(/^[0-9a-f]{32}$/);
        expect(outcome.summary.homePlayers).toHaveLength(10);
        expect(outcome.summary.awayPlayers).toHaveLength(10);
        expect(outcome.summary.rotationEvidence.home.playersUsed).toBeGreaterThan(0);
        expect(outcome.facts.status).toBe('final');
        expect(seasonPostseasonGameOrdinal('pi-east-seven-eight')).toBe(1);
        expect(seasonPostseasonGameOrdinal(playoffGameIdOf('finals', 7))).toBe(111);
    });
    it('rolls postseason injuries and folds them into health and the summary', () => {
        const { run, catalog, effects, profile, expanded } = fixture();
        let state = rankedState(run.league);
        let health = run.health;
        let gameCount = 0;
        for (const gameId of [
            'pi-east-seven-eight',
            'pi-east-nine-ten',
            'pi-east-final',
            'pi-west-seven-eight',
        ]) {
            const outcome = simulateSeasonPostseasonGame({
                run: { ...run, postseason: state, health },
                effects,
                expanded,
                catalog,
                profile,
                gameId,
                humanFranchiseId: null,
            });
            if (outcome.kind !== 'simulated')
                throw new Error(`unexpected: ${outcome.reason}`);
            health = outcome.nextHealth;
            gameCount += 1;
            const parsed = seasonPostseasonSummarySchema.safeParse(outcome.summary);
            expect(parsed.success).toBe(true);
            for (const event of outcome.summary.injuryEvents) {
                expect(event.returned ? event.returnClock !== null : event.returnClock === null).toBe(true);
            }
            state = seasonPostseasonApplyGameResult(state, outcome.facts, run.league, run.standings);
        }
        expect(gameCount).toBe(4);
    });
    it('forfeits an AI team that cannot field a legal five (official 2-0)', () => {
        const { run, catalog, effects, profile, expanded } = fixture();
        const state = rankedState(run.league);
        const ranking = state.playIn.east.ranking ?? [];
        const nineHome = ranking[8] ?? '';
        const sevenTop = ranking[6] ?? '';
        const sevenBottom = ranking[7] ?? '';
        const resolved = seasonPostseasonApplyGameResult(state, finalFacts('pi-east-seven-eight', sevenTop, sevenBottom, sevenTop), run.league, run.standings);
        const runWithState = {
            ...run,
            postseason: resolved,
            health: { ...run.health, injuries: seasonEndingInjuries(run, nineHome, 6, 'a') },
        };
        const outcome = simulateSeasonPostseasonGame({
            run: runWithState,
            effects,
            expanded,
            catalog,
            profile,
            gameId: 'pi-east-nine-ten',
            humanFranchiseId: null,
        });
        if (outcome.kind !== 'simulated')
            throw new Error(`unexpected: ${outcome.reason}`);
        expect(outcome.summary.status).toBe('forfeit');
        expect(outcome.summary.forfeitLoserFranchiseId).toBe(nineHome);
        expect(outcome.summary.homeScore + outcome.summary.awayScore).toBe(2);
        expect(outcome.summary.homePlayers).toHaveLength(0);
        expect(outcome.summary.awayPlayers).toHaveLength(0);
        expect(outcome.summary.rotationEvidence).toEqual({
            home: { playersUsed: 0, substitutions: 0 },
            away: { playersUsed: 0, substitutions: 0 },
        });
        const next = seasonPostseasonApplyGameResult(resolved, outcome.facts, run.league, run.standings);
        expect(seasonPostseasonGameTeamsOf(next, 'pi-east-final')?.away).toBe(next.playIn.east.games.nineTen.winnerFranchiseId);
    });
    it('recovers an AI team with injured starters through the planner (deterministic repair)', () => {
        const { run, catalog, effects, profile, expanded } = fixture();
        const state = rankedState(run.league);
        const east = rankedEast(run.league);
        const sevenHome = east[6] ?? '';
        const runWithState = {
            ...run,
            postseason: state,
            health: { ...run.health, injuries: seasonEndingInjuries(run, sevenHome, 2, 'b') },
        };
        const outcome = simulateSeasonPostseasonGame({
            run: runWithState,
            effects,
            expanded,
            catalog,
            profile,
            gameId: 'pi-east-seven-eight',
            humanFranchiseId: null,
        });
        if (outcome.kind !== 'simulated')
            throw new Error(`unexpected: ${outcome.reason}`);
        expect(outcome.summary.status).toBe('final');
        const injuredIds = new Set(runWithState.health.injuries.map((injury) => injury.playerVersionId));
        for (const line of outcome.summary.homePlayers) {
            if (injuredIds.has(line.playerVersionId)) {
                expect(line.seconds).toBe(0);
            }
        }
    });
});
describe('command-driven postseason flow', () => {
    it('drives a full run through start/advance/submit with the human champion', () => {
        const context = postseasonContext(TEST_SEED, forcedResolver(humanAlwaysWins));
        const { run, summaries } = playThroughCommands(context);
        expectValidRun(run);
        expect(run.stage).toBe('completed');
        expect(run.completion?.championFranchiseId).toBe(HUMAN);
        expect(run.postseason.championFranchiseId).toBe(HUMAN);
        expect(run.completion?.almanacDigest).toBe(POSTSEASON_ALMANAC_DIGEST_PLACEHOLDER);
        expect(run.completion?.finalizedAtStateRevision).toBe(run.stateRevision);
        const gameIds = summaries.map((summary) => summary.gameId);
        expect(new Set(gameIds).size).toBe(gameIds.length);
        expect(run.postseason.bracket?.championFranchiseId).toBe(HUMAN);
    });
    it('simulates human games with the carried rotation when the rotation stays valid', () => {
        const context = postseasonContext(TEST_SEED, forcedResolver(humanAlwaysWins));
        const start = handleSeasonRunCommand(commandOf(context.run, { command: 'start-postseason', commandId: 'start-1' }), context);
        if (start.result.result.status !== 'accepted')
            throw new Error('start rejected');
        const first = handleSeasonRunCommand(commandOf(start.run, { command: 'advance-postseason', commandId: 'adv-1' }), { ...context, run: start.run });
        const firstResult = first.result;
        if (firstResult.command !== 'advance-postseason')
            throw new Error('unexpected');
        if (firstResult.result.status !== 'accepted')
            throw new Error('advance rejected');
        expect(firstResult.result.stage).toBe('completed');
        expect(firstResult.result.nextDecision).toBe('none');
        expect(firstResult.result.nextGameId).toBeNull();
        expect(firstResult.result.advancedGameIds.length).toBeGreaterThan(20);
        expect(firstResult.result.advancedGameIds).toContain('pi-west-seven-eight');
        expect(firstResult.result.advancedGameIds).toContain('po-west-first-round-1-g1');
        expect(firstResult.result.advancedGameIds).toContain(playoffGameIdOf('finals', 1));
        expect(first.run.stateRevision).toBe(start.run.stateRevision + 1);
        expectValidRun(first.run);
    });
    it('stops at a human game whose rotation is invalid and continues after the repair', () => {
        const context = postseasonContext(TEST_SEED, forcedResolver(humanAlwaysWins));
        const start = handleSeasonRunCommand(commandOf(context.run, { command: 'start-postseason', commandId: 'start-1' }), context);
        if (start.result.result.status !== 'accepted')
            throw new Error('start rejected');
        const injured = {
            ...start.run,
            health: { ...start.run.health, injuries: seasonEndingInjuries(start.run, HUMAN, 2, 'd') },
        };
        const advance = handleSeasonRunCommand(commandOf(injured, { command: 'advance-postseason', commandId: 'adv-1' }), { ...context, run: injured });
        const advanceResult = advance.result;
        if (advanceResult.command !== 'advance-postseason')
            throw new Error('unexpected');
        if (advanceResult.result.status !== 'accepted')
            throw new Error('advance rejected');
        expect(advanceResult.result.nextDecision).toBe('rotation');
        expect(advanceResult.result.nextGameId).toBe('pi-west-seven-eight');
        expect(advanceResult.result.advancedGameIds).toEqual([
            'pi-east-seven-eight',
            'pi-east-nine-ten',
            'pi-east-final',
        ]);
        const rotation = repairedRotation(advance.run, HUMAN, context.catalog);
        const submit = handleSeasonRunCommand(commandOf(advance.run, {
            command: 'submit-postseason-rotation',
            commandId: 'sub-1',
            targetGameId: 'pi-west-seven-eight',
            rotation: { franchiseId: HUMAN, rotation },
        }), { ...context, run: advance.run });
        if (submit.result.result.status !== 'accepted')
            throw new Error('submit rejected');
        const nextAdvance = handleSeasonRunCommand(commandOf(submit.run, { command: 'advance-postseason', commandId: 'adv-2' }), { ...context, run: submit.run });
        const nextResult = nextAdvance.result;
        if (nextResult.command !== 'advance-postseason')
            throw new Error('unexpected');
        if (nextResult.result.status !== 'accepted')
            throw new Error('advance rejected');
        expect(nextResult.result.advancedGameIds).toContain('pi-west-seven-eight');
        expect(nextResult.result.advancedGameIds).toContain('pi-west-nine-ten');
        expect(nextResult.result.advancedGameIds).toContain('pi-west-final');
        expect(nextAdvance.postseasonSummaries?.length).toBeGreaterThan(3);
        for (const summary of nextAdvance.postseasonSummaries ?? []) {
            expect(seasonPostseasonSummarySchema.safeParse(summary).success).toBe(true);
        }
    });
    it('never changes AI rotations and changes the human rotation only via submit', () => {
        const context = postseasonContext(TEST_SEED, forcedResolver(humanAlwaysWins));
        const aiTeams = context.run.league.teams
            .filter((team) => team.franchiseId !== HUMAN)
            .slice(0, 3)
            .map((team) => team.franchiseId);
        const aiRotationsOf = (run: SeasonRun) => aiTeams.map((id) => run.rotations.find((rotation) => rotation.franchiseId === id));
        const before = aiRotationsOf(context.run);
        let ctx = context;
        const start = handleSeasonRunCommand(commandOf(ctx.run, { command: 'start-postseason', commandId: 'start-1' }), ctx);
        if (start.result.result.status !== 'accepted')
            throw new Error('start rejected');
        ctx = { ...ctx, run: start.run };
        for (let index = 1; index < 100; index += 1) {
            const advance = handleSeasonRunCommand(commandOf(ctx.run, { command: 'advance-postseason', commandId: `adv-${String(index)}` }), ctx);
            const advanceOutput = advance.result;
            if (advanceOutput.command !== 'advance-postseason')
                throw new Error('unexpected command');
            const result = advanceOutput.result;
            if (result.status === 'rejected')
                throw new Error('advance rejected');
            ctx = { ...ctx, run: advance.run };
            if (result.nextDecision === 'rotation' && result.nextGameId !== null) {
                const rotation = repairedRotation(ctx.run, HUMAN, ctx.catalog);
                const submit = handleSeasonRunCommand(commandOf(ctx.run, {
                    command: 'submit-postseason-rotation',
                    commandId: `sub-${String(index)}`,
                    targetGameId: result.nextGameId,
                    rotation: { franchiseId: HUMAN, rotation },
                }), ctx);
                if (submit.result.result.status !== 'accepted')
                    throw new Error('submit rejected');
                ctx = { ...ctx, run: submit.run };
            }
            if (result.stage === 'completed')
                break;
        }
        const after = aiRotationsOf(ctx.run);
        expect(after).toEqual(before);
    });
    it('returns the typed rotation decision when the human cannot field a legal five', () => {
        const context = postseasonContext(TEST_SEED, forcedResolver(humanAlwaysWins));
        const start = handleSeasonRunCommand(commandOf(context.run, { command: 'start-postseason', commandId: 'start-1' }), context);
        if (start.result.result.status !== 'accepted')
            throw new Error('start rejected');
        const injured = {
            ...start.run,
            health: { ...start.run.health, injuries: seasonEndingInjuries(start.run, HUMAN, 6, 'c') },
        };
        const advance = handleSeasonRunCommand(commandOf(injured, { command: 'advance-postseason', commandId: 'adv-1' }), { ...context, run: injured });
        const result = advance.result;
        if (result.command !== 'advance-postseason')
            throw new Error('unexpected');
        if (result.result.status !== 'accepted')
            throw new Error('advance rejected');
        expect(result.result.nextDecision).toBe('rotation');
        expect(result.result.nextGameId).toBe('pi-west-seven-eight');
    });
    it('rejects advance with integrity-failure when both AI teams of a game are invalid', () => {
        const context = postseasonContext(TEST_SEED, forcedResolver(humanAlwaysWins));
        const excluded = {
            ...context.run,
            postseason: seasonPostseasonSetRankings(context.run.postseason, context.run.league, {
                east: rankedEast(context.run.league),
                west: rankedWestWithout(context.run.league, HUMAN),
            }),
            stage: 'play-in' as const,
        };
        const east = rankedEast(excluded.league);
        const sevenHome = east[6] ?? '';
        const sevenAway = east[7] ?? '';
        const run: SeasonRun = {
            ...excluded,
            health: {
                ...excluded.health,
                injuries: [
                    ...seasonEndingInjuries(excluded, sevenHome, 6, 'a'),
                    ...seasonEndingInjuries(excluded, sevenAway, 6, 'b'),
                ],
            },
        };
        const advance = handleSeasonRunCommand(commandOf(run, { command: 'advance-postseason', commandId: 'adv-1' }), { ...context, run });
        const result = advance.result;
        if (result.command !== 'advance-postseason')
            throw new Error('unexpected');
        if (result.result.status !== 'rejected')
            throw new Error('expected rejection');
        expect(result.result.rejection.code).toBe('integrity-failure');
        expect(advance.run.stateRevision).toBe(run.stateRevision);
    });
    it('spectates after elimination and fast-forwards to the champion', () => {
        const context = postseasonContext(TEST_SEED, forcedResolver(humanLosesEarly));
        const start = handleSeasonRunCommand(commandOf(context.run, { command: 'start-postseason', commandId: 'start-1' }), context);
        if (start.result.result.status !== 'accepted')
            throw new Error('start rejected');
        const advance = handleSeasonRunCommand(commandOf(start.run, {
            command: 'advance-postseason',
            commandId: 'adv-1',
            targetGameId: 'po-west-first-round-1-g1',
        }), { ...context, run: start.run });
        const advanceResult = advance.result;
        if (advanceResult.command !== 'advance-postseason')
            throw new Error('unexpected');
        if (advanceResult.result.status !== 'accepted')
            throw new Error('advance rejected');
        expect(advanceResult.result.advancedGameIds).toContain('pi-west-seven-eight');
        expect(advanceResult.result.advancedGameIds).toContain('pi-west-final');
        expect(advanceResult.result.aiNextGameId).toBe('po-west-first-round-1-g2');
        expect(seasonPostseasonHumanEliminated(advance.run.postseason, HUMAN)).toBe(true);
        const submit = handleSeasonRunCommand(commandOf(advance.run, {
            command: 'submit-postseason-rotation',
            commandId: 'sub-1',
            targetGameId: 'po-west-first-round-1-g2',
            rotation: {
                franchiseId: HUMAN,
                rotation: repairedRotation(advance.run, HUMAN, context.catalog),
            },
        }), { ...context, run: advance.run });
        const submitResult = submit.result;
        if (submitResult.command !== 'submit-postseason-rotation')
            throw new Error('unexpected');
        if (submitResult.result.status !== 'rejected')
            throw new Error('expected rejection');
        expect(submitResult.result.rejection.code).toBe('wrong-game');
        const spectate = handleSeasonRunCommand(commandOf(advance.run, {
            command: 'spectate-postseason-game',
            commandId: 'spec-1',
            targetGameId: 'po-west-first-round-1-g2',
        }), { ...context, run: advance.run });
        const spectateResult = spectate.result;
        if (spectateResult.command !== 'spectate-postseason-game')
            throw new Error('unexpected');
        expect(spectateResult.result.status).toBe('accepted');
        expect(spectate.postseasonSummaries?.[0]?.gameId).toBe('po-west-first-round-1-g2');
        const fastForward = handleSeasonRunCommand(commandOf(spectate.run, { command: 'fast-forward-postseason', commandId: 'ff-1' }), { ...context, run: spectate.run });
        const ffResult = fastForward.result;
        if (ffResult.command !== 'fast-forward-postseason')
            throw new Error('unexpected');
        if (ffResult.result.status !== 'accepted')
            throw new Error('fast-forward rejected');
        expect(ffResult.result.stage).toBe('completed');
        expect(ffResult.result.championFranchiseId).not.toBe(HUMAN);
        expectValidRun(fastForward.run);
        expect(fastForward.run.completion?.championFranchiseId).toBe(ffResult.result.championFranchiseId);
    });
    it('fast-forwards an AI-only run to completion in canonical order', () => {
        const context = postseasonContext(TEST_SEED, forcedResolver(homeWins));
        const run = context.run;
        const aiOnlyContext = {
            ...context,
            run,
            rankings: ({ league }: {
                league: SeasonLeague;
            }) => ({
                east: rankedEast(league),
                west: rankedWestWithout(league, HUMAN),
            }),
        };
        const start = handleSeasonRunCommand(commandOf(run, { command: 'start-postseason', commandId: 'start-1' }), aiOnlyContext);
        if (start.result.result.status !== 'accepted')
            throw new Error('start rejected');
        const fastForward = handleSeasonRunCommand(commandOf(start.run, { command: 'fast-forward-postseason', commandId: 'ff-1' }), { ...context, run: start.run });
        const ffResult = fastForward.result;
        if (ffResult.command !== 'fast-forward-postseason')
            throw new Error('unexpected');
        if (ffResult.result.status !== 'accepted')
            throw new Error('fast-forward rejected');
        expectValidRun(fastForward.run);
        const summaries = fastForward.postseasonSummaries ?? [];
        const gameIds = summaries.map((summary) => summary.gameId);
        expect(new Set(gameIds).size).toBe(gameIds.length);
        const bracket = fastForward.run.postseason.bracket;
        if (bracket === null)
            throw new Error('no bracket');
        for (const series of [
            ...bracket.east.firstRound,
            ...bracket.east.semifinals,
            bracket.east.conferenceFinal,
            ...bracket.west.firstRound,
            ...bracket.west.semifinals,
            bracket.west.conferenceFinal,
            bracket.finals,
        ]) {
            expect(series.games.length).toBe(series.homeCourtWins + series.challengerWins);
            for (const game of series.games) {
                expect(gameIds).toContain(game.gameId);
            }
        }
    });
    it('produces identical output from identical inputs across a full run', () => {
        const contextA = postseasonContext(TEST_SEED, forcedResolver(humanAlwaysWins));
        const contextB = postseasonContext(TEST_SEED, forcedResolver(humanAlwaysWins));
        const a = playThroughCommands(contextA);
        const b = playThroughCommands(contextB);
        expect(b.run).toEqual(a.run);
        expect(b.summaries).toEqual(a.summaries);
    });
    it('keeps real-simulation mini-runs deterministic', () => {
        const simulate = (seed: string) => {
            const { run, catalog, effects, profile, expanded } = fixture(seed);
            let state = rankedState(run.league, seed);
            let health = run.health;
            let nextEffects = effects;
            const summaries: SeasonPostseasonSummary[] = [];
            for (let i = 0; i < 3; i += 1) {
                const decision = seasonPostseasonNextGame(state);
                if (decision.kind !== 'game')
                    throw new Error('expected a game');
                const outcome = simulateSeasonPostseasonGame({
                    run: { ...run, postseason: state, health },
                    effects: nextEffects,
                    expanded,
                    catalog,
                    profile,
                    gameId: decision.gameId,
                    humanFranchiseId: null,
                });
                if (outcome.kind !== 'simulated')
                    throw new Error(`unexpected: ${outcome.reason}`);
                state = seasonPostseasonApplyGameResult(state, outcome.facts, run.league, run.standings);
                health = outcome.nextHealth;
                nextEffects = outcome.nextEffects;
                summaries.push(outcome.summary);
            }
            return { summaries, health, postseason: state };
        };
        expect(simulate(TEST_SEED)).toEqual(simulate(TEST_SEED));
    });
});
describe('risky rehab and summaries', () => {
    it('rolls the rehab outcome under the postseason-injuries stream', () => {
        const injuryId = `inj-${'a'.repeat(32)}`;
        const first = rollPostseasonRehabOutcome(TEST_SEED, injuryId);
        const second = rollPostseasonRehabOutcome(TEST_SEED, injuryId);
        expect(second).toBe(first);
        expect(['success', 'failure']).toContain(first);
        const regular = seasonNamespaceSeed(TEST_SEED, 'injuries', injuryId, 'rehab');
        const postseason = seasonNamespaceSeed(TEST_SEED, 'postseason-injuries', injuryId, 'rehab');
        expect(postseason).not.toBe(regular);
    });
    it('builds forfeit summaries directly through the summary converter', () => {
        const { run } = fixture();
        const state = rankedState(run.league);
        const ranking = state.playIn.east.ranking ?? [];
        const outcome = seasonPostseasonSummaryFromGame({
            runId: run.runId,
            gameId: 'pi-east-seven-eight',
            phase: 'play-in',
            round: 'seven-eight',
            seriesId: null,
            gameNumber: 1,
            conference: 'east',
            homeFranchiseId: ranking[6] ?? '',
            awayFranchiseId: ranking[7] ?? '',
            result: {
                schemaVersion: 1,
                outcome: 'forfeit',
                seed: 'a'.repeat(32),
                gameNumber: 1,
                dataVersion: 'v1',
                engineVersion: 'engine-v1',
                profileVersion: 'profile-v1',
                winner: 'home',
                losingFranchiseId: ranking[7] ?? '',
                trigger: 'no-legal-five-tipoff',
                homeScore: 2,
                awayScore: 0,
            },
            injuryEvents: [],
        });
        const parsed = seasonPostseasonSummarySchema.safeParse(outcome);
        expect(parsed.success).toBe(true);
        expect(outcome.status).toBe('forfeit');
        expect(outcome.forfeitLoserFranchiseId).toBe(ranking[7]);
        expect(outcome.winnerFranchiseId).toBe(ranking[6]);
        expect(outcome.homePlayers).toHaveLength(0);
        expect(outcome.rotationEvidence).toEqual({
            home: { playersUsed: 0, substitutions: 0 },
            away: { playersUsed: 0, substitutions: 0 },
        });
    });
});
describe('helper consistency', () => {
    it('derives the fixed game ordinals canonically', () => {
        expect(seasonPostseasonGameOrdinal(playInGameIdOf('east', 'seven-eight'))).toBe(1);
        expect(seasonPostseasonGameOrdinal(playInGameIdOf('west', 'final'))).toBe(6);
        expect(seasonPostseasonGameOrdinal(playoffGameIdOf('east-first-round-1', 1))).toBe(7);
        expect(seasonPostseasonGameOrdinal(playoffGameIdOf('finals', 7))).toBe(111);
    });
    it('tracks human elimination through play-in losses and playoff exits', () => {
        const { run } = fixture();
        const state = rankedState(run.league);
        expect(seasonPostseasonHumanEliminated(buildInitialPostseasonState(TEST_SEED), HUMAN)).toBe(true);
        expect(seasonPostseasonHumanEliminated(state, HUMAN)).toBe(false);
        const ranking = state.playIn.west.ranking ?? [];
        const lost = seasonPostseasonApplyGameResult(state, finalFacts('pi-west-seven-eight', ranking[7] ?? '', ranking[6] ?? '', ranking[6] ?? ''), run.league, run.standings);
        expect(seasonPostseasonHumanEliminated(lost, HUMAN)).toBe(false);
        const lostNine = seasonPostseasonApplyGameResult(lost, finalFacts('pi-west-nine-ten', ranking[9] ?? '', ranking[8] ?? '', ranking[8] ?? ''), run.league, run.standings);
        const lostFinal = seasonPostseasonApplyGameResult(lostNine, finalFacts('pi-west-final', ranking[9] ?? '', ranking[6] ?? '', ranking[6] ?? ''), run.league, run.standings);
        expect(seasonPostseasonHumanEliminated(lostFinal, HUMAN)).toBe(true);
    });
});
