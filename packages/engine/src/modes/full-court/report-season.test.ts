import { describe, expect, it } from 'bun:test';
import type {
  FullCourtPlayoffScore,
  FullCourtSeasonScore,
  FullCourtVariant,
} from '@hoop-rush/data-contracts';
import type { FullCourtCompletedGameFacts } from './report.ts';
import {
  buildFullCourtSeasonStats,
  buildFullCourtSeasonSummary,
  type FullCourtSeriesFacts,
} from './report-season.ts';

const USER = 'user';

function regularScore(input: {
  readonly slot: number;
  readonly userHome: boolean;
  readonly outcome: FullCourtSeasonScore['outcome'];
}): FullCourtSeasonScore {
  const opponent = `opp-${String(input.slot)}`;
  return {
    gameId: `fc-${String(input.slot)}`,
    slot: input.slot,
    homeTeamId: input.userHome ? USER : opponent,
    awayTeamId: input.userHome ? opponent : USER,
    outcome: input.outcome,
  };
}

function regularScores(): FullCourtSeasonScore[] {
  const scores: FullCourtSeasonScore[] = [];
  for (let slot = 1; slot <= 82; slot += 1) {
    const userHome = slot % 2 === 0;
    if (slot === 60) {
      scores.push(
        regularScore({
          slot,
          userHome,
          outcome: { kind: 'forfeit', losingSides: [userHome ? 'home' : 'away'] },
        }),
      );
      continue;
    }
    if (slot === 61) {
      scores.push(
        regularScore({
          slot,
          userHome,
          outcome: { kind: 'forfeit', losingSides: [userHome ? 'away' : 'home'] },
        }),
      );
      continue;
    }
    if (slot === 62) {
      scores.push(
        regularScore({
          slot,
          userHome,
          outcome: { kind: 'forfeit', losingSides: ['home', 'away'] },
        }),
      );
      continue;
    }
    const userWins = slot <= 59;
    const userPoints = userWins ? 100 : 90;
    const opponentPoints = userWins ? 90 : 100;
    scores.push(
      regularScore({
        slot,
        userHome,
        outcome: {
          kind: 'played',
          homePoints: userHome ? userPoints : opponentPoints,
          awayPoints: userHome ? opponentPoints : userPoints,
        },
      }),
    );
  }
  return scores;
}

function benchGame(input: {
  readonly slot: number;
  readonly benchPoints: number;
  readonly benchPlayerCount: number;
  readonly teamPoints?: number;
  readonly teamBonusPoints?: number;
}): FullCourtCompletedGameFacts {
  const teamPoints = input.teamPoints ?? 100;
  const teamBonusPoints = input.teamBonusPoints ?? 0;
  return {
    gameId: `fc-${String(input.slot)}`,
    gameNumber: input.slot,
    teamPoints,
    starterPoints: teamPoints - input.benchPoints - teamBonusPoints,
    benchPoints: input.benchPoints,
    teamBonusPoints,
    benchPlayerCount: input.benchPlayerCount,
  };
}

function playoffGame(input: {
  readonly round: number;
  readonly slot: number;
  readonly ordinal: number;
  readonly highTeamId: string;
  readonly lowTeamId: string;
  readonly highWon: boolean;
}): FullCourtPlayoffScore {
  return {
    gameId: `fcp-${String(input.round)}-${String(input.slot)}-${String(input.ordinal)}`,
    dayOffset: 100 + input.ordinal,
    homeTeamId: input.highTeamId,
    awayTeamId: input.lowTeamId,
    winnerTeamId: input.highWon ? input.highTeamId : input.lowTeamId,
    outcome: {
      kind: 'played',
      homePoints: input.highWon ? 101 : 99,
      awayPoints: input.highWon ? 99 : 101,
    },
  };
}

function series(input: {
  readonly round: number;
  readonly slot: number;
  readonly highTeamId: string;
  readonly lowTeamId: string;
  readonly highWins: readonly boolean[];
}): FullCourtSeriesFacts {
  return {
    seriesId: `crs-${String(input.round)}-${String(input.slot)}`,
    round: input.round,
    highTeamId: input.highTeamId,
    lowTeamId: input.lowTeamId,
    games: input.highWins.map((highWon, index) =>
      playoffGame({
        round: input.round,
        slot: input.slot,
        ordinal: index + 1,
        highTeamId: input.highTeamId,
        lowTeamId: input.lowTeamId,
        highWon,
      }),
    ),
  };
}

function comebackSeries(): FullCourtSeriesFacts {
  return series({
    round: 1,
    slot: 0,
    highTeamId: USER,
    lowTeamId: 'opp-playoff',
    highWins: [true, false, false, false, true, true, true],
  });
}

function summary(input: {
  readonly variant?: FullCourtVariant;
  readonly scores?: readonly FullCourtSeasonScore[];
  readonly completedGames?: readonly FullCourtCompletedGameFacts[];
  readonly series?: readonly FullCourtSeriesFacts[];
  readonly championTeamId?: string | null;
}) {
  return buildFullCourtSeasonSummary({
    runId: 'run-1',
    userTeamId: USER,
    variant: input.variant ?? 'standard',
    regularScores: input.scores ?? regularScores(),
    ...(input.completedGames === undefined ? {} : { completedGames: input.completedGames }),
    ...(input.series === undefined ? {} : { series: input.series }),
    ...(input.championTeamId === undefined ? {} : { championTeamId: input.championTeamId }),
  });
}

describe('Full Court season completion summary', () => {
  it('splits the record by forfeits and reports only supplied facts', () => {
    const result = summary({
      completedGames: [
        benchGame({ slot: 1, benchPoints: 55, benchPlayerCount: 4 }),
        benchGame({ slot: 2, benchPoints: 60, benchPlayerCount: 5 }),
        benchGame({ slot: 3, benchPoints: 20, benchPlayerCount: 3 }),
      ],
      series: [comebackSeries()],
    });

    expect(result.variant).toBe('standard');
    expect(result.regularSeason).toMatchObject({
      gamesExpected: 82,
      gamesRecorded: 82,
      complete: true,
      wins: 60,
      losses: 22,
      playedGames: 79,
      forfeitGames: 3,
      forfeitsWon: 1,
      forfeitsLost: 1,
      doubleForfeits: 1,
      pointsFor: 7700,
      pointsAgainst: 7310,
      pointDifferential: 390,
    });
    expect(result.bench).toMatchObject({
      gamesRecorded: 3,
      gamesExpected: 86,
      coverageComplete: false,
      totalBenchPoints: 135,
      averageBenchPoints: 45,
    });
    expect(result.bench?.bestGame?.gameId).toBe('fc-2');
    expect(result.bench?.benchMobGame?.gameId).toBe('fc-2');
    expect(result.postseason?.userSeries).toHaveLength(1);
    expect(result.postseason?.userSeries[0]).toMatchObject({
      seriesId: 'crs-1-0',
      round: 1,
      opponentTeamId: 'opp-playoff',
      userWins: 4,
      opponentWins: 3,
      gamesPlayed: 7,
      complete: true,
      won: true,
      comebackFromThreeOne: true,
    });
    expect(result.postseason?.userOutcome).toBe('pending');
    expect(result.completion).toEqual({
      regularSeason: true,
      postseason: 'pending',
      complete: false,
    });
    expect(result.achievements.map((achievement) => achievement.id)).toEqual([
      'bench-mob',
      'the-chess-match',
    ]);
    expect(result.achievements[0]?.evidence).toContain('Bench scored 60 points');
    expect(result.achievements[1]?.evidence).toContain('after trailing 3-1');
    expect(result.summary).toContain('60-22 regular season, 3 forfeits.');
    expect(result.summary).toContain('Bench averaged 45 points across 3 completed games');
    expect(result.summary).toContain('Achievements: Bench Mob, The Chess Match.');
  });

  it('does not invent a postseason or bench report when they were not provided', () => {
    const result = summary({});
    expect(result.bench).toBeNull();
    expect(result.postseason).toBeNull();
    expect(result.achievements).toEqual([]);
    expect(result.completion).toEqual({
      regularSeason: true,
      postseason: 'not-provided',
      complete: false,
    });
    expect(result.summary).toContain('No postseason record was provided.');
    expect(result.summary).toContain('Bench scoring was not provided.');
    expect(result.summary.toLowerCase()).not.toContain('champion');
  });

  it('withholds achievements until the regular season is complete', () => {
    const result = summary({
      scores: regularScores().slice(0, 40),
      completedGames: [benchGame({ slot: 1, benchPoints: 60, benchPlayerCount: 5 })],
      series: [comebackSeries()],
    });
    expect(result.regularSeason.complete).toBe(false);
    expect(result.regularSeason.gamesRecorded).toBe(40);
    expect(result.bench?.benchMobGame?.gameId).toBe('fc-1');
    expect(result.achievements).toEqual([]);
    expect(result.summary).toContain('40-0 in 40 of 82 regular-season games');
  });

  it('awards Bench Mob at 50+ bench points even when starters scored more and reconciles team bonuses', () => {
    const highScoring = regularScores().map((score) =>
      score.slot === 1
        ? {
            ...score,
            outcome: { kind: 'played' as const, homePoints: 90, awayPoints: 124 },
          }
        : score,
    );
    const withMoreStarterPoints = summary({
      scores: highScoring,
      completedGames: [
        benchGame({
          slot: 1,
          teamPoints: 124,
          benchPoints: 50,
          teamBonusPoints: 4,
          benchPlayerCount: 4,
        }),
      ],
    });
    expect(withMoreStarterPoints.bench?.benchMobGame?.gameId).toBe('fc-1');
    expect(withMoreStarterPoints.achievements.map((a) => a.id)).toEqual(['bench-mob']);
    expect(withMoreStarterPoints.achievements[0]?.evidence).toContain('Bench scored 50 points');
    expect(withMoreStarterPoints.achievements[0]?.evidence).toContain('team bonus 4');

    const lowScoring = regularScores().map((score) =>
      score.slot === 1
        ? {
            ...score,
            outcome: { kind: 'played' as const, homePoints: 80, awayPoints: 89 },
          }
        : score,
    );
    const belowThreshold = summary({
      scores: lowScoring,
      completedGames: [
        benchGame({ slot: 1, teamPoints: 89, benchPoints: 49, benchPlayerCount: 4 }),
      ],
    });
    expect(belowThreshold.bench?.benchMobGame).toBeNull();
    expect(belowThreshold.achievements).toEqual([]);
  });

  it('rejects bench facts whose starter, bench, and bonus points fail to sum to team points', () => {
    expect(() =>
      summary({
        completedGames: [
          {
            gameId: 'fc-1',
            gameNumber: 1,
            teamPoints: 100,
            starterPoints: 50,
            benchPoints: 50,
            teamBonusPoints: 2,
            benchPlayerCount: 3,
          },
        ],
      }),
    ).toThrow(/do not sum to team points/);
  });

  it('reports a complete championship from the series record', () => {
    const rounds = [1, 2, 3, 4].map((round) =>
      series({
        round,
        slot: 0,
        highTeamId: USER,
        lowTeamId: `opp-${String(round)}`,
        highWins: [true, true, true, true],
      }),
    );
    const result = summary({ series: rounds, championTeamId: USER });
    expect(result.postseason?.userOutcome).toBe('champion');
    expect(result.postseason?.championTeamId).toBe(USER);
    expect(result.postseason?.championSource).toBe('series');
    expect(result.postseason?.finals?.winnerTeamId).toBe(USER);
    expect(result.completion).toEqual({
      regularSeason: true,
      postseason: 'complete',
      complete: true,
    });
    expect(result.summary).toContain('Won the championship.');
  });

  it('reports a non-qualifier without inventing a champion', () => {
    const firstRound = series({
      round: 1,
      slot: 0,
      highTeamId: 'other-a',
      lowTeamId: 'other-b',
      highWins: [true, true, true, true],
    });
    const result = summary({ series: [firstRound] });
    expect(result.postseason?.userOutcome).toBe('not-qualified');
    expect(result.postseason?.championTeamId).toBeNull();
    expect(result.postseason?.championSource).toBe('none');
    expect(result.postseason?.finals).toBeNull();
    expect(result.postseason?.complete).toBe(true);
    expect(result.summary).toContain('Did not qualify for the playoffs.');
  });

  it('rejects a supplied champion that contradicts the Finals record', () => {
    const finals = series({
      round: 4,
      slot: 0,
      highTeamId: USER,
      lowTeamId: 'opp-4',
      highWins: [true, true, true, true],
    });
    expect(() => summary({ series: [finals], championTeamId: 'opp-4' })).toThrow(
      /champion does not match/,
    );
  });

  it('rejects bench facts from a forfeit or an unknown game', () => {
    const forfeitFacts = benchGame({ slot: 60, benchPoints: 10, benchPlayerCount: 2 });
    expect(() => summary({ completedGames: [forfeitFacts] })).toThrow(/not a played user game/);

    const unknownFacts: FullCourtCompletedGameFacts = {
      gameId: 'fc-999',
      gameNumber: 999,
      teamPoints: 100,
      starterPoints: 50,
      benchPoints: 50,
      teamBonusPoints: 0,
      benchPlayerCount: 3,
    };
    expect(() => summary({ completedGames: [unknownFacts] })).toThrow(/not a played user game/);
  });

  it('does not award a 3-1 comeback when the run lost after the deficit', () => {
    const loss = series({
      round: 1,
      slot: 0,
      highTeamId: USER,
      lowTeamId: 'opp-playoff',
      highWins: [true, false, false, false, false],
    });
    const result = summary({ series: [loss] });
    expect(result.postseason?.userSeries[0]).toMatchObject({
      userWins: 1,
      opponentWins: 4,
      complete: true,
      won: false,
      comebackFromThreeOne: false,
    });
    expect(result.achievements).toEqual([]);
  });
});

it('uses complete games and compares a player only with their own bench minutes', () => {
  const fact = (playerId: string, pointsFor: number, pointsAgainst: number) => {
    const playerIds = ['a', 'b', 'c', 'd', playerId];
    return {
      playerIds,
      players: playerIds.map((id) => ({ playerId: id, displayName: id })),
      seconds: 1440,
      offensivePossessions: 50,
      defensivePossessions: 40,
      pointsFor,
      pointsAgainst,
    };
  };
  const played = (slot: number, lineups: ReturnType<typeof fact>[], omittedCount = 0) =>
    regularScore({
      slot,
      userHome: true,
      outcome: {
        kind: 'played',
        homePoints: 100,
        awayPoints: 90,
        lineups: {
          version: 1,
          side: 'home',
          sampleThreshold: 100,
          lineups,
          omitted: {
            lineups: omittedCount,
            seconds: omittedCount * 1440,
            offensivePossessions: omittedCount * 50,
            defensivePossessions: omittedCount * 40,
            pointsFor: omittedCount * 50,
            pointsAgainst: omittedCount * 45,
          },
        },
      },
    });
  const stats = buildFullCourtSeasonStats({
    userTeamId: USER,
    regularScores: [
      played(1, [fact('e', 60, 40), fact('f', 40, 50)]),
      played(2, [fact('f', 55, 40), fact('g', 45, 50)]),
      played(3, [fact('e', 50, 45)], 1),
    ],
  });
  expect(stats.lineups.impactGames).toBe(2);
  expect(stats.lineups.impact.find((row) => row.player.playerId === 'e')).toMatchObject({
    games: 1,
    on: {
      minutes: 24,
      possessions: 45,
      plusMinus: 20,
      offense: 120,
      defense: 100,
      net: 20,
      sampleMet: false,
    },
    off: { minutes: 24, possessions: 45, plusMinus: -10, offense: 80, defense: 125, net: -45 },
    onOff: 65,
  });
  expect(stats.lineups.impact.find((row) => row.player.playerId === 'a')?.onOff).toBeNull();
});
