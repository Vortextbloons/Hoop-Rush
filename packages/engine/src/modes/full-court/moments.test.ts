import { describe, expect, test } from 'bun:test';
import {
  fullCourtSeasonScoreSchema,
  playerIdSchema,
  type FullCourtPlayerGameStats,
  type FullCourtSeasonScore,
} from '@hoop-rush/data-contracts';
import type { FullCourtPlayoffSeries } from './playoffs.ts';
import {
  buildFullCourtNotableMoments,
  fullCourtGameMomentsFromResult,
  type FullCourtMomentsTeamInput,
} from './moments.ts';
import { fullCourtTestRoster, fullCourtTestSeed } from './game-test-support.ts';
import { simulateFullCourtGame } from './game.ts';
import { createEngineContext } from '../../sim/kernel.ts';
import { buildEraSimulationProfile } from '../../../../test-fixtures/src/index.ts';

function statLine(
  playerId: string,
  overrides: Partial<FullCourtPlayerGameStats> = {},
): FullCourtPlayerGameStats {
  return {
    playerId,
    started: true,
    seconds: 2100,
    points: 18,
    rebounds: 5,
    offRebounds: 1,
    defRebounds: 4,
    assists: 4,
    steals: 1,
    blocks: 0,
    turnovers: 2,
    fouls: 2,
    fgm: 7,
    fga: 15,
    tpm: 2,
    tpa: 5,
    ftm: 2,
    fta: 2,
    ...overrides,
  };
}

function makeTeams(): readonly FullCourtMomentsTeamInput[] {
  const pid = (value: string) => playerIdSchema.parse(value);
  return [
    {
      teamId: 'lakers',
      displayName: 'Los Angeles Lakers',
      roster: [
        { playerId: pid('u1'), displayName: 'Luka Star' },
        { playerId: pid('u2'), displayName: 'Sniper Wing' },
        { playerId: pid('u3'), displayName: 'Anchor Big' },
      ],
    },
    {
      teamId: 'celtics',
      displayName: 'Boston Celtics',
      roster: [
        { playerId: pid('o1'), displayName: 'Boston Ace' },
        { playerId: pid('o2'), displayName: 'Dime Guard' },
      ],
    },
    {
      teamId: 'nuggets',
      displayName: 'Denver Nuggets',
      roster: [{ playerId: pid('n1'), displayName: 'Joker Pivot' }],
    },
    {
      teamId: 'heat',
      displayName: 'Miami Heat',
      roster: [{ playerId: pid('h1'), displayName: 'Heat Guard' }],
    },
  ];
}

function makeScore(input: {
  gameId: string;
  slot: number;
  homeTeamId: string;
  awayTeamId: string;
  homePoints: number;
  awayPoints: number;
  homePlayers?: FullCourtPlayerGameStats[];
  awayPlayers?: FullCourtPlayerGameStats[];
  benchPoints?: { home: number; away: number };
}): FullCourtSeasonScore {
  return fullCourtSeasonScoreSchema.parse({
    gameId: input.gameId,
    slot: input.slot,
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
    outcome: {
      kind: 'played',
      homePoints: input.homePoints,
      awayPoints: input.awayPoints,
      ...(input.benchPoints === undefined ? {} : { benchPoints: input.benchPoints }),
      playerStats: {
        home: input.homePlayers ?? [],
        away: input.awayPlayers ?? [],
      },
    },
  });
}

describe('buildFullCourtNotableMoments', () => {
  test('detects monster triple-doubles, efficiency clinics, playmaking, and deduplicates per player', () => {
    const scores = [
      makeScore({
        gameId: 'g-1',
        slot: 1,
        homeTeamId: 'lakers',
        awayTeamId: 'celtics',
        homePoints: 124,
        awayPoints: 118,
        homePlayers: [
          // Qualifies for 40-pt night, triple-double, and efficiency clinic — must collapse to 1 moment
          statLine('u1', {
            points: 42,
            rebounds: 13,
            assists: 14,
            fgm: 15,
            fga: 22,
            tpm: 5,
            tpa: 8,
            ftm: 7,
            fta: 8,
          }),
          // High-efficiency 3P night
          statLine('u2', {
            points: 31,
            fgm: 10,
            fga: 14,
            tpm: 8,
            tpa: 12,
            ftm: 3,
            fta: 3,
          }),
        ],
        awayPlayers: [
          statLine('o1', {
            points: 20,
            rebounds: 21,
            assists: 3,
            fgm: 9,
            fga: 17,
          }),
        ],
      }),
      makeScore({
        gameId: 'g-2',
        slot: 2,
        homeTeamId: 'nuggets',
        awayTeamId: 'heat',
        homePoints: 130,
        awayPoints: 110,
        homePlayers: [
          statLine('n1', {
            points: 22,
            rebounds: 9,
            assists: 18,
            turnovers: 1,
          }),
        ],
      }),
    ];

    const summary = buildFullCourtNotableMoments({
      teams: makeTeams(),
      userTeamId: 'lakers',
      regularScores: scores,
    });

    const g1 = summary.byGameId.get('g-1') ?? [];
    expect(g1).toHaveLength(2);
    expect(g1[0]?.playerName).toBe('Luka Star');
    expect(g1[0]?.headline).toBe('40-Point Triple-Double');
    expect(g1[0]?.tier).toBe('historic');
    expect(g1[0]?.statLine).toContain('42 PTS · 13 REB · 14 AST');
    expect(g1[0]?.isUserPlayerOrTeam).toBe(true);

    // 20-20 ranks above 8-three barrage for the second slot in g-1
    expect(g1[1]?.playerName).toBe('Boston Ace');
    expect(g1[1]?.headline).toBe('20-20 Dominance');

    expect(summary.userMoments.every((moment) => moment.userInvolved)).toBe(true);
    expect(summary.leagueMoments.some((moment) => moment.gameId === 'g-2')).toBe(true);
    expect(summary.leagueMoments.find((moment) => moment.gameId === 'g-2')?.headline).toBe(
      'Playmaking Masterclass',
    );
  });

  test('detects 5x5, defensive takeovers, zero-waste floor generals, and playoff game labels', () => {
    const series: FullCourtPlayoffSeries[] = [
      {
        seriesId: 's-finals',
        round: 4,
        seriesSlot: 0,
        highSeed: 1,
        lowSeed: 1,
        highTeamId: 'lakers',
        lowTeamId: 'celtics',
        games: [
          {
            gameId: 'fcp-4-0-1',
            dayOffset: 200,
            homeTeamId: 'lakers',
            awayTeamId: 'celtics',
            winnerTeamId: 'lakers',
            outcome: {
              kind: 'played',
              homePoints: 112,
              awayPoints: 104,
              playerStats: {
                home: [
                  statLine('u3', {
                    points: 18,
                    rebounds: 11,
                    assists: 6,
                    steals: 5,
                    blocks: 6,
                  }),
                ],
                away: [
                  statLine('o2', {
                    points: 14,
                    assists: 13,
                    turnovers: 0,
                  }),
                ],
              },
            },
          },
        ],
      },
    ];

    const summary = buildFullCourtNotableMoments({
      teams: makeTeams(),
      userTeamId: 'lakers',
      regularScores: [],
      series,
    });

    const finalsMoments = summary.byGameId.get('fcp-4-0-1') ?? [];
    expect(finalsMoments).toHaveLength(2);
    expect(finalsMoments[0]?.headline).toBe('5×5 Showcase');
    expect(finalsMoments[0]?.gameLabel).toBe('Finals G1');
    expect(finalsMoments[0]?.phase).toBe('playoffs');
    expect(finalsMoments[1]?.headline).toBe('Zero-Waste Floor General');
  });

  test('falls back to bench eruptions or one-point thrillers when no player hits a milestone', () => {
    const scores = [
      makeScore({
        gameId: 'g-bench',
        slot: 3,
        homeTeamId: 'lakers',
        awayTeamId: 'heat',
        homePoints: 115,
        awayPoints: 108,
        benchPoints: { home: 56, away: 20 },
        homePlayers: [statLine('u1', { points: 16 })],
      }),
      makeScore({
        gameId: 'g-close',
        slot: 4,
        homeTeamId: 'lakers',
        awayTeamId: 'celtics',
        homePoints: 101,
        awayPoints: 102,
        homePlayers: [statLine('u1', { points: 20 })],
      }),
    ];

    const summary = buildFullCourtNotableMoments({
      teams: makeTeams(),
      userTeamId: 'lakers',
      regularScores: scores,
    });

    expect(summary.byGameId.get('g-bench')?.[0]?.headline).toBe('Bench Eruption');
    expect(summary.byGameId.get('g-close')?.[0]?.headline).toBe('One-Point Thriller');
    expect(summary.byGameId.get('g-close')?.[0]?.won).toBe(false);
  });

  test('ignores legacy games without playerStats and does not crash', () => {
    const legacy = fullCourtSeasonScoreSchema.parse({
      gameId: 'g-legacy',
      slot: 1,
      homeTeamId: 'lakers',
      awayTeamId: 'celtics',
      outcome: { kind: 'played', homePoints: 104, awayPoints: 99 },
    });
    const summary = buildFullCourtNotableMoments({
      teams: makeTeams(),
      userTeamId: 'lakers',
      regularScores: [legacy],
    });
    expect(summary.userMoments).toHaveLength(0);
    expect(summary.leagueMoments).toHaveLength(0);
  });

  test('extracts moments from a full game result for Gamecast', () => {
    const context = createEngineContext();
    const profile = buildEraSimulationProfile();
    const home = fullCourtTestRoster('lakers', 8);
    const away = fullCourtTestRoster('celtics', 8);
    const game = simulateFullCourtGame(
      {
        schemaVersion: 1,
        seed: fullCourtTestSeed('moments-gamecast'),
        gameNumber: 1,
        dataVersion: 'test',
        profile,
        home: { teamId: 'lakers', displayName: 'Los Angeles Lakers', roster: home },
        away: { teamId: 'celtics', displayName: 'Boston Celtics', roster: away },
      },
      context,
    );
    const modified = {
      ...game,
      home: {
        ...game.home,
        players: game.home.players.map((player, index) =>
          index === 0
            ? {
                ...player,
                points: 45,
                fieldGoals: { made: 16, attempted: 28 },
                threes: { made: 4, attempted: 9 },
                freeThrows: { made: 9, attempted: 10 },
                rebounds: { total: 11, offensive: 2, defensive: 9 },
                assists: 10,
              }
            : player,
        ),
      },
    };
    const moments = fullCourtGameMomentsFromResult({
      result: modified,
      userTeamId: 'lakers',
      gameNumber: 7,
    });
    expect(moments.length).toBeGreaterThanOrEqual(1);
    expect(moments[0]?.headline).toBe('40-Point Triple-Double');
    expect(moments[0]?.gameLabel).toBe('Game 7');
  });
});
