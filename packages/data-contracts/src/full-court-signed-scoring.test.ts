import { describe, expect, it } from 'bun:test';
import {
  fullCourtHistoryBenchSchema,
  fullCourtSeasonScoreSchema,
  fullCourtTapeEventSchema,
} from './index.ts';

function score(outcome: Record<string, unknown>) {
  return {
    gameId: 'crl-36-suns-knicks',
    slot: 36,
    homeTeamId: 'suns',
    awayTeamId: 'knicks',
    outcome: { kind: 'played', ...outcome },
  };
}

describe('signed Full Court scoring contract', () => {
  it('keeps legacy nonnegative bench records readable without starter evidence', () => {
    expect(
      fullCourtSeasonScoreSchema.parse(
        score({
          homePoints: 100,
          awayPoints: 90,
          benchPoints: { home: 30, away: 20 },
          benchPlayers: { home: 4, away: 3 },
        }),
      ),
    ).toMatchObject({ outcome: { benchPoints: { home: 30, away: 20 } } });
  });

  it('accepts a negative bench subtotal only with exact starter evidence', () => {
    const parsed = fullCourtSeasonScoreSchema.parse(
      score({
        homePoints: 98,
        awayPoints: 85,
        benchPoints: { home: 45, away: -1 },
        benchPlayers: { home: 5, away: 1 },
        starterPoints: { home: 53, away: 86 },
      }),
    );
    expect(parsed.outcome).toMatchObject({
      benchPoints: { home: 45, away: -1 },
      starterPoints: { home: 53, away: 86 },
    });
  });

  it('rejects negative bench points without the signed component contract', () => {
    expect(() =>
      fullCourtSeasonScoreSchema.parse(
        score({
          homePoints: 98,
          awayPoints: 85,
          benchPoints: { home: 45, away: -1 },
        }),
      ),
    ).toThrow(/Signed bench points require starter points/);
  });

  it('accepts a negative starter subtotal when bench plus bonus exceeds team points', () => {
    const parsed = fullCourtSeasonScoreSchema.parse(
      score({
        homePoints: 85,
        awayPoints: 90,
        benchPoints: { home: 90, away: 10 },
        starterPoints: { home: -5, away: 80 },
      }),
    );
    expect(parsed.outcome).toMatchObject({
      benchPoints: { home: 90, away: 10 },
      starterPoints: { home: -5, away: 80 },
    });
  });

  it('rejects mismatched starter evidence and starter evidence without bench points', () => {
    expect(() =>
      fullCourtSeasonScoreSchema.parse(
        score({
          homePoints: 98,
          awayPoints: 85,
          benchPoints: { home: 45, away: -1 },
          starterPoints: { home: 54, away: 86 },
        }),
      ),
    ).toThrow(/must sum to team points/);
    expect(() =>
      fullCourtSeasonScoreSchema.parse(
        score({
          homePoints: 98,
          awayPoints: 85,
          starterPoints: { home: 53, away: 86 },
        }),
      ),
    ).toThrow(/require bench points/);
  });

  it('keeps official team scores nonnegative', () => {
    expect(() =>
      fullCourtSeasonScoreSchema.parse(
        score({
          homePoints: -1,
          awayPoints: 85,
          benchPoints: { home: 0, away: -1 },
          starterPoints: { home: -1, away: 86 },
        }),
      ),
    ).toThrow();
  });

  it('allows signed live tape scores while official team scores stay nonnegative', () => {
    const trip = {
      kind: 'trip' as const,
      period: 0,
      clockSeconds: 600,
      secondsElapsed: 20,
      offense: 0 as const,
      ended: true,
      nextPossessionStart: 'madeBasket' as const,
      homeScore: -1,
      awayScore: 0,
      homeUnit: ['p1', 'p2', 'p3', 'p4', 'p5'],
      awayUnit: ['p6', 'p7', 'p8', 'p9', 'p10'],
    };
    expect(fullCourtTapeEventSchema.parse(trip)).toMatchObject({ homeScore: -1 });
    expect(fullCourtTapeEventSchema.parse({ ...trip, kind: 'period', period: 1 })).toMatchObject({
      homeScore: -1,
    });
  });

  it('validates signed aggregate bench history and its average', () => {
    expect(
      fullCourtHistoryBenchSchema.parse({
        gamesRecorded: 2,
        totalBenchPoints: -3,
        averageBenchPoints: -1.5,
        bestGame: { gameId: 'crl-1', gameNumber: 1, benchPoints: -1 },
      }),
    ).toMatchObject({ totalBenchPoints: -3 });
    expect(() =>
      fullCourtHistoryBenchSchema.parse({
        gamesRecorded: 2,
        totalBenchPoints: -3,
        averageBenchPoints: -1.4,
        bestGame: { gameId: 'crl-1', gameNumber: 1, benchPoints: -1 },
      }),
    ).toThrow(/average must match/);
    expect(() =>
      fullCourtHistoryBenchSchema.parse({
        gamesRecorded: 0,
        totalBenchPoints: 0,
        averageBenchPoints: 0,
        bestGame: { gameId: 'crl-1', gameNumber: 1, benchPoints: 0 },
      }),
    ).toThrow(/Empty bench history/);
  });

  it('keeps legacy compact scores readable without lineup facts', () => {
    expect(
      fullCourtSeasonScoreSchema.parse(score({ homePoints: 100, awayPoints: 90 })).outcome,
    ).toEqual({ kind: 'played', homePoints: 100, awayPoints: 90 });
  });

  it('accepts canonical compact lineups and preserves them through the score contract', () => {
    const lineups = {
      version: 1,
      side: 'home',
      sampleThreshold: 20,
      lineups: [
        {
          playerIds: ['a', 'b', 'c', 'd', 'e'],
          players: ['a', 'b', 'c', 'd', 'e'].map((playerId) => ({
            playerId,
            displayName: playerId.toUpperCase(),
          })),
          seconds: 900,
          offensivePossessions: 60,
          defensivePossessions: 58,
          pointsFor: 100,
          pointsAgainst: 90,
        },
      ],
      omitted: {
        lineups: 0,
        seconds: 0,
        offensivePossessions: 0,
        defensivePossessions: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      },
    };
    const parsed = fullCourtSeasonScoreSchema.parse(
      score({ homePoints: 100, awayPoints: 90, lineups }),
    );
    expect(parsed.outcome).toMatchObject({ lineups: { side: 'home' } });
    expect(() =>
      fullCourtSeasonScoreSchema.parse(
        score({
          homePoints: 100,
          awayPoints: 90,
          lineups: { ...lineups, side: 'away' },
        }),
      ),
    ).toThrow(/Lineup points/);
    expect(() =>
      fullCourtSeasonScoreSchema.parse(
        score({
          homePoints: 100,
          awayPoints: 90,
          lineups: {
            ...lineups,
            lineups: [{ ...lineups.lineups[0], playerIds: ['b', 'a', 'c', 'd', 'e'] }],
          },
        }),
      ),
    ).toThrow(/canonical sorted order/);
    expect(() =>
      fullCourtSeasonScoreSchema.parse(
        score({
          homePoints: 100,
          awayPoints: 90,
          lineups: { ...lineups, lineups: [lineups.lineups[0], lineups.lineups[0]] },
        }),
      ),
    ).toThrow(/appears twice/);
  });
});
