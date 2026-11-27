import { describe, expect, it } from 'bun:test';
import {
  fullCourtSeasonScoreSchema,
  type FullCourtPlayoffScore,
  type FullCourtSeasonScore,
} from '@hoop-rush/data-contracts';
import { buildFullCourtSeasonStats, type FullCourtSeriesFacts } from './report-season.ts';

const USER = 'user';
const OPPONENT = 'opponent';
const PLAYOFF_OPPONENT = 'playoff-opponent';

function lineup(
  playerIds: readonly string[],
  seconds: number,
  offensivePossessions: number,
  defensivePossessions: number,
  pointsFor: number,
  pointsAgainst: number,
) {
  return {
    playerIds: [...playerIds],
    players: playerIds.map((playerId) => ({
      playerId,
      displayName: playerId.toUpperCase(),
    })),
    seconds,
    offensivePossessions,
    defensivePossessions,
    pointsFor,
    pointsAgainst,
  };
}

function lineups(side: 'home' | 'away', facts: ReturnType<typeof lineup>[]) {
  return {
    version: 1 as const,
    side,
    sampleThreshold: 20,
    lineups: facts,
    omitted: {
      lineups: 0,
      seconds: 0,
      offensivePossessions: 0,
      defensivePossessions: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    },
  };
}

function regularScore(input: {
  readonly slot: number;
  readonly userHome: boolean;
  readonly userPoints: number;
  readonly opponentPoints: number;
  readonly benchPoints: number;
  readonly lineups?: ReturnType<typeof lineups>;
}): FullCourtSeasonScore {
  const homeTeamId = input.userHome ? USER : OPPONENT;
  const awayTeamId = input.userHome ? OPPONENT : USER;
  const side = input.userHome ? 'home' : 'away';
  return fullCourtSeasonScoreSchema.parse({
    gameId: `fc-${String(input.slot)}`,
    slot: input.slot,
    homeTeamId,
    awayTeamId,
    outcome: {
      kind: 'played',
      homePoints: input.userHome ? input.userPoints : input.opponentPoints,
      awayPoints: input.userHome ? input.opponentPoints : input.userPoints,
      benchPoints: {
        home: input.userHome ? input.benchPoints : 12,
        away: input.userHome ? 12 : input.benchPoints,
      },
      benchPlayers: { home: 2, away: 2 },
      starterPoints: {
        home: input.userHome ? input.userPoints - input.benchPoints : input.opponentPoints - 12,
        away: input.userHome ? input.opponentPoints - 12 : input.userPoints - input.benchPoints,
      },
      ...(input.lineups === undefined ? {} : { lineups: { ...input.lineups, side } }),
    },
  });
}

function playoffScore(input: {
  readonly gameId: string;
  readonly dayOffset: number;
  readonly userHome: boolean;
  readonly userPoints: number;
  readonly opponentPoints: number;
  readonly userWon: boolean;
  readonly benchPoints: number;
  readonly lineups?: ReturnType<typeof lineups>;
}): FullCourtPlayoffScore {
  const homeTeamId = input.userHome ? USER : PLAYOFF_OPPONENT;
  const awayTeamId = input.userHome ? PLAYOFF_OPPONENT : USER;
  const winnerTeamId = input.userWon ? USER : PLAYOFF_OPPONENT;
  const side = input.userHome ? 'home' : 'away';
  return {
    gameId: input.gameId,
    dayOffset: input.dayOffset,
    homeTeamId,
    awayTeamId,
    winnerTeamId,
    outcome: {
      kind: 'played',
      homePoints: input.userHome ? input.userPoints : input.opponentPoints,
      awayPoints: input.userHome ? input.opponentPoints : input.userPoints,
      benchPoints: {
        home: input.userHome ? input.benchPoints : 10,
        away: input.userHome ? 10 : input.benchPoints,
      },
      benchPlayers: { home: 2, away: 2 },
      starterPoints: {
        home: input.userHome ? input.userPoints - input.benchPoints : input.opponentPoints - 10,
        away: input.userHome ? input.opponentPoints - 10 : input.userPoints - input.benchPoints,
      },
      ...(input.lineups === undefined ? {} : { lineups: { ...input.lineups, side } }),
    },
  };
}

function standardLineup(): string[] {
  return ['a', 'b', 'c', 'd', 'e'];
}

function series(): FullCourtSeriesFacts[] {
  return [
    {
      seriesId: 'fcps-1-0',
      round: 1,
      highTeamId: USER,
      lowTeamId: PLAYOFF_OPPONENT,
      games: [
        playoffScore({
          gameId: 'fcp-1-0-1',
          dayOffset: 173,
          userHome: true,
          userPoints: 95,
          opponentPoints: 90,
          userWon: true,
          benchPoints: 20,
          lineups: lineups('home', [lineup(['a', 'b', 'c', 'd', 'e'], 900, 55, 57, 95, 90)]),
        }),
        {
          gameId: 'fcp-1-0-2',
          dayOffset: 175,
          homeTeamId: USER,
          awayTeamId: PLAYOFF_OPPONENT,
          winnerTeamId: PLAYOFF_OPPONENT,
          outcome: { kind: 'forfeit', losingSides: ['home'] },
        },
      ],
    },
  ];
}

describe('Full Court season stats', () => {
  it('separates played games and forfeits and merges actual fives across phases', () => {
    const stats = buildFullCourtSeasonStats({
      userTeamId: USER,
      sampleThreshold: 20,
      regularScores: [
        regularScore({
          slot: 1,
          userHome: true,
          userPoints: 100,
          opponentPoints: 90,
          benchPoints: 25,
          lineups: lineups('home', [
            lineup(standardLineup(), 900, 70, 68, 65, 60),
            lineup(['a', 'b', 'c', 'd', 'f'], 780, 53, 55, 35, 30),
          ]),
        }),
        regularScore({
          slot: 2,
          userHome: false,
          userPoints: 101,
          opponentPoints: 88,
          benchPoints: 18,
          lineups: lineups('away', [
            lineup(standardLineup(), 960, 60, 62, 70, 55),
            lineup(['e', 'f', 'g', 'h', 'i'], 480, 5, 5, 31, 33),
          ]),
        }),
        {
          gameId: 'fc-3',
          slot: 3,
          homeTeamId: USER,
          awayTeamId: OPPONENT,
          outcome: { kind: 'forfeit', losingSides: ['home'] },
        },
      ],
      series: series(),
    });

    expect(stats.regular).toMatchObject({
      gamesExpected: 82,
      gamesRecorded: 3,
      complete: false,
      playedGames: 2,
      forfeitGames: 1,
      forfeitsLost: 1,
      pointsFor: 201,
      pointsAgainst: 178,
      pointDifferential: 23,
    });
    expect(stats.playoff).toEqual({ playedGames: 1, forfeitGames: 1 });
    expect(stats.bench).toMatchObject({
      gamesRecorded: 3,
      gamesExpected: 3,
      coverageComplete: true,
      totalBenchPoints: 63,
      averageBenchPoints: 21,
    });
    expect(stats.lineups).toMatchObject({
      sampleThreshold: 20,
      gamesExpected: 3,
      gamesRecorded: 3,
      coverageComplete: true,
      omitted: {
        lineups: 0,
        games: 0,
        seconds: 0,
        offensivePossessions: 0,
        defensivePossessions: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      },
    });

    const common = stats.lineups.rows.find((row) => row.key === 'a|b|c|d|e');
    expect(common).toBeDefined();
    if (common === undefined) return;
    expect(common.games).toBe(3);
    expect(common.seconds).toBe(900 + 960 + 900);
    expect(common.offensivePossessions).toBe(70 + 60 + 55);
    expect(common.defensivePossessions).toBe(68 + 62 + 57);
    expect(common.pointsFor).toBe(65 + 70 + 95);
    expect(common.pointsAgainst).toBe(60 + 55 + 90);
    expect(common.sampleMet).toBe(true);
    expect(common.rank).toBe(1);
    expect(common.players.map((player) => player.displayName)).toEqual(['A', 'B', 'C', 'D', 'E']);

    const belowSample = stats.lineups.rows.find((row) => row.key === 'e|f|g|h|i');
    expect(belowSample).toBeDefined();
    if (belowSample === undefined) return;
    expect(belowSample.sampleMet).toBe(false);
    expect(belowSample.rank).toBeNull();
  });

  it('keeps legacy scores without lineup facts and never infers a five', () => {
    const stats = buildFullCourtSeasonStats({
      userTeamId: USER,
      regularScores: [
        {
          gameId: 'fc-legacy',
          slot: 1,
          homeTeamId: USER,
          awayTeamId: OPPONENT,
          outcome: { kind: 'played', homePoints: 100, awayPoints: 90 },
        },
      ],
    });

    expect(stats.regular.playedGames).toBe(1);
    expect(stats.lineups.gamesExpected).toBe(1);
    expect(stats.lineups.gamesRecorded).toBe(0);
    expect(stats.lineups.coverageComplete).toBe(false);
    expect(stats.lineups.rows).toEqual([]);
    expect(stats.bench?.gamesRecorded).toBe(0);
  });

  it('reports omitted rows and keeps them out of the lineup ranking', () => {
    const stats = buildFullCourtSeasonStats({
      userTeamId: USER,
      regularScores: [
        regularScore({
          slot: 1,
          userHome: true,
          userPoints: 100,
          opponentPoints: 90,
          benchPoints: 25,
          lineups: {
            ...lineups('home', [lineup(standardLineup(), 900, 70, 68, 100, 90)]),
            omitted: {
              lineups: 2,
              seconds: 120,
              offensivePossessions: 4,
              defensivePossessions: 4,
              pointsFor: 0,
              pointsAgainst: 0,
            },
          },
        }),
      ],
    });

    expect(stats.lineups.rows).toHaveLength(1);
    expect(stats.lineups.omitted).toMatchObject({ lineups: 2, games: 1, seconds: 120 });
  });
});
