import { describe, expect, it } from 'vitest';
import { buildChallengeRun, seedFromString } from '@hoop-rush/test-fixtures';
import type {
  ChallengeRun,
  GameResult,
  PlayerBoxScore,
  TeamResult,
} from '@hoop-rush/data-contracts';
import { gameScore, leagueMvp } from './mvp.js';

/**
 * A full box score with known values: 25 pts, 10/20 FG, 5/6 FT, 4 ORB, 6 DRB,
 * 3 AST, 2 STL, 1 BLK, 2 TOV, 3 PF (Game Score 20.8 hand-computed).
 */
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

/** Bare scoring box: gameScore equals points exactly. */
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
    padded.push(scoringBox(0, `${teamId}-filler-${padded.length}`));
  }
  return padded.slice(0, 5);
}

function teamResultFixture(
  teamId: string,
  displayName: string,
  players: PlayerBoxScore[],
): TeamResult {
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
}): GameResult {
  const homeTeamId = args.homeTeamId ?? 'user';
  const awayTeamId = args.awayTeamId ?? 'hawks';
  const gameNumber = args.gameNumber ?? 1;
  return {
    schemaVersion: 1,
    gameNumber,
    seed: seedFromString(`fixture-game-${gameNumber}`),
    engineVersion: 'engine-v1',
    dataVersion: 'data-v1',
    profileVersion: 'profile-v1',
    home: teamResultFixture(
      homeTeamId,
      args.homeDisplayName ?? 'Los Angeles Lakers',
      args.homePlayers ?? [],
    ),
    away: teamResultFixture(
      awayTeamId,
      args.awayDisplayName ?? `Fixture ${awayTeamId}`,
      args.awayPlayers ?? [],
    ),
    periodScores: { home: [0, 0, 0, 0], away: [0, 0, 0, 0] },
    winner: 'home',
    overtimePeriods: 0,
    facts: [],
  };
}

/** A challenge run with fixture players/bracket and the given games. */
function runFixture(games: GameResult[]): ChallengeRun {
  return buildChallengeRun({ games });
}

describe('league mvp', () => {
  it('computes the exact all-around game score formula', () => {
    const box = playerBox();
    const expected =
      box.points +
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
    expect(gameScore(playerBox({ points: 0 }))).toBe(
      0.4 * 10 - 0.7 * 20 - 0.4 * (6 - 5) + 0.7 * 4 + 0.3 * 6 + 2 + 0.7 * 3 + 0.7 * 1 - 0.4 * 3 - 2,
    );
  });

  it('does not add a three-point term to game score', () => {
    const none = playerBox({ threes: { made: 0, attempted: 0 } });
    const sharpshooter = playerBox({ threes: { made: 6, attempted: 9 } });
    expect(gameScore(sharpshooter)).toBe(gameScore(none));
  });

  it('aggregates per-appearance averages across games', () => {
    const games = [20, 30, 10].map((points, index) =>
      gameResultFixture({
        awayTeamId: 'celtics',
        homePlayers: [scoringBox(points, 'p-1')],
        awayPlayers: [scoringBox(0, 'p-opp-1-0')],
        gameNumber: index + 1,
      }),
    );
    const mvp = leagueMvp(runFixture(games));
    expect(mvp).not.toBeNull();
    expect(mvp!.appearances).toBe(3);
    expect(mvp!.averageGameScore).toBe(20);
    expect(mvp!.averagePoints).toBe(20);
  });

  it('returns the user candidate when the user five dominate', () => {
    const games = [1, 2].map((gameNumber) =>
      gameResultFixture({
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
      }),
    );
    const mvp = leagueMvp(runFixture(games));
    expect(mvp!.isUserTeam).toBe(true);
    expect(mvp!.playerId).toBe('p-1');
    expect(mvp!.playerName).toBe('Fixture 1');
    expect(mvp!.teamId).toBe('user');
    expect(mvp!.teamName).toBe('Los Angeles Lakers');
  });

  it('ranks by per-appearance average, not totals', () => {
    const games = [1, 2, 3].map((gameNumber) =>
      gameResultFixture({
        awayTeamId: 'celtics',
        homePlayers: [scoringBox(4, 'p-1')],
        awayPlayers: [
          scoringBox(
            gameNumber === 1 ? 30 : 0,
            gameNumber === 1 ? 'p-opp-1-0' : `p-opp-1-${gameNumber}`,
          ),
        ],
        gameNumber,
      }),
    );
    const mvp = leagueMvp(runFixture(games));
    expect(mvp!.isUserTeam).toBe(false);
    expect(mvp!.teamId).toBe('celtics');
    expect(mvp!.teamName).toBe('Fixture celtics');
    expect(mvp!.playerName).toBe('Opponent 1 0');
    expect(mvp!.appearances).toBe(1);
    expect(mvp!.averageGameScore).toBe(30);
  });

  it('keeps mirror matchup identities separate', () => {
    const games = [1, 2].map((gameNumber) =>
      gameResultFixture({
        awayTeamId: 'celtics',
        homePlayers: [scoringBox(40, 'p-1')],
        awayPlayers: [scoringBox(10, 'p-1')],
        gameNumber,
      }),
    );
    const mvp = leagueMvp(runFixture(games));
    expect(mvp!.playerId).toBe('p-1');
    expect(mvp!.teamId).toBe('user');
    expect(mvp!.isUserTeam).toBe(true);
    expect(mvp!.appearances).toBe(2);
    expect(mvp!.averageGameScore).toBe(40);
  });

  it('breaks score ties by average points', () => {
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
    expect(mvp!.playerId).toBe('p-2');
    expect(mvp!.averageGameScore).toBe(20);
    expect(mvp!.averagePoints).toBe(24);
  });

  it('breaks score and points ties by combined per appearance', () => {
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
    expect(mvp!.playerId).toBe('p-2');
    expect(mvp!.averageGameScore).toBe(20);
    expect(mvp!.averagePoints).toBe(20);
    expect(mvp!.averageSteals).toBe(2);
  });

  it('breaks full ties by team then player identity', () => {
    const acrossTeams = leagueMvp(
      runFixture([
        gameResultFixture({
          awayTeamId: 'celtics',
          homePlayers: [scoringBox(20, 'p-1')],
          awayPlayers: [scoringBox(20, 'p-opp-1-0')],
          gameNumber: 1,
        }),
      ]),
    );
    expect(acrossTeams!.teamId).toBe('celtics');

    const sameTeam = leagueMvp(
      runFixture([
        gameResultFixture({
          awayTeamId: 'hawks',
          homePlayers: [scoringBox(20, 'p-1'), scoringBox(20, 'p-2')],
          awayPlayers: [scoringBox(0, 'p-opp-0-0')],
          gameNumber: 1,
        }),
      ]),
    );
    expect(sameTeam!.teamId).toBe('user');
    expect(sameTeam!.playerId).toBe('p-1');
  });

  it('returns unrounded averages', () => {
    const games = [20, 23, 25].map((points, index) =>
      gameResultFixture({
        awayTeamId: 'celtics',
        homePlayers: [scoringBox(points, 'p-1')],
        awayPlayers: [scoringBox(0, 'p-opp-1-0')],
        gameNumber: index + 1,
      }),
    );
    const mvp = leagueMvp(runFixture(games));
    expect(mvp!.averageGameScore).toBe(68 / 3);
    expect(mvp!.averagePoints).toBe(68 / 3);
    expect(mvp!.averageGameScore).not.toBe(22.7);
  });

  it('returns null for a run with no games', () => {
    expect(leagueMvp(runFixture([]))).toBeNull();
    expect(leagueMvp(buildChallengeRun({ games: [] }))).toBeNull();
  });

  it('records all 82 appearances for a season-long standout', () => {
    const games = Array.from({ length: 82 }, (_, index) =>
      gameResultFixture({
        awayTeamId: index % 2 === 0 ? 'celtics' : 'hawks',
        homePlayers: [scoringBox(20, 'p-1')],
        awayPlayers: [scoringBox(0, index % 2 === 0 ? 'p-opp-1-0' : 'p-opp-0-0')],
        gameNumber: index + 1,
      }),
    );
    const mvp = leagueMvp(runFixture(games));
    expect(mvp!.playerId).toBe('p-1');
    expect(mvp!.isUserTeam).toBe(true);
    expect(mvp!.appearances).toBe(82);
    expect(mvp!.averageGameScore).toBe(20);
  });

  it('is deterministic across identical runs', () => {
    const games = [20, 23, 25].map((points, index) =>
      gameResultFixture({
        awayTeamId: 'celtics',
        homePlayers: [scoringBox(points, 'p-1'), scoringBox(1, 'p-2')],
        awayPlayers: [scoringBox(3, 'p-opp-1-0')],
        gameNumber: index + 1,
      }),
    );
    expect(leagueMvp(runFixture(games))).toEqual(leagueMvp(runFixture(games)));
  });
});
