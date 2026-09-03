import { describe, expect, it } from 'vitest';
import { SEASON_POSTSEASON_VERSION, fnv1a32, parsePlayoffGameId, playInGameIdOf, playInStateSchema, playoffBracketSchema, playoffGameIdOf, playoffSeriesSchema, postseasonGameIdSchema, postseasonPhaseOfGameId, seasonPostseasonStateSchema, type ConferenceId, type PlayInGame, type PlayInMatchupId, type PlayInState, type PlayoffBracket, type PlayoffConferenceBracket, type PlayoffRound, type PlayoffSeries, type SeasonPostseasonState, } from './index.ts';
import { buildPostseason, CONFERENCE_TEAMS, SEED } from './season-schemas-fixtures.ts';
export interface PlayInOutcome {
    status: 'final' | 'forfeit';
    winner: 'home' | 'away';
}
export const PLAY_IN_RESULT_OUTCOMES: readonly PlayInOutcome[] = [
    { status: 'final', winner: 'home' },
    { status: 'final', winner: 'away' },
    { status: 'forfeit', winner: 'home' },
    { status: 'forfeit', winner: 'away' },
];
export type WinnerSide = 'home' | 'away';
function must<T>(value: T | null | undefined, message: string): T {
    if (value === null || value === undefined)
        throw new Error(message);
    return value;
}
export function seededRanking(conference: ConferenceId, seed: string): string[] {
    const teams = [...CONFERENCE_TEAMS[conference]];
    teams.sort((a, b) => fnv1a32(`${seed}\u0000${conference}\u0000${a}`) -
        fnv1a32(`${seed}\u0000${conference}\u0000${b}`));
    return teams.slice(0, 10);
}
function scheduledPlayInGame(gameId: string): PlayInGame {
    return {
        gameId,
        status: 'scheduled',
        homeFranchiseId: null,
        awayFranchiseId: null,
        winnerFranchiseId: null,
        loserFranchiseId: null,
        homeScore: null,
        awayScore: null,
    };
}
export function resultPlayInGame(gameId: string, home: string, away: string, outcome: PlayInOutcome): PlayInGame {
    const winner = outcome.winner === 'home' ? home : away;
    const loser = winner === home ? away : home;
    return {
        gameId,
        status: outcome.status,
        homeFranchiseId: home,
        awayFranchiseId: away,
        winnerFranchiseId: winner,
        loserFranchiseId: loser,
        homeScore: outcome.status === 'final' ? (winner === home ? 100 : 90) : null,
        awayScore: outcome.status === 'final' ? (winner === away ? 100 : 90) : null,
    };
}
export interface PlayInOutcomes {
    sevenEight?: PlayInOutcome;
    nineTen?: PlayInOutcome;
    final?: PlayInOutcome;
}
export function buildPlayInState(conference: ConferenceId, ranking: string[], outcomes: PlayInOutcomes = {}): PlayInState {
    if (ranking.length !== 10) {
        throw new Error(`play-in ranking must list exactly 10 teams, got ${String(ranking.length)}`);
    }
    const { sevenEight, nineTen, final: finalOutcome } = outcomes;
    if (finalOutcome !== undefined && (sevenEight === undefined || nineTen === undefined)) {
        throw new Error('the play-in final cannot be resolved before both seven-eight and nine-ten');
    }
    const seed = (position: number): string => must(ranking[position - 1], `play-in ranking missing seed ${String(position)}`);
    const games = {
        sevenEight: sevenEight === undefined
            ? scheduledPlayInGame(playInGameIdOf(conference, 'seven-eight'))
            : resultPlayInGame(playInGameIdOf(conference, 'seven-eight'), seed(7), seed(8), sevenEight),
        nineTen: nineTen === undefined
            ? scheduledPlayInGame(playInGameIdOf(conference, 'nine-ten'))
            : resultPlayInGame(playInGameIdOf(conference, 'nine-ten'), seed(9), seed(10), nineTen),
    };
    const final = finalOutcome === undefined
        ? scheduledPlayInGame(playInGameIdOf(conference, 'final'))
        : resultPlayInGame(playInGameIdOf(conference, 'final'), must(games.sevenEight.loserFranchiseId, 'the final home (seven-eight loser) is unresolved'), must(games.nineTen.winnerFranchiseId, 'the final away (nine-ten winner) is unresolved'), finalOutcome);
    const playoffSeeds = finalOutcome === undefined
        ? null
        : [
            ...ranking.slice(0, 6),
            must(games.sevenEight.winnerFranchiseId, 'seven-eight winner unresolved'),
            must(final.winnerFranchiseId, 'final winner unresolved'),
        ];
    return {
        conference,
        ranking,
        games: { sevenEight: games.sevenEight, nineTen: games.nineTen, final },
        playoffSeeds,
    };
}
export function buildFullPlayInState(conference: ConferenceId, ranking: string[], outcomes: PlayInOutcomes = {}): PlayInState {
    return buildPlayInState(conference, ranking, {
        sevenEight: outcomes.sevenEight ?? { status: 'final', winner: 'home' },
        nineTen: outcomes.nineTen ?? { status: 'final', winner: 'home' },
        final: outcomes.final ?? { status: 'final', winner: 'home' },
    });
}
export interface SeriesSlotOptions {
    round?: PlayoffRound;
    conference?: ConferenceId | null;
    higherSeed?: number | null;
    lowerSeed?: number | null;
}
export interface SeriesBuildOptions extends SeriesSlotOptions {
    winnerSide?: WinnerSide;
    homeCourtWins?: number;
    challengerWins?: number;
}
export function canonicalSeriesMask(winnerSide: WinnerSide, homeCourtWins: number, challengerWins: number): boolean[] {
    if (homeCourtWins !== 4 && challengerWins !== 4) {
        throw new Error('a completed series mask requires one side with four wins');
    }
    const winnerWins = winnerSide === 'home' ? homeCourtWins : challengerWins;
    if (winnerWins !== 4)
        throw new Error('the winner side must hold the four wins');
    const loserWins = winnerSide === 'home' ? challengerWins : homeCourtWins;
    const total = 4 + loserWins;
    const mask = new Array<boolean>(total).fill(winnerSide === 'home');
    const loserGames = [3, 4, 6].filter((game) => game <= total).slice(0, loserWins);
    for (const game of loserGames) {
        mask[game - 1] = winnerSide !== 'home';
    }
    return mask;
}
export function buildSeriesGames(seriesId: string, homeCourtFranchiseId: string, challengerFranchiseId: string, mask: readonly boolean[]): PlayoffSeries['games'] {
    return mask.map((homeWon, index) => {
        const gameNumber = index + 1;
        const atHomeCourt = gameNumber === 1 || gameNumber === 2 || gameNumber === 5 || gameNumber === 7;
        const homeFranchiseId = atHomeCourt ? homeCourtFranchiseId : challengerFranchiseId;
        const awayFranchiseId = atHomeCourt ? challengerFranchiseId : homeCourtFranchiseId;
        const winnerFranchiseId = homeWon ? homeCourtFranchiseId : challengerFranchiseId;
        return {
            gameId: playoffGameIdOf(seriesId, gameNumber),
            gameNumber,
            homeFranchiseId,
            awayFranchiseId,
            status: 'final',
            homeScore: homeFranchiseId === winnerFranchiseId ? 100 : 90,
            awayScore: awayFranchiseId === winnerFranchiseId ? 100 : 90,
            winnerFranchiseId,
        };
    });
}
export function buildSeriesFromMask(seriesId: string, homeCourtFranchiseId: string, challengerFranchiseId: string, mask: readonly boolean[], opts: SeriesSlotOptions = {}): PlayoffSeries {
    const homeCourtWins = mask.filter((won) => won).length;
    const challengerWins = mask.length - homeCourtWins;
    if (homeCourtWins !== 4 && challengerWins !== 4) {
        throw new Error('a completed series mask must include four wins for one side');
    }
    return {
        seriesId,
        round: opts.round ?? 'first-round',
        conference: opts.conference ?? null,
        higherSeed: opts.higherSeed ?? null,
        lowerSeed: opts.lowerSeed ?? null,
        homeCourtFranchiseId,
        challengerFranchiseId,
        homeCourtWins,
        challengerWins,
        games: buildSeriesGames(seriesId, homeCourtFranchiseId, challengerFranchiseId, mask),
        winnerFranchiseId: homeCourtWins === 4 ? homeCourtFranchiseId : challengerFranchiseId,
    };
}
export function buildCompletedSeries(seriesId: string, homeCourtFranchiseId: string, challengerFranchiseId: string, opts: SeriesBuildOptions = {}): PlayoffSeries {
    const winnerSide = opts.winnerSide ?? 'home';
    const homeCourtWins = opts.homeCourtWins ?? 4;
    const challengerWins = opts.challengerWins ?? 1;
    const mask = canonicalSeriesMask(winnerSide, homeCourtWins, challengerWins);
    return buildSeriesFromMask(seriesId, homeCourtFranchiseId, challengerFranchiseId, mask, opts);
}
export function buildSeriesPrefix(seriesId: string, homeCourtFranchiseId: string, challengerFranchiseId: string, mask: readonly boolean[], length: number, opts: SeriesSlotOptions & {
    nameWinner?: boolean;
} = {}): PlayoffSeries {
    if (length < 0 || length > mask.length) {
        throw new Error('series prefix length out of range');
    }
    const prefix = mask.slice(0, length);
    const homeCourtWins = prefix.filter((won) => won).length;
    const challengerWins = prefix.length - homeCourtWins;
    const winnerFranchiseId = homeCourtWins === 4
        ? homeCourtFranchiseId
        : challengerWins === 4
            ? challengerFranchiseId
            : null;
    return {
        seriesId,
        round: opts.round ?? 'first-round',
        conference: opts.conference ?? null,
        higherSeed: opts.higherSeed ?? null,
        lowerSeed: opts.lowerSeed ?? null,
        homeCourtFranchiseId,
        challengerFranchiseId,
        homeCourtWins,
        challengerWins,
        games: buildSeriesGames(seriesId, homeCourtFranchiseId, challengerFranchiseId, prefix),
        winnerFranchiseId: (opts.nameWinner ?? true) ? winnerFranchiseId : null,
    };
}
function seriesWinner(series: PlayoffSeries): string {
    return must(series.winnerFranchiseId, `series ${series.seriesId} has no winner`);
}
export function buildConferenceBracket(conference: ConferenceId, seeds: string[], opts: {
    winnerSide?: WinnerSide;
} = {}): PlayoffConferenceBracket {
    if (seeds.length !== 8) {
        throw new Error(`${conference} bracket needs exactly 8 seeds, got ${String(seeds.length)}`);
    }
    if (new Set(seeds).size !== 8)
        throw new Error(`${conference} bracket seeds must be unique`);
    const winnerSide = opts.winnerSide ?? 'home';
    const pairings: ReadonlyArray<readonly [
        number,
        number
    ]> = [
        [0, 7],
        [3, 4],
        [2, 5],
        [1, 6],
    ];
    const seedAt = (index: number): string => must(seeds[index], `${conference} bracket missing seed ${String(index)}`);
    const firstRoundSeries: PlayoffSeries[] = [];
    const advancers: Array<{
        team: string;
        seed: number;
    }> = [];
    for (const [slot, [homeIndex, awayIndex]] of pairings.entries()) {
        const series = buildCompletedSeries(`${conference}-first-round-${String(slot + 1)}`, seedAt(homeIndex), seedAt(awayIndex), {
            round: 'first-round',
            conference,
            higherSeed: homeIndex + 1,
            lowerSeed: awayIndex + 1,
            winnerSide,
        });
        firstRoundSeries.push(series);
        advancers.push({
            team: seriesWinner(series),
            seed: series.winnerFranchiseId === seedAt(homeIndex) ? homeIndex + 1 : awayIndex + 1,
        });
    }
    const semifinalPairs: ReadonlyArray<readonly [
        number,
        number
    ]> = [
        [0, 1],
        [2, 3],
    ];
    const semifinalSeries: PlayoffSeries[] = [];
    const semifinalAdvancers: Array<{
        team: string;
        seed: number;
    }> = [];
    for (const [slot, [aIndex, bIndex]] of semifinalPairs.entries()) {
        const a = must(advancers[aIndex], `${conference} semifinal ${String(slot + 1)} home missing`);
        const b = must(advancers[bIndex], `${conference} semifinal ${String(slot + 1)} away missing`);
        const series = buildCompletedSeries(`${conference}-semifinal-${String(slot + 1)}`, a.team, b.team, {
            round: 'conference-semifinal',
            conference,
            higherSeed: Math.min(a.seed, b.seed),
            lowerSeed: Math.max(a.seed, b.seed),
            winnerSide,
        });
        semifinalSeries.push(series);
        semifinalAdvancers.push({
            team: seriesWinner(series),
            seed: series.winnerFranchiseId === a.team ? a.seed : b.seed,
        });
    }
    const first = must(semifinalAdvancers[0], `${conference} conference final home missing`);
    const second = must(semifinalAdvancers[1], `${conference} conference final away missing`);
    const conferenceFinal = buildCompletedSeries(`${conference}-conference-final`, first.team, second.team, {
        round: 'conference-final',
        conference,
        higherSeed: Math.min(first.seed, second.seed),
        lowerSeed: Math.max(first.seed, second.seed),
        winnerSide,
    });
    return {
        conference,
        seeds,
        firstRound: firstRoundSeries,
        semifinals: semifinalSeries,
        conferenceFinal,
    };
}
export interface FullBracketOptions {
    winnerSide?: WinnerSide;
    finalsWinnerSide?: WinnerSide;
}
export function buildFullBracket(eastSeeds: string[], westSeeds: string[], opts: FullBracketOptions = {}): PlayoffBracket {
    const allTeams = new Set([...eastSeeds, ...westSeeds]);
    if (allTeams.size !== eastSeeds.length + westSeeds.length) {
        throw new Error('east and west bracket seeds must be disjoint');
    }
    const east = buildConferenceBracket('east', eastSeeds, opts);
    const west = buildConferenceBracket('west', westSeeds, opts);
    const finalsWinnerSide = opts.finalsWinnerSide ?? 'home';
    const finals = buildCompletedSeries('finals', seriesWinner(east.conferenceFinal), seriesWinner(west.conferenceFinal), {
        round: 'finals',
        conference: null,
        higherSeed: null,
        lowerSeed: null,
        winnerSide: finalsWinnerSide,
        homeCourtWins: finalsWinnerSide === 'home' ? 4 : 1,
        challengerWins: finalsWinnerSide === 'home' ? 1 : 4,
    });
    return {
        schemaVersion: 1,
        postseasonVersion: SEASON_POSTSEASON_VERSION,
        east,
        west,
        finals,
        championFranchiseId: seriesWinner(finals),
    };
}
export interface CompletedPostseasonOptions {
    seed?: string;
    eastSeeds?: string[];
    westSeeds?: string[];
    finalsWinnerSide?: WinnerSide;
}
export function buildCompletedPostseason(opts: CompletedPostseasonOptions = {}): SeasonPostseasonState {
    const seed = opts.seed ?? SEED;
    const eastRanking = seededRanking('east', seed);
    const westRanking = seededRanking('west', seed);
    const eastSeeds = opts.eastSeeds ?? eastRanking.slice(0, 8);
    const westSeeds = opts.westSeeds ?? westRanking.slice(0, 8);
    const bracket = buildFullBracket(eastSeeds, westSeeds, {
        finalsWinnerSide: opts.finalsWinnerSide,
    });
    const state = buildPostseason(seed);
    return {
        ...state,
        playIn: {
            east: buildFullPlayInState('east', eastRanking),
            west: buildFullPlayInState('west', westRanking),
        },
        bracket,
        championFranchiseId: bracket.championFranchiseId,
    };
}
export function allPostseasonGameIds(bracket: PlayoffBracket): string[] {
    const ids: string[] = [];
    for (const conference of [bracket.east, bracket.west]) {
        for (const series of [
            ...conference.firstRound,
            ...conference.semifinals,
            conference.conferenceFinal,
        ]) {
            for (const game of series.games)
                ids.push(game.gameId);
        }
    }
    for (const game of bracket.finals.games)
        ids.push(game.gameId);
    return ids;
}
export function allSeriesOf(bracket: PlayoffBracket): PlayoffSeries[] {
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
function combinations(n: number, k: number): number[][] {
    const out: number[][] = [];
    const pick: number[] = [];
    const visit = (start: number): void => {
        if (pick.length === k) {
            out.push([...pick]);
            return;
        }
        for (let index = start; index < n; index += 1) {
            pick.push(index);
            visit(index + 1);
            pick.pop();
        }
    };
    visit(0);
    return out;
}
export interface SeriesMaskCase {
    mask: boolean[];
    winnerSide: WinnerSide;
    homeCourtWins: number;
    challengerWins: number;
}
export function allSeriesMasks(): SeriesMaskCase[] {
    const cases: SeriesMaskCase[] = [];
    for (const winnerSide of ['home', 'away'] as const) {
        for (let loserWins = 0; loserWins <= 3; loserWins += 1) {
            const total = 4 + loserWins;
            for (const loserPositions of combinations(total - 1, loserWins)) {
                const mask = new Array<boolean>(total).fill(winnerSide === 'home');
                for (const position of loserPositions) {
                    mask[position] = winnerSide !== 'home';
                }
                const homeCourtWins = mask.filter((won) => won).length;
                cases.push({
                    mask,
                    winnerSide,
                    homeCourtWins,
                    challengerWins: total - homeCourtWins,
                });
            }
        }
    }
    return cases;
}
const RANKING: Record<ConferenceId, string[]> = {
    east: seededRanking('east', SEED),
    west: seededRanking('west', SEED),
};
const EAST_SEEDS = RANKING.east.slice(0, 8);
const WEST_SEEDS = RANKING.west.slice(0, 8);
const MATCHUP_KEY: Record<PlayInMatchupId, 'sevenEight' | 'nineTen' | 'final'> = {
    'seven-eight': 'sevenEight',
    'nine-ten': 'nineTen',
    final: 'final',
};
describe('play-in path enumeration (M2.6 postseason-v2)', () => {
    it('represents every legal result combination in both conferences', () => {
        for (const conference of ['east', 'west'] as const) {
            const ranking = RANKING[conference];
            for (const sevenEight of PLAY_IN_RESULT_OUTCOMES) {
                for (const nineTen of PLAY_IN_RESULT_OUTCOMES) {
                    for (const finalOutcome of PLAY_IN_RESULT_OUTCOMES) {
                        const state = buildPlayInState(conference, ranking, {
                            sevenEight,
                            nineTen,
                            final: finalOutcome,
                        });
                        const parsed = playInStateSchema.parse(state);
                        expect(parsed.games.sevenEight.gameId).toBe(playInGameIdOf(conference, 'seven-eight'));
                        expect(parsed.games.nineTen.gameId).toBe(playInGameIdOf(conference, 'nine-ten'));
                        expect(parsed.games.final.gameId).toBe(playInGameIdOf(conference, 'final'));
                        expect(parsed.games.final.homeFranchiseId).toBe(parsed.games.sevenEight.loserFranchiseId);
                        expect(parsed.games.final.awayFranchiseId).toBe(parsed.games.nineTen.winnerFranchiseId);
                        const expectedSeven = sevenEight.winner === 'home' ? ranking[6] : ranking[7];
                        const expectedEight = finalOutcome.winner === 'home'
                            ? parsed.games.sevenEight.loserFranchiseId
                            : parsed.games.nineTen.winnerFranchiseId;
                        expect(parsed.playoffSeeds).not.toBeNull();
                        const seeds = parsed.playoffSeeds ?? [];
                        expect(seeds).toHaveLength(8);
                        expect(seeds.slice(0, 6)).toEqual(ranking.slice(0, 6));
                        expect(seeds[6]).toBe(expectedSeven);
                        expect(seeds[7]).toBe(expectedEight);
                        expect(new Set(seeds).size).toBe(8);
                    }
                }
            }
        }
    });
    it('walks play-in resolution in legal order only', () => {
        const east = RANKING.east;
        const qualifier = { status: 'final', winner: 'home' } as const;
        expect(() => buildPlayInState('east', east, { final: qualifier })).toThrow();
        expect(() => buildPlayInState('east', east, { sevenEight: qualifier, final: qualifier })).toThrow();
        expect(() => buildPlayInState('east', east, { nineTen: qualifier, final: qualifier })).toThrow();
        const staged = [
            buildPlayInState('east', east),
            buildPlayInState('east', east, { sevenEight: qualifier }),
            buildPlayInState('east', east, { sevenEight: qualifier, nineTen: qualifier }),
        ];
        for (const state of staged) {
            expect(playInStateSchema.safeParse(state).success).toBe(true);
            expect(state.playoffSeeds).toBeNull();
            expect(state.games.final.status).toBe('scheduled');
        }
        const complete = buildPlayInState('east', east, {
            sevenEight: qualifier,
            nineTen: qualifier,
            final: qualifier,
        });
        expect(playInStateSchema.safeParse(complete).success).toBe(true);
        expect(complete.playoffSeeds).not.toBeNull();
    });
    it('rejects id-slot mismatches in every play-in slot of both conferences', () => {
        for (const conference of ['east', 'west'] as const) {
            const other = conference === 'east' ? 'west' : 'east';
            const state = buildFullPlayInState(conference, RANKING[conference]);
            for (const matchup of ['seven-eight', 'nine-ten', 'final'] as const) {
                const wrongId = playInGameIdOf(other, matchup);
                const games = {
                    sevenEight: MATCHUP_KEY[matchup] === 'sevenEight'
                        ? { ...state.games.sevenEight, gameId: wrongId }
                        : state.games.sevenEight,
                    nineTen: MATCHUP_KEY[matchup] === 'nineTen'
                        ? { ...state.games.nineTen, gameId: wrongId }
                        : state.games.nineTen,
                    final: MATCHUP_KEY[matchup] === 'final'
                        ? { ...state.games.final, gameId: wrongId }
                        : state.games.final,
                };
                expect(() => playInStateSchema.parse({ ...state, games })).toThrow();
            }
            const crossSlot = {
                ...state,
                games: {
                    ...state.games,
                    sevenEight: {
                        ...state.games.sevenEight,
                        gameId: playInGameIdOf(conference, 'nine-ten'),
                    },
                },
            };
            expect(() => playInStateSchema.parse(crossSlot)).toThrow();
        }
    });
    it('rejects corrupt result facts inside play-in games', () => {
        const state = buildFullPlayInState('east', RANKING.east);
        const finalGame = state.games.final;
        expect(() => playInStateSchema.parse({
            ...state,
            games: { ...state.games, final: { ...finalGame, status: 'scheduled' } },
        })).toThrow();
        expect(() => playInStateSchema.parse({
            ...state,
            games: {
                ...state.games,
                final: { ...finalGame, homeScore: null, awayScore: null },
            },
        })).toThrow();
        expect(() => playInStateSchema.parse({
            ...state,
            games: {
                ...state.games,
                sevenEight: {
                    ...state.games.sevenEight,
                    status: 'forfeit',
                    homeScore: 100,
                    awayScore: 90,
                },
            },
        })).toThrow();
        expect(() => playInStateSchema.parse({
            ...state,
            games: {
                ...state.games,
                sevenEight: { ...state.games.sevenEight, winnerFranchiseId: 'somewhere-else' },
            },
        })).toThrow();
    });
    it('OBSERVED: game ordering and uniqueness are not enforced at parse time', () => {
        const east = RANKING.east;
        const finalFirst = buildPlayInState('east', east);
        const resolvedFinalFirst = {
            ...finalFirst,
            games: {
                ...finalFirst.games,
                final: {
                    ...finalFirst.games.final,
                    status: 'final',
                    homeFranchiseId: east[6],
                    awayFranchiseId: east[8],
                    winnerFranchiseId: east[6],
                    loserFranchiseId: east[8],
                    homeScore: 100,
                    awayScore: 90,
                },
            },
        };
        expect(playInStateSchema.safeParse(resolvedFinalFirst).success).toBe(true);
        const duplicateRanking = { ...finalFirst, ranking: Array.from({ length: 10 }, () => 'lakers') };
        expect(playInStateSchema.safeParse(duplicateRanking).success).toBe(true);
        const duplicateSeeds = {
            ...finalFirst,
            playoffSeeds: Array.from({ length: 8 }, () => 'lakers'),
        };
        expect(playInStateSchema.safeParse(duplicateSeeds).success).toBe(true);
    });
});
describe('bracket shape completeness (M2.6 postseason-v2)', () => {
    it('builds a full 16-team bracket with exactly 15 series and distinct participants', () => {
        const bracket = buildFullBracket(EAST_SEEDS, WEST_SEEDS);
        const parsed = playoffBracketSchema.parse(bracket);
        const allTeams = [...parsed.east.seeds, ...parsed.west.seeds];
        expect(allTeams).toHaveLength(16);
        expect(new Set(allTeams).size).toBe(16);
        expect(new Set(parsed.east.seeds).size).toBe(8);
        expect(new Set(parsed.west.seeds).size).toBe(8);
        expect(new Set([...parsed.east.seeds, ...parsed.west.seeds]).size).toBe(16);
        const series = allSeriesOf(parsed);
        expect(series).toHaveLength(15);
        expect(new Set(series.map((item) => item.seriesId)).size).toBe(15);
        expect(parsed.east.firstRound).toHaveLength(4);
        expect(parsed.east.semifinals).toHaveLength(2);
        expect(parsed.west.firstRound).toHaveLength(4);
        expect(parsed.west.semifinals).toHaveLength(2);
        for (const item of series) {
            expect(item.homeCourtFranchiseId).not.toBeNull();
            expect(item.challengerFranchiseId).not.toBeNull();
            expect(item.homeCourtFranchiseId).not.toBe(item.challengerFranchiseId);
        }
        expect(parsed.east.semifinals[0]?.homeCourtFranchiseId).toBe(parsed.east.firstRound[0]?.winnerFranchiseId);
        expect(parsed.east.semifinals[0]?.challengerFranchiseId).toBe(parsed.east.firstRound[1]?.winnerFranchiseId);
        expect(parsed.east.semifinals[1]?.homeCourtFranchiseId).toBe(parsed.east.firstRound[2]?.winnerFranchiseId);
        expect(parsed.east.semifinals[1]?.challengerFranchiseId).toBe(parsed.east.firstRound[3]?.winnerFranchiseId);
        expect(parsed.east.conferenceFinal.homeCourtFranchiseId).toBe(parsed.east.semifinals[0]?.winnerFranchiseId);
        expect(parsed.east.conferenceFinal.challengerFranchiseId).toBe(parsed.east.semifinals[1]?.winnerFranchiseId);
        expect(parsed.finals.homeCourtFranchiseId).toBe(parsed.east.conferenceFinal.winnerFranchiseId);
        expect(parsed.finals.challengerFranchiseId).toBe(parsed.west.conferenceFinal.winnerFranchiseId);
    });
    it('the complete game-id universe has no duplicate ids', () => {
        const bracket = buildFullBracket(EAST_SEEDS, WEST_SEEDS);
        const ids: string[] = [];
        for (const conference of ['east', 'west'] as const) {
            for (const matchup of ['seven-eight', 'nine-ten', 'final'] as const) {
                ids.push(playInGameIdOf(conference, matchup));
            }
        }
        ids.push(...allPostseasonGameIds(bracket));
        expect(ids).toHaveLength(6 + 75);
        expect(new Set(ids).size).toBe(ids.length);
        for (const gameId of ids) {
            expect(postseasonGameIdSchema.safeParse(gameId).success).toBe(true);
        }
        expect(postseasonPhaseOfGameId('pi-east-seven-eight')).toBe('play-in');
        expect(postseasonPhaseOfGameId('po-east-first-round-1-g1')).toBe('playoffs');
        for (const gameId of allPostseasonGameIds(bracket)) {
            const parsed = parsePlayoffGameId(gameId);
            expect(parsed).not.toBeNull();
            expect(playoffGameIdOf(parsed?.seriesId ?? '', parsed?.gameNumber ?? 0)).toBe(gameId);
        }
        expect(postseasonGameIdSchema.safeParse('pi-east-seven').success).toBe(false);
        expect(postseasonGameIdSchema.safeParse('po-finals-g8').success).toBe(false);
        expect(postseasonGameIdSchema.safeParse('s000001').success).toBe(false);
        expect(parsePlayoffGameId('pi-east-seven-eight')).toBeNull();
        expect(parsePlayoffGameId('po-finals-g8')).toBeNull();
    });
    it('a completed postseason state parses end to end with consistent champions', () => {
        const state = buildCompletedPostseason({ seed: SEED });
        const parsed = seasonPostseasonStateSchema.parse(state);
        expect(parsed.championFranchiseId).toBe(parsed.bracket?.championFranchiseId);
        expect(parsed.championFranchiseId).toBe(parsed.bracket?.finals.winnerFranchiseId);
        expect(parsed.playIn.east.playoffSeeds).toEqual(parsed.bracket?.east.seeds);
        expect(parsed.playIn.west.playoffSeeds).toEqual(parsed.bracket?.west.seeds);
        const away = buildCompletedPostseason({ seed: SEED, finalsWinnerSide: 'away' });
        expect(seasonPostseasonStateSchema.parse(away).championFranchiseId).toBe(away.bracket?.west.conferenceFinal.winnerFranchiseId);
        expect(() => seasonPostseasonStateSchema.parse({
            ...state,
            playIn: { ...state.playIn, west: { ...state.playIn.west, playoffSeeds: null } },
        })).toThrow();
        expect(() => seasonPostseasonStateSchema.parse({
            ...buildPostseason(SEED),
            championFranchiseId: 'lakers',
        })).toThrow();
        expect(() => seasonPostseasonStateSchema.parse({ ...state, championFranchiseId: 'knicks' })).toThrow();
    });
    it('enforces the series refinements inside every bracket slot', () => {
        const bracket = buildFullBracket(EAST_SEEDS, WEST_SEEDS);
        const mismatched = {
            ...buildSeriesPrefix('east-first-round-1', 'a-team', 'b-team', [true, true, true, true], 4),
            challengerWins: 1,
        };
        expect(playoffSeriesSchema.safeParse(mismatched).success).toBe(false);
        const bracketWith = {
            ...bracket,
            east: {
                ...bracket.east,
                firstRound: [
                    mismatched,
                    bracket.east.firstRound[1],
                    bracket.east.firstRound[2],
                    bracket.east.firstRound[3],
                ],
            },
        };
        expect(playoffBracketSchema.safeParse(bracketWith).success).toBe(false);
        const legal = buildCompletedSeries('east-first-round-1', 'a-team', 'b-team', {
            round: 'first-round',
            conference: 'east',
            higherSeed: 1,
            lowerSeed: 8,
            winnerSide: 'home',
            homeCourtWins: 4,
            challengerWins: 2,
        });
        const bracketLegal = {
            ...bracket,
            east: {
                ...bracket.east,
                firstRound: [
                    legal,
                    bracket.east.firstRound[1],
                    bracket.east.firstRound[2],
                    bracket.east.firstRound[3],
                ],
            },
        };
        expect(playoffBracketSchema.safeParse(bracketLegal).success).toBe(true);
    });
});
describe('series length enumeration (M2.6 postseason-v2)', () => {
    const LENGTHS = [
        { homeCourtWins: 4, challengerWins: 0 },
        { homeCourtWins: 4, challengerWins: 1 },
        { homeCourtWins: 4, challengerWins: 2 },
        { homeCourtWins: 4, challengerWins: 3 },
    ] as const;
    it('represents every best-of-seven length with the 2-2-1-1-1 home pattern', () => {
        for (const winnerSide of ['home', 'away'] as const) {
            for (const { homeCourtWins, challengerWins } of LENGTHS) {
                const wins = winnerSide === 'home'
                    ? { homeCourtWins, challengerWins }
                    : { homeCourtWins: challengerWins, challengerWins: homeCourtWins };
                const series = buildCompletedSeries(`length-${winnerSide}-${String(homeCourtWins)}-${String(challengerWins)}`, 'home-team', 'away-team', {
                    round: 'conference-semifinal',
                    conference: 'west',
                    higherSeed: 3,
                    lowerSeed: 6,
                    winnerSide,
                    ...wins,
                });
                expect(playoffSeriesSchema.safeParse(series).success).toBe(true);
                expect(series.games).toHaveLength(homeCourtWins + challengerWins);
                expect(series.homeCourtWins + series.challengerWins).toBe(series.games.length);
                for (const gameNumber of [1, 2, 5, 7]) {
                    if (gameNumber > series.games.length)
                        continue;
                    expect(series.games[gameNumber - 1]?.homeFranchiseId).toBe('home-team');
                    expect(series.games[gameNumber - 1]?.awayFranchiseId).toBe('away-team');
                }
                for (const gameNumber of [3, 4, 6]) {
                    if (gameNumber > series.games.length)
                        continue;
                    expect(series.games[gameNumber - 1]?.homeFranchiseId).toBe('away-team');
                    expect(series.games[gameNumber - 1]?.awayFranchiseId).toBe('home-team');
                }
                const winner = winnerSide === 'home' ? 'home-team' : 'away-team';
                expect(series.winnerFranchiseId).toBe(winner);
                if (winnerSide === 'home') {
                    expect(series.homeCourtWins).toBe(4);
                }
                else {
                    expect(series.challengerWins).toBe(4);
                }
            }
        }
    });
});
describe('winner pattern walk (M2.6 postseason-v2)', () => {
    const SLOT: SeriesSlotOptions = {
        round: 'conference-final',
        conference: 'east',
        higherSeed: 2,
        lowerSeed: 7,
    };
    it('accepts exactly the masks where one side reaches four wins', () => {
        const masks = allSeriesMasks();
        expect(masks).toHaveLength(70);
        for (const { mask, winnerSide, homeCourtWins, challengerWins } of masks) {
            const series = buildSeriesFromMask('pattern-walk', 'home-team', 'away-team', mask, SLOT);
            expect(playoffSeriesSchema.safeParse(series).success).toBe(true);
            expect(series.games).toHaveLength(mask.length);
            expect(series.homeCourtWins).toBe(homeCourtWins);
            expect(series.challengerWins).toBe(challengerWins);
            expect(series.winnerFranchiseId).toBe(winnerSide === 'home' ? 'home-team' : 'away-team');
            for (let index = 0; index < mask.length; index += 1) {
                const game = series.games[index];
                const won = mask[index] ?? false;
                expect(game?.winnerFranchiseId).toBe(won ? 'home-team' : 'away-team');
            }
        }
    });
    it('walks every mask prefix: the winner appears exactly at four wins', () => {
        for (const { mask } of allSeriesMasks()) {
            for (let length = 1; length <= mask.length; length += 1) {
                const prefix = buildSeriesPrefix('pattern-walk', 'home-team', 'away-team', mask, length, SLOT);
                const resolved = prefix.homeCourtWins === 4 || prefix.challengerWins === 4;
                if (resolved) {
                    expect(prefix.winnerFranchiseId).not.toBeNull();
                    expect(playoffSeriesSchema.safeParse(prefix).success).toBe(true);
                }
                else {
                    expect(prefix.winnerFranchiseId).toBeNull();
                    expect(playoffSeriesSchema.safeParse(prefix).success).toBe(true);
                    expect(playoffSeriesSchema.safeParse({ ...prefix, winnerFranchiseId: 'home-team' }).success).toBe(false);
                }
            }
        }
    });
    it('rejects a winner named before four wins and games past the stopping point', () => {
        const mask = canonicalSeriesMask('home', 4, 1);
        const premature = buildSeriesPrefix('pattern-walk', 'home-team', 'away-team', mask, 4, SLOT);
        expect(premature.homeCourtWins).toBe(3);
        expect(playoffSeriesSchema.safeParse(premature).success).toBe(true);
        expect(() => playoffSeriesSchema.parse({ ...premature, winnerFranchiseId: 'home-team' })).toThrow();
        const sweep = buildSeriesPrefix('pattern-walk', 'home-team', 'away-team', [true, true, true, true], 4, SLOT);
        expect(() => playoffSeriesSchema.parse({ ...sweep, challengerWins: 1 })).toThrow();
        expect(() => playoffSeriesSchema.parse({ ...sweep, homeCourtWins: 5 })).toThrow();
    });
    it('rejects a seven-game series without a winner', () => {
        const mask = canonicalSeriesMask('home', 4, 3);
        expect(mask).toHaveLength(7);
        const seven = buildSeriesPrefix('pattern-walk', 'home-team', 'away-team', mask, 7, {
            ...SLOT,
            nameWinner: false,
        });
        expect(seven.winnerFranchiseId).toBeNull();
        expect(() => playoffSeriesSchema.parse(seven)).toThrow();
    });
    it('rejects a four-win series without a named winner', () => {
        for (const challengerWins of [0, 1, 2, 3] as const) {
            const mask = Array.from({ length: 4 + challengerWins }, (_, i) => i < 4);
            const sweep = buildSeriesPrefix('pattern-walk', 'home-team', 'away-team', mask, 4 + challengerWins, {
                ...SLOT,
                nameWinner: false,
            });
            expect(sweep.homeCourtWins).toBe(4);
            expect(sweep.winnerFranchiseId).toBeNull();
            expect(playoffSeriesSchema.safeParse(sweep).success).toBe(false);
        }
    });
});
describe('finals series and champion consistency (M2.6 postseason-v2)', () => {
    const EAST_CHAMPION = must(EAST_SEEDS[0], 'east champion missing');
    const WEST_CHAMPION = must(WEST_SEEDS[0], 'west champion missing');
    it('a finals series with null conference/seeds parses inside the bracket', () => {
        expect(CONFERENCE_TEAMS.east).toContain(EAST_CHAMPION);
        expect(CONFERENCE_TEAMS.west).toContain(WEST_CHAMPION);
        expect(CONFERENCE_TEAMS.east).not.toContain(WEST_CHAMPION);
        const bracket = buildFullBracket(EAST_SEEDS, WEST_SEEDS);
        const finals = buildCompletedSeries('finals', EAST_CHAMPION, WEST_CHAMPION, {
            round: 'finals',
            conference: null,
            higherSeed: null,
            lowerSeed: null,
            winnerSide: 'home',
        });
        expect(playoffSeriesSchema.safeParse(finals).success).toBe(true);
        expect(finals.conference).toBeNull();
        expect(finals.higherSeed).toBeNull();
        expect(finals.lowerSeed).toBeNull();
        const withCustomFinals = { ...bracket, finals, championFranchiseId: EAST_CHAMPION };
        expect(playoffBracketSchema.safeParse(withCustomFinals).success).toBe(true);
    });
    it('rejects a bracket champion that does not match the finals winner', () => {
        const bracket = buildFullBracket(EAST_SEEDS, WEST_SEEDS);
        const wrongChampion = bracket.championFranchiseId === EAST_CHAMPION ? WEST_CHAMPION : EAST_CHAMPION;
        expect(() => playoffBracketSchema.parse({ ...bracket, championFranchiseId: wrongChampion })).toThrow();
    });
});
describe('determinism (M2.6 postseason-v2)', () => {
    it('builders are stable for a seed and sensitive to seed changes', () => {
        const a = buildFullBracket(EAST_SEEDS, WEST_SEEDS);
        const b = buildFullBracket(EAST_SEEDS, WEST_SEEDS);
        expect(b).toEqual(a);
        expect(allPostseasonGameIds(b).join(',')).toBe(allPostseasonGameIds(a).join(','));
        expect(buildPostseason(SEED)).toEqual(buildPostseason(SEED));
        expect(buildPostseason(SEED).seed).toBe(buildPostseason(SEED).seed);
        expect(buildPostseason('f'.repeat(32)).seed).not.toBe(buildPostseason(SEED).seed);
        expect(seededRanking('east', SEED)).toEqual(seededRanking('east', SEED));
        expect(seededRanking('west', SEED)).toEqual(seededRanking('west', SEED));
        expect(seededRanking('east', SEED)).not.toEqual(seededRanking('east', 'f'.repeat(32)));
        const state = buildCompletedPostseason({ seed: SEED });
        const other = buildCompletedPostseason({ seed: 'f'.repeat(32) });
        expect(other).not.toEqual(state);
        expect(other.bracket?.east.seeds).not.toEqual(state.bracket?.east.seeds);
    });
});
