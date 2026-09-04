import { SEASON_ENDING_MISSED_GAMES_SENTINEL, SEASON_POSTSEASON_SUMMARY_VERSION, SEASON_POSTSEASON_VERSION, SEASON_ROUND_COUNT, SEASON_SEED_NAMESPACES, franchiseIdSchema, idSchema, parsePlayoffGameId, playoffGameIdOf, playInGameIdOf, postseasonPhaseOfGameId, seasonDigestHex, seasonGameIdSchema, seasonNamespaceSeed, seasonPostseasonSummaryDigest, seasonPostseasonSummarySchema, seedSchema, type ConferenceId, type EraSimulationProfile, type FranchiseId, type PlayInGame, type PlayInMatchupId, type PlayInState, type PlayoffBracket, type PlayoffConferenceBracket, type PlayoffRound, type PlayoffSeries, type PlayoffSeriesGame, type Position, type SeasonCompactInjuryEvent, type SeasonDraftCatalog, type SeasonEffectsState, type SeasonGameEffectsTransition, type SeasonGamePlayerInput, type SeasonGameSimulationInput, type SeasonGameSimulationResult, type SeasonHealthState, type SeasonInjuryRecord, type SeasonInjurySeverity, type SeasonInjuryType, type SeasonLeague, type SeasonPostseasonState, type SeasonPostseasonSummary, type SeasonRun, type SeasonRunStage, type SeasonStandings, type SeasonTiebreakResolution, } from '@hoop-rush/data-contracts';
import { createEngineContext } from '../sim/context.ts';
import { HALFTIME_SECOND, REGULATION_TOTAL_SECONDS } from '../sim/periods.ts';
import { createRng } from '../sim/rng.ts';
import { applySeasonGameEffectsTransition } from './effects.ts';
import { seasonGameSummaryFromResult } from './game-summary.ts';
import { seasonFranchiseLegalFiveFacts, seasonPregameAvailabilityOf } from './health.ts';
import { SEASON_HOME_COURT_PROFILE } from './home-court.ts';
import { SEASON_INJURY_MAJOR_BP, SEASON_INJURY_MINOR_BP, SEASON_INJURY_MODERATE_BP, SEASON_INJURY_RECOVERY_RANGES, SEASON_INJURY_REHAB_SUCCESS_BP, SEASON_INJURY_SAME_GAME_RETURN_BP, applySeasonGameHealthTransition, clockFromTipoffSeconds, seasonInjuryIdOf, seasonInjuryRiskBasisPoints, seasonPlayerAvailable, type SeasonInjuryRollInput, type SeasonInjuryRollResult, } from './injuries.ts';
import { conferenceOf, franchisesInConference } from './league.ts';
import { simulateSeasonGameWithEffects } from './season-game.ts';
import { drawHexInt } from './season-seeds.ts';
export const SEASON_POSTSEASON_RISKY_REHAB_COST = 2;
export const POSTSEASON_ALMANAC_DIGEST_PLACEHOLDER = '0'.repeat(32);
const CONFERENCES: readonly ConferenceId[] = ['east', 'west'];
function parsePlayInGameId(gameId: string): {
    conference: ConferenceId;
    matchup: PlayInMatchupId;
} | null {
    const match = /^pi-(east|west)-(seven-eight|nine-ten|final)$/.exec(gameId);
    if (match === null)
        return null;
    const conference = match[1];
    const matchup = match[2];
    if ((conference !== 'east' && conference !== 'west') || matchup === undefined)
        return null;
    if (matchup !== 'seven-eight' && matchup !== 'nine-ten' && matchup !== 'final')
        return null;
    return {
        conference,
        matchup,
    };
}
const FIRST_ROUND_PAIRS: ReadonlyArray<readonly [
    number,
    number
]> = [
    [0, 7],
    [3, 4],
    [2, 5],
    [1, 6],
];
const HOME_COURT_GAMES: ReadonlySet<number> = new Set([1, 2, 5, 7]);
const PLAY_IN_GAME_ORDER: readonly string[] = [
    playInGameIdOf('east', 'seven-eight'),
    playInGameIdOf('east', 'nine-ten'),
    playInGameIdOf('east', 'final'),
    playInGameIdOf('west', 'seven-eight'),
    playInGameIdOf('west', 'nine-ten'),
    playInGameIdOf('west', 'final'),
];
const PLAYOFF_SERIES_IDS: readonly string[] = [
    'east-first-round-1',
    'east-first-round-2',
    'east-first-round-3',
    'east-first-round-4',
    'east-semifinal-1',
    'east-semifinal-2',
    'east-conference-final',
    'west-first-round-1',
    'west-first-round-2',
    'west-first-round-3',
    'west-first-round-4',
    'west-semifinal-1',
    'west-semifinal-2',
    'west-conference-final',
    'finals',
];
const POSTSEASON_GAME_ORDER: readonly string[] = [
    ...PLAY_IN_GAME_ORDER,
    ...PLAYOFF_SERIES_IDS.flatMap((seriesId) => [1, 2, 3, 4, 5, 6, 7].map((gameNumber) => playoffGameIdOf(seriesId, gameNumber))),
];
const POSTSEASON_INJURY_TYPES: readonly SeasonInjuryType[] = [
    'lower-body',
    'soft-tissue',
    'upper-body',
    'illness',
];
export class SeasonPostseasonInvariantError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SeasonPostseasonInvariantError';
    }
}
export class SeasonPostseasonContextError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SeasonPostseasonContextError';
    }
}
export interface SeasonPostseasonRankingsInput {
    league: SeasonLeague;
    standings: SeasonStandings;
    seed: string;
}
export interface SeasonPostseasonRankings {
    east: readonly string[];
    west: readonly string[];
}
export type SeasonPostseasonRankingsFn = (input: SeasonPostseasonRankingsInput) => SeasonPostseasonRankings;
export function seasonPostseasonSetRankings(state: SeasonPostseasonState, league: SeasonLeague, rankings: SeasonPostseasonRankings): SeasonPostseasonState {
    const playIn = { ...state.playIn };
    for (const conference of CONFERENCES) {
        const current = state.playIn[conference];
        if (current.ranking !== null) {
            throw new SeasonPostseasonInvariantError(`${conference} play-in rankings are already set`);
        }
        const ids = [...rankings[conference]].map((id) => franchiseIdSchema.parse(id));
        if (ids.length !== 10 || new Set(ids).size !== 10) {
            throw new SeasonPostseasonInvariantError(`${conference} rankings must contain exactly ten unique teams`);
        }
        const conferenceTeams = new Set(franchisesInConference(league, conference));
        for (const id of ids) {
            if (!conferenceTeams.has(id)) {
                throw new SeasonPostseasonInvariantError(`ranking team ${id} is not in the ${conference} conference`);
            }
        }
        playIn[conference] = { ...current, ranking: ids };
    }
    return { ...state, playIn };
}
export function seasonPostseasonGameOrdinal(gameId: string): number {
    const index = POSTSEASON_GAME_ORDER.indexOf(gameId);
    if (index === -1) {
        throw new SeasonPostseasonInvariantError(`unknown postseason game ${gameId}`);
    }
    return index + 1;
}
export type SeasonPostseasonNextGame = {
    kind: 'game';
    gameId: string;
} | {
    kind: 'complete';
} | {
    kind: 'integrity-failure';
    reason: string;
};
export function seasonPostseasonNextGame(state: SeasonPostseasonState): SeasonPostseasonNextGame {
    if (state.bracket === null) {
        for (const conference of CONFERENCES) {
            const playIn = state.playIn[conference];
            const ranking = playIn.ranking;
            if (ranking === null) {
                return {
                    kind: 'integrity-failure',
                    reason: `${conference} play-in has no ranking`,
                };
            }
            const sevenEight = playIn.games.sevenEight;
            const nineTen = playIn.games.nineTen;
            const final = playIn.games.final;
            if (sevenEight.status === 'scheduled') {
                return { kind: 'game', gameId: sevenEight.gameId };
            }
            if (nineTen.status === 'scheduled') {
                return { kind: 'game', gameId: nineTen.gameId };
            }
            if (final.status === 'scheduled') {
                return { kind: 'game', gameId: final.gameId };
            }
        }
        return {
            kind: 'integrity-failure',
            reason: 'both conferences completed the Play-In without a bracket',
        };
    }
    for (const series of bracketSeriesOrder(state.bracket)) {
        if (series.winnerFranchiseId !== null)
            continue;
        if (series.homeCourtFranchiseId === null || series.challengerFranchiseId === null) {
            return {
                kind: 'integrity-failure',
                reason: `series ${series.seriesId} is unpaired before its feeders complete`,
            };
        }
        const nextGameNumber = series.games.length + 1;
        if (nextGameNumber > 7) {
            return {
                kind: 'integrity-failure',
                reason: `series ${series.seriesId} exceeds seven games`,
            };
        }
        return { kind: 'game', gameId: playoffGameIdOf(series.seriesId, nextGameNumber) };
    }
    return { kind: 'complete' };
}
export function seasonPostseasonUpcomingGames(state: SeasonPostseasonState): string[] {
    const ids: string[] = [];
    if (state.bracket === null) {
        for (const conference of CONFERENCES) {
            const playIn = state.playIn[conference];
            const sevenDone = playIn.games.sevenEight.status !== 'scheduled';
            const nineDone = playIn.games.nineTen.status !== 'scheduled';
            if (playIn.games.sevenEight.status === 'scheduled') {
                ids.push(playIn.games.sevenEight.gameId);
            }
            if (playIn.games.nineTen.status === 'scheduled') {
                ids.push(playIn.games.nineTen.gameId);
            }
            if (playIn.games.final.status === 'scheduled' && sevenDone && nineDone) {
                ids.push(playIn.games.final.gameId);
            }
        }
        for (const seriesId of PLAYOFF_SERIES_IDS) {
            for (let gameNumber = 1; gameNumber <= 7; gameNumber += 1) {
                ids.push(playoffGameIdOf(seriesId, gameNumber));
            }
        }
        return ids;
    }
    for (const series of bracketSeriesOrder(state.bracket)) {
        if (series.winnerFranchiseId !== null)
            continue;
        for (let gameNumber = series.games.length + 1; gameNumber <= 7; gameNumber += 1) {
            ids.push(playoffGameIdOf(series.seriesId, gameNumber));
        }
    }
    return ids;
}
export function seasonPostseasonGameTeamsOf(state: SeasonPostseasonState, gameId: string): {
    home: string;
    away: string;
} | null {
    if (postseasonPhaseOfGameId(gameId) === 'play-in') {
        const parsed = parsePlayInGameId(gameId);
        if (parsed === null)
            return null;
        const { conference, matchup } = parsed;
        const playIn = state.playIn[conference];
        const ranking = playIn.ranking;
        if (ranking === null)
            return null;
        if (matchup === 'seven-eight') {
            const home = ranking[6];
            const away = ranking[7];
            return home === undefined || away === undefined ? null : { home, away };
        }
        if (matchup === 'nine-ten') {
            const home = ranking[8];
            const away = ranking[9];
            return home === undefined || away === undefined ? null : { home, away };
        }
        if (playIn.games.sevenEight.status === 'scheduled' ||
            playIn.games.nineTen.status === 'scheduled') {
            return null;
        }
        const home = playIn.games.sevenEight.loserFranchiseId;
        const away = playIn.games.nineTen.winnerFranchiseId;
        if (home === null || away === null)
            return null;
        return { home, away };
    }
    const parsed = parsePlayoffGameId(gameId);
    if (parsed === null)
        return null;
    const series = findSeriesOrNull(state.bracket, parsed.seriesId);
    if (series === null)
        return null;
    if (series.winnerFranchiseId !== null)
        return null;
    if (parsed.gameNumber !== series.games.length + 1)
        return null;
    const homeCourt = series.homeCourtFranchiseId;
    const challenger = series.challengerFranchiseId;
    if (homeCourt === null || challenger === null)
        return null;
    const home = HOME_COURT_GAMES.has(parsed.gameNumber) ? homeCourt : challenger;
    const away = home === homeCourt ? challenger : homeCourt;
    return { home, away };
}
export function seasonPostseasonHumanPlaysGame(state: SeasonPostseasonState, gameId: string, humanFranchiseId: string): boolean {
    const teams = seasonPostseasonGameTeamsOf(state, gameId);
    return teams !== null && (teams.home === humanFranchiseId || teams.away === humanFranchiseId);
}
export function seasonPostseasonHumanEliminated(state: SeasonPostseasonState, humanFranchiseId: string): boolean {
    const humanId = franchiseIdSchema.parse(humanFranchiseId);
    if (state.bracket === null) {
        for (const conference of CONFERENCES) {
            const playIn = state.playIn[conference];
            const ranking = playIn.ranking;
            if (ranking === null)
                continue;
            const position = ranking.indexOf(humanId);
            if (position === -1)
                continue;
            if (position < 6)
                return false;
            const sevenEight = playIn.games.sevenEight;
            const nineTen = playIn.games.nineTen;
            const final = playIn.games.final;
            const wonAny = [sevenEight, nineTen, final].some((game) => game.status !== 'scheduled' && game.winnerFranchiseId === humanId);
            if (wonAny)
                return false;
            for (const game of [sevenEight, nineTen, final]) {
                if (game.status !== 'scheduled')
                    continue;
                const teams = seasonPostseasonGameTeamsOf(state, game.gameId);
                if (teams !== null && (teams.home === humanId || teams.away === humanId)) {
                    return false;
                }
            }
            if (sevenEight.status !== 'scheduled' &&
                sevenEight.loserFranchiseId === humanId &&
                final.status === 'scheduled') {
                return false;
            }
        }
        return true;
    }
    for (const series of bracketSeriesOrder(state.bracket)) {
        if (series.winnerFranchiseId !== null)
            continue;
        if (series.homeCourtFranchiseId === humanId || series.challengerFranchiseId === humanId) {
            return false;
        }
    }
    return true;
}
export interface SeasonPostseasonGameFacts {
    gameId: string;
    status: 'final' | 'forfeit';
    winnerFranchiseId: string;
    loserFranchiseId: string;
    homeScore: number | null;
    awayScore: number | null;
}
export function seasonPostseasonApplyGameResult(state: SeasonPostseasonState, facts: SeasonPostseasonGameFacts, league: SeasonLeague, standings: SeasonStandings): SeasonPostseasonState {
    if (postseasonPhaseOfGameId(facts.gameId) === 'play-in') {
        let next = applyPlayInGameResult(state, facts);
        if (next.playIn.east.playoffSeeds !== null &&
            next.playIn.west.playoffSeeds !== null &&
            next.bracket === null) {
            next = createSeasonPlayoffBracket(next);
        }
        return next;
    }
    return applyPlayoffGameResult(state, facts, league, standings);
}
function gameKeyOf(matchup: PlayInMatchupId): 'sevenEight' | 'nineTen' | 'final' {
    if (matchup === 'seven-eight')
        return 'sevenEight';
    if (matchup === 'nine-ten')
        return 'nineTen';
    return 'final';
}
function applyPlayInGameResult(state: SeasonPostseasonState, facts: SeasonPostseasonGameFacts): SeasonPostseasonState {
    const parsed = parsePlayInGameId(facts.gameId);
    if (parsed === null) {
        throw new SeasonPostseasonInvariantError(`malformed play-in game id ${facts.gameId}`);
    }
    const { conference, matchup } = parsed;
    const playIn = state.playIn[conference];
    const key = gameKeyOf(matchup);
    const game = playIn.games[key];
    if (game.status !== 'scheduled') {
        throw new SeasonPostseasonInvariantError(`${facts.gameId} is already resolved`);
    }
    const ranking = playIn.ranking;
    if (ranking === null) {
        throw new SeasonPostseasonInvariantError(`${conference} play-in has no ranking`);
    }
    let homeRaw: string;
    let awayRaw: string;
    if (matchup === 'seven-eight') {
        homeRaw = ranking[6] ?? '';
        awayRaw = ranking[7] ?? '';
    }
    else if (matchup === 'nine-ten') {
        homeRaw = ranking[8] ?? '';
        awayRaw = ranking[9] ?? '';
    }
    else {
        const sevenDone = playIn.games.sevenEight.status !== 'scheduled';
        const nineDone = playIn.games.nineTen.status !== 'scheduled';
        if (!sevenDone || !nineDone) {
            throw new SeasonPostseasonInvariantError(`${conference} play-in final requires the 7/8 and 9/10 games first`);
        }
        homeRaw = playIn.games.sevenEight.loserFranchiseId ?? '';
        awayRaw = playIn.games.nineTen.winnerFranchiseId ?? '';
    }
    if (homeRaw === '' || awayRaw === '') {
        throw new SeasonPostseasonInvariantError(`${facts.gameId} has no derived matchup`);
    }
    const home = franchiseIdSchema.parse(homeRaw);
    const away = franchiseIdSchema.parse(awayRaw);
    const resolved = resolvePlayInGame(playIn.games[key], home, away, facts);
    const updated = advanceConferencePlayIn({
        ...playIn,
        games: { ...playIn.games, [key]: resolved },
    });
    return { ...state, playIn: { ...state.playIn, [conference]: updated } };
}
function resolvePlayInGame(game: PlayInGame, home: FranchiseId, away: FranchiseId, facts: SeasonPostseasonGameFacts): PlayInGame {
    const winnerFranchiseId = franchiseIdSchema.parse(facts.winnerFranchiseId);
    const loserFranchiseId = franchiseIdSchema.parse(facts.loserFranchiseId);
    const teams = [home, away];
    if (home === away) {
        throw new SeasonPostseasonInvariantError(`play-in game ${facts.gameId} cannot pair a team with itself`);
    }
    if (!teams.includes(winnerFranchiseId) || !teams.includes(loserFranchiseId)) {
        throw new SeasonPostseasonInvariantError(`play-in game ${facts.gameId} winner/loser must be participants`);
    }
    if (facts.status === 'final') {
        const homeScore = facts.homeScore;
        const awayScore = facts.awayScore;
        if (homeScore === null || awayScore === null || homeScore === awayScore) {
            throw new SeasonPostseasonInvariantError(`play-in game ${facts.gameId} final must carry unequal scores`);
        }
        const homeWon = homeScore > awayScore;
        const expectedWinner = homeWon ? home : away;
        if (winnerFranchiseId !== expectedWinner) {
            throw new SeasonPostseasonInvariantError(`play-in game ${facts.gameId} winner must match the score`);
        }
        return {
            gameId: game.gameId,
            status: 'final',
            homeFranchiseId: home,
            awayFranchiseId: away,
            winnerFranchiseId,
            loserFranchiseId,
            homeScore,
            awayScore,
        };
    }
    if (facts.homeScore !== null || facts.awayScore !== null) {
        throw new SeasonPostseasonInvariantError(`play-in game ${facts.gameId} forfeit carries no scores`);
    }
    return {
        gameId: game.gameId,
        status: 'forfeit',
        homeFranchiseId: home,
        awayFranchiseId: away,
        winnerFranchiseId,
        loserFranchiseId,
        homeScore: null,
        awayScore: null,
    };
}
function advanceConferencePlayIn(playIn: PlayInState): PlayInState {
    const sevenDone = playIn.games.sevenEight.status !== 'scheduled';
    const nineDone = playIn.games.nineTen.status !== 'scheduled';
    const finalDone = playIn.games.final.status !== 'scheduled';
    if (!sevenDone || !nineDone || !finalDone)
        return playIn;
    const ranking = playIn.ranking;
    const seedSeven = playIn.games.sevenEight.winnerFranchiseId;
    const seedEight = playIn.games.final.winnerFranchiseId;
    if (ranking === null || seedSeven === null || seedEight === null) {
        throw new SeasonPostseasonInvariantError(`${playIn.conference} play-in final resolved without complete winners`);
    }
    return {
        ...playIn,
        playoffSeeds: [...ranking.slice(0, 6), seedSeven, seedEight],
    };
}
function buildConferenceBracket(conference: ConferenceId, seeds: readonly FranchiseId[]): PlayoffConferenceBracket {
    const firstRound = FIRST_ROUND_PAIRS.map(([higherIndex, lowerIndex], index) => {
        const higherSeed = higherIndex + 1;
        const lowerSeed = lowerIndex + 1;
        return seededSeries(`${conference}-first-round-${String(index + 1)}`, 'first-round', conference, seeds[higherIndex] ?? null, seeds[lowerIndex] ?? null, higherSeed, lowerSeed);
    });
    return {
        conference,
        seeds: [...seeds],
        firstRound,
        semifinals: [
            pendingSeries(`${conference}-semifinal-1`, 'conference-semifinal', conference),
            pendingSeries(`${conference}-semifinal-2`, 'conference-semifinal', conference),
        ],
        conferenceFinal: pendingSeries(`${conference}-conference-final`, 'conference-final', conference),
    };
}
function seededSeries(seriesId: string, round: PlayoffRound, conference: ConferenceId, homeCourtFranchiseId: FranchiseId | string | null, challengerFranchiseId: FranchiseId | string | null, higherSeed: number | null, lowerSeed: number | null): PlayoffSeries {
    return {
        seriesId: idSchema.parse(seriesId),
        round,
        conference,
        higherSeed,
        lowerSeed,
        homeCourtFranchiseId: homeCourtFranchiseId === null ? null : franchiseIdSchema.parse(homeCourtFranchiseId),
        challengerFranchiseId: challengerFranchiseId === null ? null : franchiseIdSchema.parse(challengerFranchiseId),
        homeCourtWins: 0,
        challengerWins: 0,
        games: [],
        winnerFranchiseId: null,
    };
}
function pendingSeries(seriesId: string, round: PlayoffRound, conference: ConferenceId): PlayoffSeries {
    return seededSeries(seriesId, round, conference, null, null, null, null);
}
function createSeasonPlayoffBracket(state: SeasonPostseasonState): SeasonPostseasonState {
    const eastSeeds = state.playIn.east.playoffSeeds;
    const westSeeds = state.playIn.west.playoffSeeds;
    if (eastSeeds === null || westSeeds === null) {
        throw new SeasonPostseasonInvariantError('both conferences must complete the Play-In before the bracket is created');
    }
    const bracket: PlayoffBracket = {
        schemaVersion: 1,
        postseasonVersion: SEASON_POSTSEASON_VERSION,
        east: buildConferenceBracket('east', eastSeeds),
        west: buildConferenceBracket('west', westSeeds),
        finals: {
            seriesId: idSchema.parse('finals'),
            round: 'finals',
            conference: null,
            higherSeed: null,
            lowerSeed: null,
            homeCourtFranchiseId: null,
            challengerFranchiseId: null,
            homeCourtWins: 0,
            challengerWins: 0,
            games: [],
            winnerFranchiseId: null,
        },
        championFranchiseId: null,
    };
    return { ...state, bracket };
}
function bracketSeriesOrder(bracket: PlayoffBracket): PlayoffSeries[] {
    return [
        ...bracket.east.firstRound,
        ...bracket.east.semifinals,
        bracket.east.conferenceFinal,
        ...bracket.west.firstRound,
        ...bracket.west.semifinals,
        bracket.west.conferenceFinal,
        bracket.finals,
    ];
}
function findSeriesOrNull(bracket: PlayoffBracket | null, seriesId: string): PlayoffSeries | null {
    if (bracket === null)
        return null;
    return bracketSeriesOrder(bracket).find((series) => series.seriesId === seriesId) ?? null;
}
function replaceSeries(bracket: PlayoffBracket, seriesId: string, replacement: PlayoffSeries): PlayoffBracket {
    if (seriesId === 'finals') {
        return { ...bracket, finals: replacement };
    }
    const conference = seriesId.startsWith('east-') ? 'east' : 'west';
    const confBracket = conference === 'east' ? bracket.east : bracket.west;
    const updated = replaceConferenceSeries(confBracket, seriesId, replacement);
    return conference === 'east' ? { ...bracket, east: updated } : { ...bracket, west: updated };
}
function replaceConferenceSeries(confBracket: PlayoffConferenceBracket, seriesId: string, replacement: PlayoffSeries): PlayoffConferenceBracket {
    if (seriesId === `${confBracket.conference}-conference-final`) {
        return { ...confBracket, conferenceFinal: replacement };
    }
    const name = seriesId.slice(confBracket.conference.length + 1);
    if (name.startsWith('first-round-')) {
        const index = Number(name.slice('first-round-'.length)) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= confBracket.firstRound.length) {
            throw new SeasonPostseasonInvariantError(`unknown series ${seriesId}`);
        }
        return {
            ...confBracket,
            firstRound: confBracket.firstRound.map((series, i) => (i === index ? replacement : series)),
        };
    }
    if (name.startsWith('semifinal-')) {
        const index = Number(name.slice('semifinal-'.length)) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= confBracket.semifinals.length) {
            throw new SeasonPostseasonInvariantError(`unknown series ${seriesId}`);
        }
        return {
            ...confBracket,
            semifinals: confBracket.semifinals.map((series, i) => (i === index ? replacement : series)),
        };
    }
    throw new SeasonPostseasonInvariantError(`unknown series ${seriesId}`);
}
function winnerSeedOf(series: PlayoffSeries): number | null {
    const winner = series.winnerFranchiseId;
    if (winner === null || series.higherSeed === null || series.lowerSeed === null) {
        return null;
    }
    return winner === series.homeCourtFranchiseId ? series.higherSeed : series.lowerSeed;
}
function pairSeededSeries(slot: PlayoffSeries, sideA: {
    team: FranchiseId;
    seed: number | null;
}, sideB: {
    team: FranchiseId;
    seed: number | null;
}): PlayoffSeries {
    const aHigher = sideA.seed !== null && sideB.seed !== null && sideA.seed < sideB.seed;
    const homeSide = aHigher ? sideA : sideB;
    const awaySide = aHigher ? sideB : sideA;
    return {
        ...slot,
        homeCourtFranchiseId: homeSide.team,
        challengerFranchiseId: awaySide.team,
        higherSeed: homeSide.seed,
        lowerSeed: awaySide.seed,
    };
}
function advanceSeriesWinner(bracket: PlayoffBracket, seriesId: string, winner: string): PlayoffBracket {
    const winnerId = franchiseIdSchema.parse(winner);
    const conference = seriesId.startsWith('east-') ? 'east' : 'west';
    const confBracket = conference === 'east' ? bracket.east : bracket.west;
    if (seriesId.startsWith(`${conference}-first-round-`)) {
        const index = Number(seriesId.slice(`${conference}-first-round-`.length)) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= confBracket.firstRound.length) {
            throw new SeasonPostseasonInvariantError(`unknown series ${seriesId}`);
        }
        const semifinalIndex = Math.floor(index / 2);
        const semifinal = confBracket.semifinals[semifinalIndex];
        const feed = confBracket.firstRound[index];
        if (semifinal === undefined || feed === undefined) {
            throw new SeasonPostseasonInvariantError(`no semifinal slot for ${seriesId}`);
        }
        const side = index % 2 === 0 ? 'home' : 'away';
        const nextSlot: PlayoffSeries = side === 'home'
            ? { ...semifinal, homeCourtFranchiseId: winnerId }
            : { ...semifinal, challengerFranchiseId: winnerId };
        const otherIndex = index % 2 === 0 ? index + 1 : index - 1;
        const other = confBracket.firstRound[otherIndex];
        let paired = nextSlot;
        if (nextSlot.homeCourtFranchiseId !== null && nextSlot.challengerFranchiseId !== null) {
            if (other === undefined || other.winnerFranchiseId === null) {
                throw new SeasonPostseasonInvariantError(`first-round winner ${winnerId} cannot pair a semifinal`);
            }
            paired = pairSeededSeries(nextSlot, { team: winnerId, seed: winnerSeedOf(feed) }, { team: other.winnerFranchiseId, seed: winnerSeedOf(other) });
        }
        const confUpdated = {
            ...confBracket,
            semifinals: confBracket.semifinals.map((series, i) => i === semifinalIndex ? paired : series),
        };
        return conference === 'east'
            ? { ...bracket, east: confUpdated }
            : { ...bracket, west: confUpdated };
    }
    if (seriesId.startsWith(`${conference}-semifinal-`)) {
        const index = Number(seriesId.slice(`${conference}-semifinal-`.length)) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= confBracket.semifinals.length) {
            throw new SeasonPostseasonInvariantError(`unknown series ${seriesId}`);
        }
        const current = confBracket.semifinals[index];
        const other = confBracket.semifinals[index === 0 ? 1 : 0];
        if (current === undefined || other === undefined) {
            throw new SeasonPostseasonInvariantError(`no semifinal series for ${seriesId}`);
        }
        const side = index === 0 ? 'home' : 'away';
        const nextSlot: PlayoffSeries = side === 'home'
            ? { ...confBracket.conferenceFinal, homeCourtFranchiseId: winnerId }
            : { ...confBracket.conferenceFinal, challengerFranchiseId: winnerId };
        let paired = nextSlot;
        if (nextSlot.homeCourtFranchiseId !== null && nextSlot.challengerFranchiseId !== null) {
            if (other.winnerFranchiseId === null) {
                throw new SeasonPostseasonInvariantError(`semifinal winner ${winnerId} cannot pair the conference final`);
            }
            paired = pairSeededSeries(nextSlot, { team: winnerId, seed: winnerSeedOf(current) }, { team: other.winnerFranchiseId, seed: winnerSeedOf(other) });
        }
        const confUpdated = { ...confBracket, conferenceFinal: paired };
        return conference === 'east'
            ? { ...bracket, east: confUpdated }
            : { ...bracket, west: confUpdated };
    }
    if (seriesId === `${conference}-conference-final`) {
        return bracket;
    }
    throw new SeasonPostseasonInvariantError(`cannot advance unknown series ${seriesId}`);
}
export function decideSeasonFinalsHomeCourt(input: {
    league: SeasonLeague;
    standings: SeasonStandings;
    eastChampionFranchiseId: string;
    westChampionFranchiseId: string;
    drawSeed: string;
}): {
    homeCourtFranchiseId: string;
    resolution: SeasonTiebreakResolution;
} {
    const { league, standings } = input;
    const east = franchiseIdSchema.parse(input.eastChampionFranchiseId);
    const west = franchiseIdSchema.parse(input.westChampionFranchiseId);
    const rowOf = (franchiseId: FranchiseId) => standings.rows.find((row) => row.franchiseId === franchiseId);
    const eastRow = rowOf(east);
    const westRow = rowOf(west);
    if (eastRow === undefined || westRow === undefined) {
        throw new SeasonPostseasonInvariantError('finals home-court decision requires standings rows for both champions');
    }
    let homeCourtFranchiseId: FranchiseId;
    let rule: 'overall-record' | 'head-to-head' | 'points-differential' | 'random-draw';
    let evidence: SeasonTiebreakResolution['evidence'];
    const crossProduct = eastRow.wins * westRow.losses - westRow.wins * eastRow.losses;
    if (crossProduct > 0) {
        homeCourtFranchiseId = east;
        rule = 'overall-record';
        evidence = [
            {
                label: 'overall record',
                value: `${String(eastRow.wins)}-${String(eastRow.losses)} vs ${String(westRow.wins)}-${String(westRow.losses)}`,
            },
        ];
    }
    else if (crossProduct < 0) {
        homeCourtFranchiseId = west;
        rule = 'overall-record';
        evidence = [
            {
                label: 'overall record',
                value: `${String(westRow.wins)}-${String(westRow.losses)} vs ${String(eastRow.wins)}-${String(eastRow.losses)}`,
            },
        ];
    }
    else {
        const eastH2h = eastRow.headToHead.find((entry) => entry.franchiseId === west);
        const westH2h = westRow.headToHead.find((entry) => entry.franchiseId === east);
        if (eastH2h === undefined || westH2h === undefined) {
            throw new SeasonPostseasonInvariantError('finals home-court decision requires head-to-head records');
        }
        if (eastH2h.wins > westH2h.wins) {
            homeCourtFranchiseId = east;
            rule = 'head-to-head';
            evidence = [
                {
                    label: 'head-to-head record',
                    value: `${String(eastH2h.wins)}-${String(eastH2h.losses)}`,
                },
            ];
        }
        else if (eastH2h.wins < westH2h.wins) {
            homeCourtFranchiseId = west;
            rule = 'head-to-head';
            evidence = [
                {
                    label: 'head-to-head record',
                    value: `${String(westH2h.wins)}-${String(westH2h.losses)}`,
                },
            ];
        }
        else {
            const eastDifferential = eastRow.pointsFor - eastRow.pointsAgainst;
            const westDifferential = westRow.pointsFor - westRow.pointsAgainst;
            if (eastDifferential > westDifferential) {
                homeCourtFranchiseId = east;
                rule = 'points-differential';
                evidence = [{ label: 'points differential', value: eastDifferential }];
            }
            else if (eastDifferential < westDifferential) {
                homeCourtFranchiseId = west;
                rule = 'points-differential';
                evidence = [{ label: 'points differential', value: westDifferential }];
            }
            else {
                homeCourtFranchiseId = createRng(input.drawSeed).chance(0.5) ? east : west;
                rule = 'random-draw';
                evidence = [{ label: 'deciding rule', value: 'random-draw' }];
            }
        }
    }
    const challenger = homeCourtFranchiseId === east ? west : east;
    const resolution: SeasonTiebreakResolution = {
        resolutionId: idSchema.parse(`tb-finals-home-court-${seasonDigestHex([east, west, input.drawSeed, rule].join(' '))}`),
        conference: conferenceOf(league, homeCourtFranchiseId),
        kind: 'finals-home-court',
        rule,
        teams: [homeCourtFranchiseId, challenger],
        slots: [1],
        evidence,
        drawSeed: rule === 'random-draw' ? seedSchema.parse(input.drawSeed) : null,
    };
    return { homeCourtFranchiseId, resolution };
}
function pairFinals(bracket: PlayoffBracket, league: SeasonLeague, standings: SeasonStandings, drawSeed: string): {
    bracket: PlayoffBracket;
    resolution: SeasonTiebreakResolution;
} {
    const eastChamp = bracket.east.conferenceFinal.winnerFranchiseId;
    const westChamp = bracket.west.conferenceFinal.winnerFranchiseId;
    if (eastChamp === null || westChamp === null) {
        throw new SeasonPostseasonInvariantError('finals pairing requires both conference champions');
    }
    if (eastChamp === westChamp) {
        throw new SeasonPostseasonInvariantError('finals teams must come from different conferences');
    }
    const decision = decideSeasonFinalsHomeCourt({
        league,
        standings,
        eastChampionFranchiseId: eastChamp,
        westChampionFranchiseId: westChamp,
        drawSeed,
    });
    const homeCourtId = franchiseIdSchema.parse(decision.homeCourtFranchiseId);
    const challenger = homeCourtId === eastChamp ? westChamp : eastChamp;
    return {
        bracket: {
            ...bracket,
            finals: {
                ...bracket.finals,
                homeCourtFranchiseId: homeCourtId,
                challengerFranchiseId: challenger,
            },
        },
        resolution: decision.resolution,
    };
}
function applyPlayoffGameResult(state: SeasonPostseasonState, facts: SeasonPostseasonGameFacts, league: SeasonLeague, standings: SeasonStandings): SeasonPostseasonState {
    const bracket = state.bracket;
    if (bracket === null) {
        throw new SeasonPostseasonInvariantError('no playoff bracket exists');
    }
    const parsed = parsePlayoffGameId(facts.gameId);
    if (parsed === null) {
        throw new SeasonPostseasonInvariantError(`malformed playoff game id ${facts.gameId}`);
    }
    const { seriesId, gameNumber } = parsed;
    const series = findSeriesOrNull(bracket, seriesId);
    if (series === null) {
        throw new SeasonPostseasonInvariantError(`unknown series ${seriesId}`);
    }
    const homeCourt = series.homeCourtFranchiseId;
    const challenger = series.challengerFranchiseId;
    if (homeCourt === null || challenger === null) {
        throw new SeasonPostseasonInvariantError(`series ${seriesId} is not paired`);
    }
    if (series.winnerFranchiseId !== null) {
        throw new SeasonPostseasonInvariantError(`series ${seriesId} already has a winner`);
    }
    if (gameNumber !== series.games.length + 1) {
        throw new SeasonPostseasonInvariantError(`series ${seriesId} game ${String(gameNumber)} is out of sequence (expected ${String(series.games.length + 1)})`);
    }
    if (gameNumber > 7) {
        throw new SeasonPostseasonInvariantError(`series ${seriesId} cannot play more than seven games`);
    }
    const home = HOME_COURT_GAMES.has(gameNumber) ? homeCourt : challenger;
    const away = home === homeCourt ? challenger : homeCourt;
    if (home === away) {
        throw new SeasonPostseasonInvariantError(`series ${seriesId} cannot pair a team with itself`);
    }
    const winnerFranchiseId = franchiseIdSchema.parse(facts.winnerFranchiseId);
    const loserFranchiseId = franchiseIdSchema.parse(facts.loserFranchiseId);
    const teams = [home, away];
    if (!teams.includes(winnerFranchiseId) || !teams.includes(loserFranchiseId)) {
        throw new SeasonPostseasonInvariantError(`series ${seriesId} winner/loser must be participants`);
    }
    if (facts.status === 'final') {
        const homeScore = facts.homeScore;
        const awayScore = facts.awayScore;
        if (homeScore === null || awayScore === null || homeScore === awayScore) {
            throw new SeasonPostseasonInvariantError(`series ${seriesId} game ${String(gameNumber)} final must carry unequal scores`);
        }
        const homeWon = homeScore > awayScore;
        const expectedWinner = homeWon ? home : away;
        if (winnerFranchiseId !== expectedWinner) {
            throw new SeasonPostseasonInvariantError(`series ${seriesId} game ${String(gameNumber)} winner must match the score`);
        }
    }
    else if (facts.homeScore !== null || facts.awayScore !== null) {
        throw new SeasonPostseasonInvariantError(`series ${seriesId} forfeit carries no scores`);
    }
    const game: PlayoffSeriesGame = {
        gameId: facts.gameId,
        gameNumber,
        homeFranchiseId: home,
        awayFranchiseId: away,
        status: facts.status,
        homeScore: facts.status === 'final' ? facts.homeScore : null,
        awayScore: facts.status === 'final' ? facts.awayScore : null,
        winnerFranchiseId,
    };
    const homeCourtWins = series.homeCourtWins + (winnerFranchiseId === homeCourt ? 1 : 0);
    const challengerWins = series.challengerWins + (winnerFranchiseId === challenger ? 1 : 0);
    const completed = homeCourtWins === 4 || challengerWins === 4;
    const updatedSeries: PlayoffSeries = {
        ...series,
        homeCourtWins,
        challengerWins,
        games: [...series.games, game],
        winnerFranchiseId: completed ? winnerFranchiseId : null,
    };
    let updatedBracket = replaceSeries(bracket, seriesId, updatedSeries);
    let resolutions = state.tiebreakResolutions;
    if (completed && seriesId !== 'finals') {
        updatedBracket = advanceSeriesWinner(updatedBracket, seriesId, winnerFranchiseId);
        if (series.round === 'conference-final') {
            const eastChamp = updatedBracket.east.conferenceFinal.winnerFranchiseId;
            const westChamp = updatedBracket.west.conferenceFinal.winnerFranchiseId;
            if (eastChamp !== null &&
                westChamp !== null &&
                updatedBracket.finals.challengerFranchiseId === null) {
                const paired = pairFinals(updatedBracket, league, standings, state.finalsHomeCourtDrawSeed);
                updatedBracket = paired.bracket;
                resolutions = [...resolutions, paired.resolution];
            }
        }
    }
    const champion = completed && seriesId === 'finals' ? winnerFranchiseId : updatedBracket.championFranchiseId;
    return {
        ...state,
        tiebreakResolutions: resolutions,
        championFranchiseId: champion,
        bracket: { ...updatedBracket, championFranchiseId: champion },
    };
}
export function seasonPostseasonStageOf(state: SeasonPostseasonState): SeasonRunStage {
    if (state.championFranchiseId !== null)
        return 'completed';
    return state.bracket === null ? 'play-in' : 'playoffs';
}
function postseasonInjurySeed(rootSeed: string, ...keys: string[]): string {
    return seasonNamespaceSeed(rootSeed, SEASON_SEED_NAMESPACES.postseasonInjuries, ...keys);
}
function drawU32(seed: string): number {
    return drawHexInt(seed) >>> 0;
}
function drawBp(seed: string, thresholdBp: number): boolean {
    return drawU32(seed) % 10000 < thresholdBp;
}
function uniformInt(seed: string, min: number, max: number): number {
    return min + (drawU32(seed) % (max - min + 1));
}
export function rollPostseasonInjuryForPlayer(input: SeasonInjuryRollInput): SeasonInjuryRollResult {
    const riskBasisPoints = seasonInjuryRiskBasisPoints(input);
    const occurrenceSeed = postseasonInjurySeed(input.rootSeed, input.gameId, input.playerVersionId, 'occurrence');
    if (!drawBp(occurrenceSeed, riskBasisPoints)) {
        return {
            riskBasisPoints,
            occurred: false,
            removalClock: null,
            returnClock: null,
            injury: null,
        };
    }
    const severitySeed = postseasonInjurySeed(input.rootSeed, input.gameId, input.playerVersionId, 'severity');
    const severityRoll = drawU32(severitySeed) % 10000;
    const severity: SeasonInjurySeverity = severityRoll < SEASON_INJURY_MINOR_BP
        ? 'minor'
        : severityRoll < SEASON_INJURY_MODERATE_BP
            ? 'moderate'
            : severityRoll < SEASON_INJURY_MAJOR_BP
                ? 'major'
                : 'season-ending';
    const typeSeed = postseasonInjurySeed(input.rootSeed, input.gameId, input.playerVersionId, 'type');
    const type = POSTSEASON_INJURY_TYPES[uniformInt(typeSeed, 0, POSTSEASON_INJURY_TYPES.length - 1)] ??
        'lower-body';
    const clockSeed = postseasonInjurySeed(input.rootSeed, input.gameId, input.playerVersionId, 'clock');
    const exposureSeconds = uniformInt(clockSeed, 0, Math.min(Math.max(0, input.targetMinutes) * 60, REGULATION_TOTAL_SECONDS));
    const removalClock = clockFromTipoffSeconds(exposureSeconds);
    const occurredBeforeHalftime = exposureSeconds < HALFTIME_SECOND;
    const sameGameReturnSeed = postseasonInjurySeed(input.rootSeed, input.gameId, input.playerVersionId, 'same-game-return');
    const sameGameReturn = severity === 'minor' &&
        occurredBeforeHalftime &&
        drawBp(sameGameReturnSeed, SEASON_INJURY_SAME_GAME_RETURN_BP);
    const returnSeed = postseasonInjurySeed(input.rootSeed, input.gameId, input.playerVersionId, 'return');
    let returnClock: {
        period: number;
        seconds: number;
    } | null = null;
    let missedGamesTotal = 0;
    if (sameGameReturn) {
        returnClock = clockFromTipoffSeconds(uniformInt(returnSeed, HALFTIME_SECOND, REGULATION_TOTAL_SECONDS));
    }
    else if (severity === 'season-ending') {
        missedGamesTotal = SEASON_ENDING_MISSED_GAMES_SENTINEL;
    }
    else {
        const range = SEASON_INJURY_RECOVERY_RANGES[severity];
        missedGamesTotal = uniformInt(returnSeed, range[0], range[1]);
    }
    const seedPath = [
        SEASON_SEED_NAMESPACES.postseasonInjuries,
        input.gameId,
        input.playerVersionId,
        'occurrence',
    ];
    const injury: SeasonInjuryRecord = {
        injuryId: seasonInjuryIdOf(seedPath),
        playerVersionId: input.playerVersionId,
        franchiseId: franchiseIdSchema.parse(input.franchiseId),
        gameId: input.gameId,
        type,
        severity,
        occurredBeforeHalftime,
        sameGameReturn,
        sameGameReturned: null,
        missedGamesTotal,
        missedGamesRemaining: missedGamesTotal,
        actualReturnRound: null,
        seasonEnding: severity === 'season-ending',
        rehabModifier: 0,
        recurrenceWindowRoundsRemaining: 0,
        seedPath,
    };
    return { riskBasisPoints, occurred: true, removalClock, returnClock, injury };
}
export function rollPostseasonRehabOutcome(rootSeed: string, injuryId: string): 'success' | 'failure' {
    const seed = postseasonInjurySeed(rootSeed, injuryId, 'rehab');
    return drawBp(seed, SEASON_INJURY_REHAB_SUCCESS_BP) ? 'success' : 'failure';
}
function postseasonGameHealthSeam(input: {
    run: SeasonRun;
    health: SeasonHealthState;
    gameId: string;
    round: number;
    homeFranchiseId: string;
    awayFranchiseId: string;
    targetMinutesByPlayer: ReadonlyMap<string, number>;
    durabilityByPlayer?: ReadonlyMap<string, number>;
    effects?: SeasonEffectsState;
}): {
    pregame: ReadonlyMap<string, boolean>;
    removals: readonly {
        playerVersionId: string;
        clock: {
            period: number;
            seconds: number;
        };
        reason: 'injury';
    }[];
    returns: readonly {
        playerVersionId: string;
        clock: {
            period: number;
            seconds: number;
        };
        reason: 'injury-return';
    }[];
    newInjuries: readonly SeasonInjuryRecord[];
} {
    const rosterByFranchise = new Map(input.run.rosters.map((roster) => [roster.franchiseId, roster]));
    const fatigueOf = new Map<string, number>();
    const loadOf = new Map<string, number>();
    for (const player of input.effects?.playerStates ?? []) {
        fatigueOf.set(player.playerVersionId, player.fatigueBasisPoints);
        loadOf.set(player.playerVersionId, player.recentLoadBasisPoints);
    }
    const recurrenceOf = new Map<string, number>();
    for (const record of input.health.injuries) {
        const current = recurrenceOf.get(record.playerVersionId) ?? 0;
        if (record.recurrenceWindowRoundsRemaining > current) {
            recurrenceOf.set(record.playerVersionId, record.recurrenceWindowRoundsRemaining);
        }
    }
    const pregame = new Map<string, boolean>();
    const removals: {
        playerVersionId: string;
        clock: {
            period: number;
            seconds: number;
        };
        reason: 'injury';
    }[] = [];
    const returns: {
        playerVersionId: string;
        clock: {
            period: number;
            seconds: number;
        };
        reason: 'injury-return';
    }[] = [];
    const newInjuries: SeasonInjuryRecord[] = [];
    for (const franchiseId of [input.homeFranchiseId, input.awayFranchiseId]) {
        const franchiseKey = franchiseIdSchema.parse(franchiseId);
        const roster = rosterByFranchise.get(franchiseKey);
        if (roster === undefined) {
            throw new SeasonPostseasonInvariantError(`game ${input.gameId} references roster ${franchiseId}`);
        }
        for (const player of roster.players) {
            const available = seasonPlayerAvailable(input.health, player.playerVersionId);
            pregame.set(player.playerVersionId, available);
            const targetMinutes = input.targetMinutesByPlayer.get(player.playerVersionId) ?? 0;
            if (targetMinutes <= 0 || !available)
                continue;
            const roll = rollPostseasonInjuryForPlayer({
                rootSeed: input.run.rootSeed,
                gameId: input.gameId,
                playerVersionId: player.playerVersionId,
                franchiseId,
                durabilityRating: input.durabilityByPlayer?.get(player.playerVersionId) ?? 45,
                fatigueBasisPoints: fatigueOf.get(player.playerVersionId) ?? 0,
                recentLoadBasisPoints: loadOf.get(player.playerVersionId) ?? 0,
                targetMinutes,
                recurrenceWindowRoundsRemaining: recurrenceOf.get(player.playerVersionId) ?? 0,
            });
            if (!roll.occurred || roll.injury === null)
                continue;
            newInjuries.push(roll.injury);
            if (roll.removalClock !== null) {
                removals.push({
                    playerVersionId: player.playerVersionId,
                    clock: { period: roll.removalClock.period, seconds: roll.removalClock.seconds },
                    reason: 'injury',
                });
            }
            if (roll.returnClock !== null && roll.injury.sameGameReturn) {
                returns.push({
                    playerVersionId: player.playerVersionId,
                    clock: { period: roll.returnClock.period, seconds: roll.returnClock.seconds },
                    reason: 'injury-return',
                });
            }
        }
    }
    return { pregame, removals, returns, newInjuries };
}
export type SeasonPostseasonGameResolver = (input: {
    gameId: string;
    gameInput: SeasonGameSimulationInput;
    pregameEffects: SeasonEffectsState;
}) => {
    result: SeasonGameSimulationResult;
    transition: SeasonGameEffectsTransition;
};
export function defaultSeasonPostseasonGameResolver(input: {
    gameId: string;
    gameInput: SeasonGameSimulationInput;
    pregameEffects: SeasonEffectsState;
}): {
    result: SeasonGameSimulationResult;
    transition: SeasonGameEffectsTransition;
} {
    return simulateSeasonGameWithEffects(input.gameInput, createEngineContext(), input.pregameEffects);
}
export function zeroSeasonGameTransition(effects: SeasonEffectsState): SeasonGameEffectsTransition {
    return {
        schemaVersion: 1,
        pregamePlayerStates: [...effects.playerStates],
        postgamePlayerStates: [...effects.playerStates],
        pairIncrements: [],
        evidence: [],
    };
}
export type SeasonPostseasonGameOutcome = {
    kind: 'simulated';
    facts: SeasonPostseasonGameFacts;
    summary: SeasonPostseasonSummary;
    nextHealth: SeasonHealthState;
    nextEffects: SeasonEffectsState;
} | {
    kind: 'integrity-failure';
    reason: string;
};
export interface SeasonPostseasonGameSimulationInput {
    run: SeasonRun;
    effects: SeasonEffectsState;
    expanded: ReadonlyMap<string, SeasonGamePlayerInput>;
    catalog: SeasonDraftCatalog;
    profile: EraSimulationProfile;
    gameId: string;
    humanFranchiseId: string | null;
}
export function simulateSeasonPostseasonGame(input: SeasonPostseasonGameSimulationInput, options: {
    resolver?: SeasonPostseasonGameResolver;
} = {}): SeasonPostseasonGameOutcome {
    const { run, effects, catalog, profile, gameId, humanFranchiseId } = input;
    const phase = postseasonPhaseOfGameId(gameId);
    const teams = seasonPostseasonGameTeamsOf(run.postseason, gameId);
    if (teams === null) {
        return {
            kind: 'integrity-failure',
            reason: `game ${gameId} is not scheduleable from the current postseason state`,
        };
    }
    const homeId = teams.home;
    const awayId = teams.away;
    const homeRoster = run.rosters.find((roster) => roster.franchiseId === homeId);
    const awayRoster = run.rosters.find((roster) => roster.franchiseId === awayId);
    const homeRotation = run.rotations.find((rotation) => rotation.franchiseId === homeId);
    const awayRotation = run.rotations.find((rotation) => rotation.franchiseId === awayId);
    if (homeRoster === undefined ||
        awayRoster === undefined ||
        homeRotation === undefined ||
        awayRotation === undefined) {
        return {
            kind: 'integrity-failure',
            reason: `game ${gameId} references a roster or rotation outside the run`,
        };
    }
    const homePlayers = homeRoster.players.map((player) => expandedPlayer(input, player.playerVersionId));
    const awayPlayers = awayRoster.players.map((player) => expandedPlayer(input, player.playerVersionId));
    const seed = seasonNamespaceSeed(run.rootSeed, phase === 'play-in' ? SEASON_SEED_NAMESPACES.playInGames : SEASON_SEED_NAMESPACES.playoffGames, gameId);
    const positions = new Map<string, readonly Position[]>();
    const targetMinutes = new Map<string, number>();
    for (const player of [...homePlayers, ...awayPlayers]) {
        positions.set(player.playerVersionId, player.positions);
    }
    for (const rotation of [homeRotation, awayRotation]) {
        for (const entry of rotation.targetMinutes) {
            targetMinutes.set(entry.playerVersionId, entry.minutes);
        }
    }
    const durability = new Map<string, number>();
    for (const candidate of catalog.candidates) {
        durability.set(candidate.playerVersionId, candidate.durability.rating);
    }
    const homeLegalFacts = seasonFranchiseLegalFiveFacts(run, homeId, run.health, positions);
    const awayLegalFacts = seasonFranchiseLegalFiveFacts(run, awayId, run.health, positions);
    if (humanFranchiseId !== null &&
        ((homeId === humanFranchiseId && !homeLegalFacts.legal) ||
            (awayId === humanFranchiseId && !awayLegalFacts.legal))) {
        return {
            kind: 'integrity-failure',
            reason: `the human franchise ${humanFranchiseId} cannot field a legal five for ${gameId}; the caller must return the rotation decision instead`,
        };
    }
    if (!homeLegalFacts.legal && !awayLegalFacts.legal) {
        return {
            kind: 'integrity-failure',
            reason: `game ${gameId} has no legal five on either side; refusing to fabricate a winner`,
        };
    }
    const forfeitPending = !homeLegalFacts.legal || !awayLegalFacts.legal;
    const ordinal = seasonPostseasonGameOrdinal(gameId);
    const round = SEASON_ROUND_COUNT;
    const pregame = effects;
    const seam = forfeitPending
        ? {
            pregame: seasonPregameAvailabilityOf(run.health, [...homePlayers, ...awayPlayers]),
            removals: [] as {
                playerVersionId: string;
                clock: {
                    period: number;
                    seconds: number;
                };
                reason: 'injury';
            }[],
            returns: [] as {
                playerVersionId: string;
                clock: {
                    period: number;
                    seconds: number;
                };
                reason: 'injury-return';
            }[],
            newInjuries: [] as SeasonInjuryRecord[],
        }
        : postseasonGameHealthSeam({
            run,
            health: run.health,
            gameId,
            round,
            homeFranchiseId: homeId,
            awayFranchiseId: awayId,
            targetMinutesByPlayer: targetMinutes,
            durabilityByPlayer: durability,
            effects: pregame,
        });
    const gameInput: SeasonGameSimulationInput = {
        schemaVersion: 1,
        seed,
        gameNumber: ordinal,
        dataVersion: catalog.dataVersion,
        profile,
        home: {
            teamId: homeId,
            displayName: homeId,
            franchiseId: franchiseIdSchema.parse(homeId),
            players: homePlayers,
        },
        away: {
            teamId: awayId,
            displayName: awayId,
            franchiseId: franchiseIdSchema.parse(awayId),
            players: awayPlayers,
        },
        homeRotation,
        awayRotation,
        availability: [...homePlayers, ...awayPlayers].map((player) => ({
            playerVersionId: player.playerVersionId,
            available: seam.pregame.get(player.playerVersionId) ?? true,
        })),
        removals: seam.removals.map((removal) => ({
            side: sideOfPlayer(homeRoster, awayRoster, removal.playerVersionId),
            playerVersionId: removal.playerVersionId,
            period: removal.clock.period,
            secondsRemaining: removal.clock.seconds,
            reason: 'injury' as const,
        })),
        returns: seam.returns.map((ret) => ({
            side: sideOfPlayer(homeRoster, awayRoster, ret.playerVersionId),
            playerVersionId: ret.playerVersionId,
            period: ret.clock.period,
            secondsRemaining: ret.clock.seconds,
            reason: 'injury-return' as const,
        })),
        homeCourt: SEASON_HOME_COURT_PROFILE,
    };
    const resolver = options.resolver ?? defaultSeasonPostseasonGameResolver;
    const { result, transition } = resolver({ gameId, gameInput, pregameEffects: pregame });
    if (result.seed !== seed) {
        throw new SeasonPostseasonInvariantError(`game ${gameId} result seed ${result.seed} does not match the derived seed ${seed}`);
    }
    if (result.outcome === 'no-legal-five-both') {
        return {
            kind: 'integrity-failure',
            reason: `game ${gameId} has no legal five on either side (seed ${seed}); refusing to fabricate a winner`,
        };
    }
    const nextEffects = applySeasonGameEffectsTransition(pregame, transition);
    const sameGameReturned = sameGameReturnResolutionsOf(seam.newInjuries, result);
    const nextHealth = applySeasonGameHealthTransition(run.health, {
        gameId,
        round,
        franchises: [homeId, awayId],
        newInjuries: seam.newInjuries,
        sameGameReturned,
    });
    const injuryEvents = compactPostseasonInjuryEvents({
        homeRoster,
        awayRoster,
        seam,
        result,
    });
    const factsOf = roundFactsOf(run.postseason, run.league, gameId);
    const summary = seasonPostseasonSummaryFromGame({
        runId: run.runId,
        gameId,
        phase,
        round: factsOf.round,
        seriesId: factsOf.seriesId,
        gameNumber: factsOf.gameNumber,
        conference: factsOf.conference,
        homeFranchiseId: homeId,
        awayFranchiseId: awayId,
        result,
        injuryEvents,
    });
    let parsedSummary: SeasonPostseasonSummary;
    try {
        parsedSummary = seasonPostseasonSummarySchema.parse(summary);
    }
    catch (error) {
        throw new SeasonPostseasonInvariantError(`game ${gameId} summary fails the schema: ${error instanceof Error ? error.message : 'unknown'}`);
    }
    const winner = result.outcome === 'forfeit'
        ? result.losingFranchiseId === homeId
            ? awayId
            : homeId
        : result.winner === 'home'
            ? homeId
            : awayId;
    const loser = result.outcome === 'forfeit' ? result.losingFranchiseId : winner === homeId ? awayId : homeId;
    return {
        kind: 'simulated',
        facts: {
            gameId,
            status: result.outcome === 'forfeit' ? 'forfeit' : 'final',
            winnerFranchiseId: winner,
            loserFranchiseId: loser,
            homeScore: result.outcome === 'forfeit' ? null : result.home.score,
            awayScore: result.outcome === 'forfeit' ? null : result.away.score,
        },
        summary: parsedSummary,
        nextHealth,
        nextEffects,
    };
}
function expandedPlayer(input: SeasonPostseasonGameSimulationInput, playerVersionId: string): SeasonGamePlayerInput {
    const player = input.expanded.get(playerVersionId);
    if (player === undefined) {
        throw new SeasonPostseasonInvariantError(`game ${input.gameId} references an unexpanded version ${playerVersionId}`);
    }
    return player;
}
function sideOfPlayer(homeRoster: SeasonRun['rosters'][number], awayRoster: SeasonRun['rosters'][number], playerVersionId: string): 'home' | 'away' {
    if (homeRoster.players.some((player) => player.playerVersionId === playerVersionId)) {
        return 'home';
    }
    if (awayRoster.players.some((player) => player.playerVersionId === playerVersionId)) {
        return 'away';
    }
    throw new SeasonPostseasonInvariantError(`version ${playerVersionId} plays neither side of the game`);
}
function sameGameReturnResolutionsOf(newInjuries: readonly SeasonInjuryRecord[], result: SeasonGameSimulationResult): {
    injuryId: string;
    returned: boolean;
}[] {
    const candidates = newInjuries.filter((record) => record.sameGameReturn);
    if (candidates.length === 0)
        return [];
    const returnedIds = new Set<string>();
    if (result.outcome === 'completed') {
        for (const side of [result.home, result.away]) {
            for (const ret of side.returns)
                returnedIds.add(ret.playerVersionId);
        }
    }
    return candidates.map((record) => ({
        injuryId: record.injuryId,
        returned: returnedIds.has(record.playerVersionId),
    }));
}
function compactPostseasonInjuryEvents(input: {
    homeRoster: SeasonRun['rosters'][number];
    awayRoster: SeasonRun['rosters'][number];
    seam: ReturnType<typeof postseasonGameHealthSeam>;
    result: SeasonGameSimulationResult;
}): SeasonCompactInjuryEvent[] {
    if (input.seam.newInjuries.length === 0)
        return [];
    const appliedRemovalByPlayer = new Map<string, {
        period: number;
        seconds: number;
    }>();
    const appliedReturnByPlayer = new Map<string, {
        period: number;
        seconds: number;
    }>();
    if (input.result.outcome === 'completed') {
        for (const event of input.result.removals) {
            appliedRemovalByPlayer.set(event.playerVersionId, {
                period: event.period,
                seconds: event.secondsRemaining,
            });
        }
        for (const side of [input.result.home, input.result.away]) {
            for (const event of side.returns) {
                appliedReturnByPlayer.set(event.playerVersionId, {
                    period: event.period,
                    seconds: event.secondsRemaining,
                });
            }
        }
    }
    const rolledRemovalByPlayer = new Map(input.seam.removals.map((removal) => [removal.playerVersionId, removal.clock]));
    return input.seam.newInjuries.map((record) => {
        const appliedRemoval = appliedRemovalByPlayer.get(record.playerVersionId);
        const rolledRemoval = rolledRemovalByPlayer.get(record.playerVersionId);
        const removedClock = appliedRemoval ?? rolledRemoval ?? { period: 1, seconds: 720 };
        const appliedReturn = appliedReturnByPlayer.get(record.playerVersionId);
        return {
            playerVersionId: record.playerVersionId,
            side: sideOfPlayer(input.homeRoster, input.awayRoster, record.playerVersionId),
            type: record.type,
            severity: record.severity,
            removedClock,
            returned: appliedReturn !== undefined,
            returnClock: appliedReturn ?? null,
        };
    });
}
function roundFactsOf(state: SeasonPostseasonState, league: SeasonLeague, gameId: string): {
    phase: 'play-in' | 'playoffs';
    round: SeasonPostseasonSummary['round'];
    seriesId: string | null;
    gameNumber: number;
    conference: ConferenceId;
} {
    if (postseasonPhaseOfGameId(gameId) === 'play-in') {
        const parsed = parsePlayInGameId(gameId);
        if (parsed === null) {
            throw new SeasonPostseasonInvariantError(`malformed play-in game id ${gameId}`);
        }
        return {
            phase: 'play-in',
            round: parsed.matchup,
            seriesId: null,
            gameNumber: 1,
            conference: parsed.conference,
        };
    }
    const parsed = parsePlayoffGameId(gameId);
    if (parsed === null) {
        throw new SeasonPostseasonInvariantError(`malformed playoff game id ${gameId}`);
    }
    const series = findSeriesOrNull(state.bracket, parsed.seriesId);
    if (series === null) {
        throw new SeasonPostseasonInvariantError(`unknown series ${parsed.seriesId}`);
    }
    const teams = seasonPostseasonGameTeamsOf(state, gameId);
    const conference = series.round === 'finals'
        ? conferenceOf(league, teams?.home ?? series.homeCourtFranchiseId ?? '')
        : (series.conference ?? 'east');
    return {
        phase: 'playoffs',
        round: series.round,
        seriesId: series.seriesId,
        gameNumber: parsed.gameNumber,
        conference,
    };
}
export function seasonPostseasonSummaryFromGame(input: {
    runId: string;
    gameId: string;
    phase: 'play-in' | 'playoffs';
    round: SeasonPostseasonSummary['round'];
    seriesId: string | null;
    gameNumber: number;
    conference: ConferenceId;
    homeFranchiseId: string;
    awayFranchiseId: string;
    result: SeasonGameSimulationResult;
    injuryEvents: readonly SeasonCompactInjuryEvent[];
}): SeasonPostseasonSummary {
    const homeId = franchiseIdSchema.parse(input.homeFranchiseId);
    const awayId = franchiseIdSchema.parse(input.awayFranchiseId);
    const seasonSummary = seasonGameSummaryFromResult(input.result, {
        gameId: seasonGameIdSchema.parse('s000001'),
        round: 1,
        homeFranchiseId: homeId,
        awayFranchiseId: awayId,
    }, undefined, input.injuryEvents);
    const homeWon = seasonSummary.homeScore > seasonSummary.awayScore;
    const winnerRaw = seasonSummary.status === 'forfeit'
        ? seasonSummary.forfeitLoserFranchiseId === homeId
            ? input.awayFranchiseId
            : input.homeFranchiseId
        : homeWon
            ? input.homeFranchiseId
            : input.awayFranchiseId;
    const loserRaw = seasonSummary.status === 'forfeit'
        ? (seasonSummary.forfeitLoserFranchiseId ?? winnerRaw)
        : homeWon
            ? input.awayFranchiseId
            : input.homeFranchiseId;
    const winnerFranchiseId = franchiseIdSchema.parse(winnerRaw);
    const loserFranchiseId = franchiseIdSchema.parse(loserRaw);
    const homeSubstitutions = input.result.outcome === 'completed'
        ? input.result.substitutions.filter((sub) => sub.side === 'home').length
        : 0;
    const awaySubstitutions = input.result.outcome === 'completed'
        ? input.result.substitutions.filter((sub) => sub.side === 'away').length
        : 0;
    const summary: SeasonPostseasonSummary = {
        schemaVersion: 1,
        summaryVersion: SEASON_POSTSEASON_SUMMARY_VERSION,
        runId: input.runId,
        gameId: input.gameId,
        phase: input.phase,
        round: input.round,
        seriesId: input.seriesId,
        gameNumber: input.gameNumber,
        conference: input.conference,
        homeFranchiseId: homeId,
        awayFranchiseId: awayId,
        winnerFranchiseId,
        loserFranchiseId,
        status: seasonSummary.status,
        homeScore: seasonSummary.homeScore,
        awayScore: seasonSummary.awayScore,
        forfeitLoserFranchiseId: seasonSummary.forfeitLoserFranchiseId,
        homeBox: seasonSummary.homeBox,
        awayBox: seasonSummary.awayBox,
        homePlayers: seasonSummary.homePlayers,
        awayPlayers: seasonSummary.awayPlayers,
        rotationEvidence: {
            home: {
                playersUsed: seasonSummary.homePlayers.filter((line) => line.seconds > 0).length,
                substitutions: homeSubstitutions,
            },
            away: {
                playersUsed: seasonSummary.awayPlayers.filter((line) => line.seconds > 0).length,
                substitutions: awaySubstitutions,
            },
        },
        injuryEvents: [...seasonSummary.injuryEvents],
        resultDigest: '',
    };
    return { ...summary, resultDigest: seasonPostseasonSummaryDigest(summary) };
}
