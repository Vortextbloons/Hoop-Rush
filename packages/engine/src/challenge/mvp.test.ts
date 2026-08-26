import { describe, expect, it } from 'vitest';
import { buildChallengeRun, seedFromString } from '@hoop-rush/test-fixtures';
import type { ChallengeRun, GameResult, PlayerBoxScore, TeamResult, } from '@hoop-rush/data-contracts';
import { gameScore, leagueMvp, mvpValue } from './mvp.ts';
function playerBox(overrides: Partial<PlayerBoxScore> = {}): PlayerBoxScore {
    return {
        playerId: 'p-1',
        minutes: 36,
        points: 25,
        fieldGoals: { made: 10, attempted: 20 },
        threes: { made: 1, attempted: 3 },
        freeThrows: { made: 5, attempted: 6 },
        rebounds: { total: 10, offensive: 4, defensive: 6 },
        assists: 3,
        steals: 2,
        blocks: 1,
        turnovers: 2,
        fouls: 3,
        ...overrides,
    };
}
function scoringBox(points: number, playerId = 'p-1'): PlayerBoxScore {
    return playerBox({
        playerId,
        minutes: 30,
        points,
        fieldGoals: { made: 0, attempted: 0 },
        threes: { made: 0, attempted: 0 },
        freeThrows: { made: 0, attempted: 0 },
        rebounds: { total: 0, offensive: 0, defensive: 0 },
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
    });
}
function paddedPlayers(players: PlayerBoxScore[], teamId: string): PlayerBoxScore[] {
    const padded = [...players];
    while (padded.length < 5) {
        padded.push(scoringBox(0, `${teamId}-filler-${String(padded.length)}`));
    }
    return padded.slice(0, 5);
}
function teamResultFixture(teamId: string, displayName: string, players: PlayerBoxScore[]): TeamResult {
    return {
        teamId,
        displayName,
        box: {
            teamId,
            points: 0,
            fieldGoals: { made: 0, attempted: 0 },
            threes: { made: 0, attempted: 0 },
            freeThrows: { made: 0, attempted: 0 },
            rebounds: { total: 0, offensive: 0, defensive: 0, team: 0 },
            assists: 0,
            steals: 0,
            blocks: 0,
            turnovers: 0,
            fouls: 0,
            possessions: 0,
        },
        players: paddedPlayers(players, teamId),
        shotZones: [
            { zone: 'rim', attempts: 0, makes: 0 },
            { zone: 'shortMid', attempts: 0, makes: 0 },
            { zone: 'longMid', attempts: 0, makes: 0 },
            { zone: 'cornerThree', attempts: 0, makes: 0 },
            { zone: 'aboveBreakThree', attempts: 0, makes: 0 },
        ],
    };
}
function gameResultFixture(args: {
    homeTeamId?: string;
    awayTeamId?: string;
    homeDisplayName?: string;
    awayDisplayName?: string;
    homePlayers?: PlayerBoxScore[];
    awayPlayers?: PlayerBoxScore[];
    gameNumber?: number;
    winner?: 'home' | 'away';
}): GameResult {
    const homeTeamId = args.homeTeamId ?? 'user';
    const awayTeamId = args.awayTeamId ?? 'hawks';
    const gameNumber = args.gameNumber ?? 1;
    return {
        schemaVersion: 1,
        gameNumber,
        seed: seedFromString(`fixture-game-${String(gameNumber)}`),
        engineVersion: 'engine-v1',
        dataVersion: 'data-v1',
        profileVersion: 'profile-v1',
        home: teamResultFixture(homeTeamId, args.homeDisplayName ?? 'Los Angeles Lakers', args.homePlayers ?? []),
        away: teamResultFixture(awayTeamId, args.awayDisplayName ?? `Fixture ${awayTeamId}`, args.awayPlayers ?? []),
        periodScores: { home: [0, 0, 0, 0], away: [0, 0, 0, 0] },
        winner: args.winner ?? 'home',
        overtimePeriods: 0,
        facts: [],
    };
}
function runFixture(games: GameResult[]): ChallengeRun {
    return buildChallengeRun({ games });
}
describe('league mvp', () => {
    it('computes the exact all-around game score formula', () => {
        const box = playerBox();
        const expected = box.points +
            0.4 * box.fieldGoals.made -
            0.7 * box.fieldGoals.attempted -
            0.4 * (box.freeThrows.attempted - box.freeThrows.made) +
            0.7 * box.rebounds.offensive +
            0.3 * box.rebounds.defensive +
            box.steals +
            0.7 * box.assists +
            0.7 * box.blocks -
            0.4 * box.fouls -
            box.turnovers;
        expect(gameScore(box)).toBe(expected);
        expect(gameScore(scoringBox(12))).toBe(12);
        expect(gameScore(playerBox({ points: 0 }))).toBe(0.4 * 10 - 0.7 * 20 - 0.4 * (6 - 5) + 0.7 * 4 + 0.3 * 6 + 2 + 0.7 * 3 + 0.7 * 1 - 0.4 * 3 - 2);
    });
    it('does not add a three-point term to game score', () => {
        const none = playerBox({ threes: { made: 0, attempted: 0 } });
        const sharpshooter = playerBox({ threes: { made: 6, attempted: 9 } });
        expect(gameScore(sharpshooter)).toBe(gameScore(none));
    });
    it('aggregates per-appearance averages across games', () => {
        const games = [20, 30, 10].map((points, index) => gameResultFixture({
            awayTeamId: 'celtics',
            homePlayers: [scoringBox(points, 'p-1')],
            awayPlayers: [scoringBox(0, 'p-opp-1-0')],
            gameNumber: index + 1,
        }));
        const mvp = leagueMvp(runFixture(games));
        expect(mvp).not.toBeNull();
        expect(mvp?.appearances).toBe(3);
        expect(mvp?.averageGameScore).toBe(20);
        expect(mvp?.averagePoints).toBe(20);
    });
    it('returns the user candidate when the user five dominate', () => {
        const games = [1, 2].map((gameNumber) => gameResultFixture({
            awayTeamId: 'celtics',
            homePlayers: [
                scoringBox(24, 'p-1'),
                scoringBox(18, 'p-2'),
                scoringBox(15, 'p-3'),
                scoringBox(12, 'p-4'),
                scoringBox(10, 'p-5'),
            ],
            awayPlayers: [scoringBox(2, 'p-opp-1-0')],
            gameNumber,
        }));
        const mvp = leagueMvp(runFixture(games));
        expect(mvp?.isUserTeam).toBe(true);
        expect(mvp?.playerId).toBe('p-1');
        expect(mvp?.playerName).toBe('Fixture 1');
        expect(mvp?.teamId).toBe('user');
        expect(mvp?.teamName).toBe('Los Angeles Lakers');
    });
    it('ranks by per-appearance average, not totals', () => {
        const games = [1, 2, 3].map((gameNumber) => gameResultFixture({
            awayTeamId: 'celtics',
            homePlayers: [scoringBox(4, 'p-1')],
            awayPlayers: [
                scoringBox(gameNumber === 1 ? 30 : 0, gameNumber === 1 ? 'p-opp-1-0' : `p-opp-1-${String(gameNumber)}`),
            ],
            gameNumber,
        }));
        const mvp = leagueMvp(runFixture(games));
        expect(mvp?.isUserTeam).toBe(false);
        expect(mvp?.teamId).toBe('celtics');
        expect(mvp?.teamName).toBe('Fixture celtics');
        expect(mvp?.playerName).toBe('Opponent 1 0');
        expect(mvp?.appearances).toBe(1);
        expect(mvp?.averageGameScore).toBe(30);
    });
    it('keeps mirror matchup identities separate', () => {
        const games = [1, 2].map((gameNumber) => gameResultFixture({
            awayTeamId: 'celtics',
            homePlayers: [scoringBox(40, 'p-1')],
            awayPlayers: [scoringBox(10, 'p-1')],
            gameNumber,
        }));
        const mvp = leagueMvp(runFixture(games));
        expect(mvp?.playerId).toBe('p-1');
        expect(mvp?.teamId).toBe('user');
        expect(mvp?.isUserTeam).toBe(true);
        expect(mvp?.appearances).toBe(2);
        expect(mvp?.averageGameScore).toBe(40);
    });
    it('breaks mvp-score and game-score ties by average points', () => {
        const games = [
            gameResultFixture({
                awayTeamId: 'hawks',
                homePlayers: [
                    scoringBox(20, 'p-1'),
                    playerBox({
                        playerId: 'p-2',
                        minutes: 30,
                        points: 24,
                        fieldGoals: { made: 0, attempted: 0 },
                        threes: { made: 0, attempted: 0 },
                        freeThrows: { made: 0, attempted: 0 },
                        rebounds: { total: 0, offensive: 0, defensive: 0 },
                        assists: 0,
                        steals: 0,
                        blocks: 0,
                        turnovers: 0,
                        fouls: 10,
                    }),
                ],
                awayPlayers: [scoringBox(0, 'p-opp-0-0')],
                gameNumber: 1,
            }),
        ];
        const mvp = leagueMvp(runFixture(games));
        expect(mvp?.playerId).toBe('p-2');
        expect(mvp?.averageGameScore).toBe(20);
        expect(mvp?.averagePoints).toBe(24);
    });
    it('separates equal game scores with the defense bonus', () => {
        const games = [
            gameResultFixture({
                awayTeamId: 'hawks',
                homePlayers: [
                    scoringBox(20, 'p-1'),
                    playerBox({
                        playerId: 'p-2',
                        minutes: 30,
                        points: 20,
                        fieldGoals: { made: 0, attempted: 0 },
                        threes: { made: 0, attempted: 0 },
                        freeThrows: { made: 0, attempted: 0 },
                        rebounds: { total: 0, offensive: 0, defensive: 0 },
                        assists: 0,
                        steals: 2,
                        blocks: 0,
                        turnovers: 0,
                        fouls: 5,
                    }),
                ],
                awayPlayers: [scoringBox(0, 'p-opp-0-0')],
                gameNumber: 1,
            }),
        ];
        const mvp = leagueMvp(runFixture(games));
        expect(mvp?.playerId).toBe('p-2');
        expect(mvp?.averageGameScore).toBe(20);
        expect(mvp?.averagePoints).toBe(20);
        expect(mvp?.averageSteals).toBe(2);
    });
    it('breaks full ties by team then player identity', () => {
        const acrossTeams = leagueMvp(runFixture([
            gameResultFixture({
                awayTeamId: 'celtics',
                homePlayers: [scoringBox(20, 'p-1')],
                awayPlayers: [scoringBox(20, 'p-opp-1-0')],
                gameNumber: 1,
                winner: 'home',
            }),
            gameResultFixture({
                awayTeamId: 'celtics',
                homePlayers: [scoringBox(20, 'p-1')],
                awayPlayers: [scoringBox(20, 'p-opp-1-0')],
                gameNumber: 2,
                winner: 'away',
            }),
        ]));
        expect(acrossTeams?.teamId).toBe('celtics');
        const sameTeam = leagueMvp(runFixture([
            gameResultFixture({
                awayTeamId: 'hawks',
                homePlayers: [scoringBox(20, 'p-1'), scoringBox(20, 'p-2')],
                awayPlayers: [scoringBox(0, 'p-opp-0-0')],
                gameNumber: 1,
                winner: 'home',
            }),
            gameResultFixture({
                awayTeamId: 'hawks',
                homePlayers: [scoringBox(20, 'p-1'), scoringBox(20, 'p-2')],
                awayPlayers: [scoringBox(0, 'p-opp-0-0')],
                gameNumber: 2,
                winner: 'away',
            }),
        ]));
        expect(sameTeam?.teamId).toBe('user');
        expect(sameTeam?.playerId).toBe('p-1');
    });
    it('returns unrounded averages', () => {
        const games = [20, 23, 25].map((points, index) => gameResultFixture({
            awayTeamId: 'celtics',
            homePlayers: [scoringBox(points, 'p-1')],
            awayPlayers: [scoringBox(0, 'p-opp-1-0')],
            gameNumber: index + 1,
        }));
        const mvp = leagueMvp(runFixture(games));
        expect(mvp?.averageGameScore).toBe(68 / 3);
        expect(mvp?.averagePoints).toBe(68 / 3);
        expect(mvp?.averageGameScore).not.toBe(22.7);
    });
    it('returns null for a run with no games', () => {
        expect(leagueMvp(runFixture([]))).toBeNull();
    });
    it('records all 82 appearances for a season-long standout', () => {
        const games = Array.from({ length: 82 }, (_, index) => gameResultFixture({
            awayTeamId: index % 2 === 0 ? 'celtics' : 'hawks',
            homePlayers: [scoringBox(20, 'p-1')],
            awayPlayers: [scoringBox(0, index % 2 === 0 ? 'p-opp-1-0' : 'p-opp-0-0')],
            gameNumber: index + 1,
        }));
        const mvp = leagueMvp(runFixture(games));
        expect(mvp?.playerId).toBe('p-1');
        expect(mvp?.isUserTeam).toBe(true);
        expect(mvp?.appearances).toBe(82);
        expect(mvp?.averageGameScore).toBe(20);
    });
});
describe('mvp composite', () => {
    it('adds efficiency, defense, playmaking, and win bonuses to game score', () => {
        const box = playerBox();
        expect(mvpValue(box, 0.5, true)).toBeCloseTo(20.8 + 1.18 + 2.7 + 1.5 + 0.75, 2);
    });
    it('penalizes losses and credits diagnostics when present', () => {
        const box = playerBox({
            diagnostics: {
                usage: 0,
                shotZones: [
                    { zone: 'rim', attempts: 0, makes: 0 },
                    { zone: 'shortMid', attempts: 0, makes: 0 },
                    { zone: 'longMid', attempts: 0, makes: 0 },
                    { zone: 'cornerThree', attempts: 0, makes: 0 },
                    { zone: 'aboveBreakThree', attempts: 0, makes: 0 },
                ],
                assistOpportunities: 4,
                offensiveReboundChances: 0,
                defensiveReboundChances: 0,
                contestedShots: 5,
            },
        });
        expect(mvpValue(box, 0.5, false)).toBeCloseTo(20.8 + 1.18 + 2.7 + 1.5 - 0.75 + 1 + 0.2, 2);
    });
    it('rewards efficient scoring over equal production on more shots', () => {
        const games = [
            gameResultFixture({
                awayTeamId: 'celtics',
                homePlayers: [
                    playerBox({
                        playerId: 'p-1',
                        minutes: 36,
                        points: 24,
                        fieldGoals: { made: 10, attempted: 15 },
                        threes: { made: 0, attempted: 0 },
                        freeThrows: { made: 4, attempted: 4 },
                        rebounds: { total: 0, offensive: 0, defensive: 0 },
                        assists: 0,
                        steals: 0,
                        blocks: 0,
                        turnovers: 0,
                        fouls: 0,
                    }),
                    playerBox({
                        playerId: 'p-2',
                        minutes: 36,
                        points: 24,
                        fieldGoals: { made: 12, attempted: 30 },
                        threes: { made: 0, attempted: 0 },
                        freeThrows: { made: 0, attempted: 0 },
                        rebounds: { total: 0, offensive: 0, defensive: 0 },
                        assists: 0,
                        steals: 0,
                        blocks: 0,
                        turnovers: 0,
                        fouls: 0,
                    }),
                ],
                awayPlayers: [scoringBox(0, 'p-opp-0-0')],
                gameNumber: 1,
            }),
        ];
        const mvp = leagueMvp(runFixture(games));
        expect(mvp?.playerId).toBe('p-1');
        expect(mvp?.averageEfficiency).toBeCloseTo(24 / (2 * (15 + 0.44 * 4)), 5);
    });
    it('lets defense and playmaking beat higher raw scoring', () => {
        const games = [
            gameResultFixture({
                awayTeamId: 'celtics',
                homePlayers: [
                    scoringBox(22, 'p-1'),
                    playerBox({
                        playerId: 'p-2',
                        minutes: 36,
                        points: 20,
                        fieldGoals: { made: 8, attempted: 16 },
                        threes: { made: 0, attempted: 0 },
                        freeThrows: { made: 0, attempted: 0 },
                        rebounds: { total: 0, offensive: 0, defensive: 0 },
                        assists: 4,
                        steals: 2,
                        blocks: 0,
                        turnovers: 0,
                        fouls: 0,
                    }),
                ],
                awayPlayers: [
                    playerBox({
                        playerId: 'p-opp-1-0',
                        minutes: 36,
                        points: 8,
                        fieldGoals: { made: 4, attempted: 16 },
                        threes: { made: 0, attempted: 0 },
                        freeThrows: { made: 0, attempted: 0 },
                        rebounds: { total: 0, offensive: 0, defensive: 0 },
                        assists: 0,
                        steals: 0,
                        blocks: 0,
                        turnovers: 0,
                        fouls: 0,
                    }),
                ],
                gameNumber: 1,
            }),
        ];
        const mvp = leagueMvp(runFixture(games));
        expect(mvp?.playerId).toBe('p-2');
        expect(mvp?.averageGameScore).toBe(16.8);
    });
    it('penalizes boom-and-bust consistency', () => {
        const games = [1, 2, 3].map((gameNumber) => gameResultFixture({
            awayTeamId: 'celtics',
            homePlayers: [scoringBox(30, 'p-1'), scoringBox(gameNumber === 2 ? 40 : 20, 'p-2')],
            awayPlayers: [scoringBox(0, 'p-opp-1-0')],
            gameNumber,
        }));
        const mvp = leagueMvp(runFixture(games));
        expect(mvp?.playerId).toBe('p-1');
        expect(mvp?.consistency).toBe(0);
    });
    it('applies the small team-context tilt for wins', () => {
        const games = [
            gameResultFixture({
                awayTeamId: 'celtics',
                homePlayers: [scoringBox(20, 'p-1')],
                awayPlayers: [scoringBox(20, 'p-opp-1-0')],
                gameNumber: 1,
            }),
        ];
        const mvp = leagueMvp(runFixture(games));
        expect(mvp?.isUserTeam).toBe(true);
        expect(mvp?.mvpScore).toBeCloseTo(20.75, 5);
    });
    it('adapts the efficiency baseline to the run', () => {
        const buildRun = (filler: PlayerBoxScore) => runFixture([
            gameResultFixture({
                awayTeamId: 'celtics',
                homePlayers: [
                    playerBox({
                        playerId: 'p-1',
                        minutes: 36,
                        points: 20,
                        fieldGoals: { made: 8, attempted: 16 },
                        threes: { made: 0, attempted: 0 },
                        freeThrows: { made: 0, attempted: 0 },
                        rebounds: { total: 0, offensive: 0, defensive: 0 },
                        assists: 0,
                        steals: 0,
                        blocks: 0,
                        turnovers: 0,
                        fouls: 0,
                    }),
                ],
                awayPlayers: [filler],
                gameNumber: 1,
            }),
        ]);
        const efficientLeague = buildRun(scoringBox(0, 'p-opp-1-0'));
        const inefficientLeague = buildRun(playerBox({
            playerId: 'p-opp-1-0',
            minutes: 36,
            points: 10,
            fieldGoals: { made: 5, attempted: 20 },
            threes: { made: 0, attempted: 0 },
            freeThrows: { made: 0, attempted: 0 },
            rebounds: { total: 0, offensive: 0, defensive: 0 },
            assists: 0,
            steals: 0,
            blocks: 0,
            turnovers: 0,
            fouls: 0,
        }));
        const inEfficient = leagueMvp(efficientLeague);
        const inInefficient = leagueMvp(inefficientLeague);
        expect(inEfficient).not.toBeNull();
        expect(inInefficient).not.toBeNull();
        if (inEfficient === null || inInefficient === null) {
            throw new Error('expected league mvp candidates');
        }
        expect(inEfficient.playerId).toBe('p-1');
        expect(inInefficient.playerId).toBe('p-1');
        expect(inInefficient.mvpScore).toBeGreaterThan(inEfficient.mvpScore);
    });
});
