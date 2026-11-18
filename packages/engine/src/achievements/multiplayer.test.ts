import { describe, expect, test } from 'bun:test';
import {
  MULTIPLAYER_ACHIEVEMENT_IDS,
  evaluateCapRushMultiplayerAchievements,
  evaluateMultiplayerAchievements,
  evaluateSeriesAchievements,
  evaluateSharedSeasonAchievements,
  type CapRushMultiplayerAchievementFacts,
  type MultiplayerAchievement,
  type MultiplayerSeatId,
  type SeriesAchievementFacts,
  type SeriesGameFact,
} from './multiplayer.ts';

function game(gameNumber: number, winner: MultiplayerSeatId, margin = 7): SeriesGameFact {
  const winningScore = 100 + margin;
  return {
    gameNumber,
    winner,
    homeScore: winner === 'p1' ? winningScore : 100,
    awayScore: winner === 'p1' ? 100 : winningScore,
  };
}

function seriesGames(
  winners: readonly MultiplayerSeatId[],
  margins: Readonly<Record<number, number>> = {},
): SeriesGameFact[] {
  return winners.map((winner, index) => game(index + 1, winner, margins[index + 1] ?? 7));
}

function seriesFacts(
  winners: readonly MultiplayerSeatId[],
  overrides: Partial<SeriesAchievementFacts> = {},
): SeriesAchievementFacts {
  return {
    seriesId: 'series-1',
    participantId: 'p1',
    games: seriesGames(winners),
    averageOriginalOverall: { p1: 78, p2: 80 },
    opponentPlayerId: 'profile-rival',
    ...overrides,
  };
}

function capRushFacts(
  overrides: Partial<CapRushMultiplayerAchievementFacts> = {},
): CapRushMultiplayerAchievementFacts {
  return {
    participantId: 'p1',
    rivalId: 'p2',
    championSeat: null,
    totalSpendDollars: { p1: 80_000_000, p2: 80_000_000 },
    headToHead: [],
    finals: null,
    ...overrides,
  };
}

function ids(achievements: readonly MultiplayerAchievement[]): string[] {
  return achievements.map((achievement) => achievement.id);
}

describe('multiplayer achievement ids', () => {
  test('pins stable kebab-case ids derived from the achievement names', () => {
    expect([...MULTIPLAYER_ACHIEVEMENT_IDS]).toEqual([
      'cleveland-this-is-for-you',
      'the-reverse-sweep',
      'bring-out-the-brooms',
      'dame-time',
      'upset-of-the-year',
      'the-revenge-tour',
      'the-splash-brothers',
      'moneyball-champions',
      'season-sweep',
      'the-finals-rematch',
    ]);
    for (const id of MULTIPLAYER_ACHIEVEMENT_IDS) {
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });
});

describe('evaluateSeriesAchievements', () => {
  test('awards Cleveland for a 1-3 comeback', () => {
    const achievements = evaluateSeriesAchievements(
      seriesFacts(['p1', 'p2', 'p2', 'p2', 'p1', 'p1', 'p1']),
    );
    expect(ids(achievements)).toEqual(['cleveland-this-is-for-you']);
    expect(achievements[0]?.evidence).toBe('Came back from 1–3 to win 4–3');
  });

  test('awards the reverse sweep and Cleveland together for a 0-3 comeback', () => {
    expect(
      ids(evaluateSeriesAchievements(seriesFacts(['p2', 'p2', 'p2', 'p1', 'p1', 'p1', 'p1']))),
    ).toEqual(['cleveland-this-is-for-you', 'the-reverse-sweep']);
  });

  test('awards the brooms only for a 4-0 series', () => {
    expect(ids(evaluateSeriesAchievements(seriesFacts(['p1', 'p1', 'p1', 'p1'])))).toEqual([
      'bring-out-the-brooms',
    ]);
    expect(ids(evaluateSeriesAchievements(seriesFacts(['p1', 'p1', 'p1', 'p2', 'p1'])))).toEqual(
      [],
    );
  });

  test('awards Dame Time only for a one-point decisive Game 7 win', () => {
    const winners: readonly MultiplayerSeatId[] = ['p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1'];
    const onePoint = seriesFacts(winners, { games: seriesGames(winners, { 7: 1 }) });
    expect(ids(evaluateSeriesAchievements(onePoint))).toEqual(['dame-time']);

    const twoPoints = seriesFacts(winners, { games: seriesGames(winners, { 7: 2 }) });
    expect(ids(evaluateSeriesAchievements(twoPoints))).toEqual([]);

    const loss = seriesFacts(winners, {
      participantId: 'p2',
      games: seriesGames(winners, { 7: 1 }),
    });
    expect(ids(evaluateSeriesAchievements(loss))).toEqual([]);

    const sixGames: readonly MultiplayerSeatId[] = ['p1', 'p2', 'p1', 'p2', 'p1', 'p1'];
    expect(
      ids(
        evaluateSeriesAchievements(
          seriesFacts(sixGames, { games: seriesGames(sixGames, { 6: 1 }) }),
        ),
      ),
    ).toEqual([]);
  });

  test('awards the upset at a six-point original-OVR gap', () => {
    const sweep = ['p1', 'p1', 'p1', 'p1'] as const;
    const upset = seriesFacts(sweep, { averageOriginalOverall: { p1: 78, p2: 84 } });
    expect(ids(evaluateSeriesAchievements(upset))).toEqual([
      'bring-out-the-brooms',
      'upset-of-the-year',
    ]);

    const fractional = seriesFacts(sweep, { averageOriginalOverall: { p1: 78.2, p2: 84.2 } });
    expect(ids(evaluateSeriesAchievements(fractional))).toContain('upset-of-the-year');

    const justUnder = seriesFacts(sweep, { averageOriginalOverall: { p1: 78.1, p2: 84 } });
    expect(ids(evaluateSeriesAchievements(justUnder))).toEqual(['bring-out-the-brooms']);

    const lostSweep: readonly MultiplayerSeatId[] = ['p2', 'p2', 'p2', 'p2'];
    expect(
      ids(
        evaluateSeriesAchievements(
          seriesFacts(lostSweep, { averageOriginalOverall: { p1: 78, p2: 84 } }),
        ),
      ),
    ).toEqual([]);
  });

  test('requires an explicit accepted rematch against the same stable opponent', () => {
    const sweep = ['p1', 'p1', 'p1', 'p1'] as const;
    const rematch = {
      previousSeriesId: 'series-0',
      previousOutcome: 'lost' as const,
      previousOpponentPlayerId: 'profile-rival',
      accepted: true,
    };
    expect(ids(evaluateSeriesAchievements(seriesFacts(sweep, { rematch })))).toEqual([
      'bring-out-the-brooms',
      'the-revenge-tour',
    ]);

    expect(
      ids(
        evaluateSeriesAchievements(
          seriesFacts(sweep, { rematch: { ...rematch, accepted: false } }),
        ),
      ),
    ).toEqual(['bring-out-the-brooms']);
    expect(
      ids(
        evaluateSeriesAchievements(
          seriesFacts(sweep, { rematch: { ...rematch, previousOutcome: 'won' } }),
        ),
      ),
    ).toEqual(['bring-out-the-brooms']);
    expect(
      ids(
        evaluateSeriesAchievements(
          seriesFacts(sweep, { rematch: { ...rematch, previousOpponentPlayerId: 'someone-else' } }),
        ),
      ),
    ).toEqual(['bring-out-the-brooms']);
    expect(
      ids(
        evaluateSeriesAchievements(
          seriesFacts(sweep, { rematch: { ...rematch, previousSeriesId: 'series-1' } }),
        ),
      ),
    ).toEqual(['bring-out-the-brooms']);
    expect(
      ids(
        evaluateSeriesAchievements(
          seriesFacts(sweep, {
            opponentPlayerId: '',
            rematch: { ...rematch, previousOpponentPlayerId: '' },
          }),
        ),
      ),
    ).toEqual(['bring-out-the-brooms']);
  });

  test('ignores incomplete, non-sequential, or already-decided series', () => {
    expect(ids(evaluateSeriesAchievements(seriesFacts(['p1', 'p1', 'p1'])))).toEqual([]);
    expect(ids(evaluateSeriesAchievements(seriesFacts(['p1', 'p1', 'p1', 'p1', 'p1'])))).toEqual(
      [],
    );
    const shuffled = seriesGames(['p1', 'p1', 'p1', 'p1']).map((entry, index) =>
      index === 0 ? { ...entry, gameNumber: 2 } : entry,
    );
    expect(
      ids(evaluateSeriesAchievements(seriesFacts(['p1', 'p1', 'p1', 'p1'], { games: shuffled }))),
    ).toEqual([]);
  });
});

describe('evaluateSharedSeasonAchievements', () => {
  test('awards the splash brothers only for an 82-0 shared season with another player', () => {
    expect(
      ids(evaluateSharedSeasonAchievements({ wins: 82, losses: 0, sharedWithHuman: true })),
    ).toEqual(['the-splash-brothers']);
    expect(
      ids(evaluateSharedSeasonAchievements({ wins: 81, losses: 1, sharedWithHuman: true })),
    ).toEqual([]);
    expect(
      ids(evaluateSharedSeasonAchievements({ wins: 82, losses: 0, sharedWithHuman: false })),
    ).toEqual([]);
  });
});

describe('evaluateCapRushMultiplayerAchievements', () => {
  test('awards Moneyball at exactly 20M less spending and only for the champion', () => {
    const achievements = evaluateCapRushMultiplayerAchievements(
      capRushFacts({
        championSeat: 'p1',
        totalSpendDollars: { p1: 72_000_000, p2: 95_000_000 },
      }),
    );
    expect(ids(achievements)).toEqual(['moneyball-champions']);
    expect(achievements[0]?.evidence).toBe(
      'Won the Cap Rush championship spending $72,000,000 against $95,000,000 ($23,000,000 less)',
    );

    expect(
      ids(
        evaluateCapRushMultiplayerAchievements(
          capRushFacts({
            championSeat: 'p1',
            totalSpendDollars: { p1: 72_000_000, p2: 92_000_000 },
          }),
        ),
      ),
    ).toEqual(['moneyball-champions']);
    expect(
      ids(
        evaluateCapRushMultiplayerAchievements(
          capRushFacts({
            championSeat: 'p1',
            totalSpendDollars: { p1: 72_000_000, p2: 91_999_999 },
          }),
        ),
      ),
    ).toEqual([]);
    expect(
      ids(
        evaluateCapRushMultiplayerAchievements(
          capRushFacts({
            championSeat: 'p2',
            totalSpendDollars: { p1: 72_000_000, p2: 95_000_000 },
          }),
        ),
      ),
    ).toEqual([]);
  });

  test('awards the season sweep only for two distinct regular-season wins', () => {
    const sweep = capRushFacts({
      headToHead: [
        { gameId: 'crl-5-p1-p2', winnerSeat: 'p1' },
        { gameId: 'crl-61-p2-p1', winnerSeat: 'p1' },
      ],
    });
    expect(ids(evaluateCapRushMultiplayerAchievements(sweep))).toEqual(['season-sweep']);

    const split = capRushFacts({
      headToHead: [
        { gameId: 'crl-5-p1-p2', winnerSeat: 'p1' },
        { gameId: 'crl-61-p2-p1', winnerSeat: 'p2' },
      ],
    });
    expect(ids(evaluateCapRushMultiplayerAchievements(split))).toEqual([]);

    const single = capRushFacts({
      headToHead: [{ gameId: 'crl-5-p1-p2', winnerSeat: 'p1' }],
    });
    expect(ids(evaluateCapRushMultiplayerAchievements(single))).toEqual([]);

    const duplicate = capRushFacts({
      headToHead: [
        { gameId: 'crl-5-p1-p2', winnerSeat: 'p1' },
        { gameId: 'crl-5-p1-p2', winnerSeat: 'p1' },
      ],
    });
    expect(ids(evaluateCapRushMultiplayerAchievements(duplicate))).toEqual([]);
  });

  test('awards the Finals rematch for beating the human rival in the Finals without prior history', () => {
    const win = capRushFacts({
      finals: {
        participantTeamId: 'p1-franchise',
        rivalTeamId: 'p2-franchise',
        winnerTeamId: 'p1-franchise',
      },
    });
    expect(ids(evaluateCapRushMultiplayerAchievements(win))).toEqual(['the-finals-rematch']);

    const loss = capRushFacts({
      finals: {
        participantTeamId: 'p1-franchise',
        rivalTeamId: 'p2-franchise',
        winnerTeamId: 'p2-franchise',
      },
    });
    expect(ids(evaluateCapRushMultiplayerAchievements(loss))).toEqual([]);

    const self = capRushFacts({
      finals: {
        participantTeamId: 'p1-franchise',
        rivalTeamId: 'p1-franchise',
        winnerTeamId: 'p1-franchise',
      },
    });
    expect(ids(evaluateCapRushMultiplayerAchievements(self))).toEqual([]);
  });

  test('rejects facts evaluated against the same seat', () => {
    expect(
      ids(
        evaluateCapRushMultiplayerAchievements(
          capRushFacts({
            participantId: 'p1',
            rivalId: 'p1',
            championSeat: 'p1',
            totalSpendDollars: { p1: 50_000_000, p2: 100_000_000 },
          }),
        ),
      ),
    ).toEqual([]);
  });
});

describe('evaluateMultiplayerAchievements', () => {
  test('dispatches each fact group', () => {
    expect(
      ids(
        evaluateMultiplayerAchievements({
          kind: 'series',
          series: seriesFacts(['p1', 'p1', 'p1', 'p1']),
        }),
      ),
    ).toEqual(['bring-out-the-brooms']);
    expect(
      ids(
        evaluateMultiplayerAchievements({
          kind: 'shared-season',
          season: { wins: 82, losses: 0, sharedWithHuman: true },
        }),
      ),
    ).toEqual(['the-splash-brothers']);
    expect(
      ids(
        evaluateMultiplayerAchievements({
          kind: 'cap-rush',
          capRush: capRushFacts({
            finals: {
              participantTeamId: 'p1-franchise',
              rivalTeamId: 'p2-franchise',
              winnerTeamId: 'p1-franchise',
            },
          }),
        }),
      ),
    ).toEqual(['the-finals-rematch']);
  });
});
