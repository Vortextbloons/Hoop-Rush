import { describe, expect, it } from 'bun:test';
import type { CapRushReport } from '@hoop-rush/data-contracts';
import {
  capRushAchievementFactsFromReport,
  evaluateCapRushAchievements,
  type CapRushAchievementFacts,
  type CapRushAchievementPlayer,
  type CapRushPlayoffGameFacts,
  type CapRushPlayoffSeriesFacts,
  type CapRushPostseasonFacts,
  type CapRushReportSource,
  type CapRushStarterSource,
} from './cap-rush.ts';

const WIN = { user: 110, opponent: 100 };
const LOSS = { user: 100, opponent: 110 };

function makePlayer(
  slot: CapRushAchievementPlayer['slot'],
  index: number,
  overrides: Partial<CapRushAchievementPlayer> = {},
): CapRushAchievementPlayer {
  return {
    slot,
    playerId: `p-${String(index)}`,
    displayName: `Player ${String(index)}`,
    salaryDollars: 20_000_000,
    points: 1600 - index * 100,
    originalOverall: 95,
    ...overrides,
  };
}

function basePlayers(): CapRushAchievementPlayer[] {
  return [
    makePlayer('PG', 1),
    makePlayer('SG', 2),
    makePlayer('SF', 3),
    makePlayer('PF', 4),
    makePlayer('C', 5),
  ];
}

function makeGame(input: {
  round: number;
  seriesSlot: number;
  gameOrdinal: number;
  userSide: 'home' | 'away';
  userPoints: number;
  opponentPoints: number;
  opponentId: string;
}): CapRushPlayoffGameFacts {
  const homeTeamId = input.userSide === 'home' ? 'user' : input.opponentId;
  const awayTeamId = input.userSide === 'home' ? input.opponentId : 'user';
  return {
    gameId: `crp-${String(input.round)}-${String(input.seriesSlot)}-${String(input.gameOrdinal)}`,
    round: input.round,
    seriesSlot: input.seriesSlot,
    gameOrdinal: input.gameOrdinal,
    homeTeamId,
    awayTeamId,
    homePoints: input.userSide === 'home' ? input.userPoints : input.opponentPoints,
    awayPoints: input.userSide === 'home' ? input.opponentPoints : input.userPoints,
    winnerTeamId: input.userPoints > input.opponentPoints ? 'user' : input.opponentId,
    userSide: input.userSide,
  };
}

function makeSeries(input: {
  round: number;
  seriesSlot?: number;
  opponentId?: string;
  results: readonly { user: number; opponent: number }[];
}): CapRushPlayoffSeriesFacts {
  const seriesSlot = input.seriesSlot ?? 0;
  const opponentId = input.opponentId ?? `rival-${String(input.round)}`;
  return {
    seriesId: `crs-${String(input.round)}-${String(seriesSlot)}`,
    round: input.round,
    seriesSlot,
    highTeamId: 'user',
    lowTeamId: opponentId,
    games: input.results.map((result, index) =>
      makeGame({
        round: input.round,
        seriesSlot,
        gameOrdinal: index + 1,
        userSide: index % 2 === 0 ? 'home' : 'away',
        userPoints: result.user,
        opponentPoints: result.opponent,
        opponentId,
      }),
    ),
  };
}

function sweepSeries(round: number): CapRushPlayoffSeriesFacts {
  return makeSeries({ round, results: [WIN, WIN, WIN, WIN] });
}

function fiveGameSeries(round: number): CapRushPlayoffSeriesFacts {
  return makeSeries({ round, results: [WIN, WIN, LOSS, WIN, WIN] });
}

function sixGameSeries(round: number): CapRushPlayoffSeriesFacts {
  return makeSeries({ round, results: [WIN, WIN, LOSS, WIN, WIN, LOSS] });
}

function sevenGameSeries(
  round: number,
  finalUserPoints = 110,
  finalOpponentPoints = 100,
): CapRushPlayoffSeriesFacts {
  return makeSeries({
    round,
    results: [
      WIN,
      LOSS,
      WIN,
      LOSS,
      WIN,
      LOSS,
      { user: finalUserPoints, opponent: finalOpponentPoints },
    ],
  });
}

function defaultSeries(): CapRushPlayoffSeriesFacts[] {
  return [fiveGameSeries(1), fiveGameSeries(2), fiveGameSeries(3), fiveGameSeries(4)];
}

function postseason(
  series: readonly CapRushPlayoffSeriesFacts[] = defaultSeries(),
  overrides: Partial<CapRushPostseasonFacts> = {},
): CapRushPostseasonFacts {
  return { isUserChampion: true, seed: 1, series, ...overrides };
}

function baseFacts(overrides: Partial<CapRushAchievementFacts> = {}): CapRushAchievementFacts {
  return {
    variant: 'clash',
    payrollDollars: 100_000_000,
    purchasedSpins: 0,
    wins: 60,
    losses: 22,
    players: basePlayers(),
    postseason: null,
    ...overrides,
  };
}

function championFacts(overrides: Partial<CapRushAchievementFacts> = {}): CapRushAchievementFacts {
  return baseFacts({ postseason: postseason(), ...overrides });
}

function ids(unlocks: readonly { id: string }[]): string[] {
  return unlocks.map((unlock) => unlock.id);
}

describe('73-9? Hold My Ring', () => {
  it('requires 74+ wins and a 16-0 playoff sweep', () => {
    const sweep = postseason([sweepSeries(1), sweepSeries(2), sweepSeries(3), sweepSeries(4)]);
    expect(
      ids(evaluateCapRushAchievements(championFacts({ wins: 74, losses: 8, postseason: sweep }))),
    ).toContain('73-9-hold-my-ring');
    expect(
      ids(evaluateCapRushAchievements(championFacts({ wins: 73, losses: 9, postseason: sweep }))),
    ).not.toContain('73-9-hold-my-ring');
    expect(
      ids(evaluateCapRushAchievements(championFacts({ wins: 74, losses: 0, postseason: sweep }))),
    ).not.toContain('73-9-hold-my-ring');

    const oneSeriesDropped = postseason([
      sweepSeries(1),
      sweepSeries(2),
      sweepSeries(3),
      fiveGameSeries(4),
    ]);
    expect(
      ids(
        evaluateCapRushAchievements(
          championFacts({ wins: 74, losses: 8, postseason: oneSeriesDropped }),
        ),
      ),
    ).not.toContain('73-9-hold-my-ring');
    expect(
      ids(evaluateCapRushAchievements(championFacts({ wins: 80, losses: 2, postseason: null }))),
    ).not.toContain('73-9-hold-my-ring');
  });
});

describe('Moneyball', () => {
  it('requires a champion with a starting-five payroll at or under $80M', () => {
    expect(
      ids(evaluateCapRushAchievements(championFacts({ payrollDollars: 80_000_000 }))),
    ).toContain('moneyball');
    expect(
      ids(evaluateCapRushAchievements(championFacts({ payrollDollars: 80_000_001 }))),
    ).not.toContain('moneyball');
    expect(
      ids(
        evaluateCapRushAchievements(
          championFacts({ payrollDollars: 50_000_000, postseason: null }),
        ),
      ),
    ).not.toContain('moneyball');
  });
});

describe('The Dirk Run', () => {
  it('requires a Cap Roulette champion with no purchased spins', () => {
    expect(
      ids(evaluateCapRushAchievements(championFacts({ variant: 'roulette', purchasedSpins: 0 }))),
    ).toContain('the-dirk-run');
    expect(
      ids(evaluateCapRushAchievements(championFacts({ variant: 'roulette', purchasedSpins: 1 }))),
    ).not.toContain('the-dirk-run');
    expect(
      ids(evaluateCapRushAchievements(championFacts({ variant: 'clash', purchasedSpins: 0 }))),
    ).not.toContain('the-dirk-run');
    expect(
      ids(
        evaluateCapRushAchievements(
          championFacts({ variant: 'roulette', purchasedSpins: 0, postseason: null }),
        ),
      ),
    ).not.toContain('the-dirk-run');
  });
});

describe('Going All-In', () => {
  it('requires a champion with at least two purchased spins', () => {
    expect(
      ids(evaluateCapRushAchievements(championFacts({ variant: 'roulette', purchasedSpins: 2 }))),
    ).toContain('going-all-in');
    expect(
      ids(evaluateCapRushAchievements(championFacts({ variant: 'roulette', purchasedSpins: 1 }))),
    ).not.toContain('going-all-in');
    expect(
      ids(evaluateCapRushAchievements(championFacts({ purchasedSpins: 2, postseason: null }))),
    ).not.toContain('going-all-in');
  });
});

describe('The Heatles', () => {
  it('requires a champion with a $115M+ starting-five payroll', () => {
    expect(
      ids(evaluateCapRushAchievements(championFacts({ payrollDollars: 115_000_000 }))),
    ).toContain('the-heatles');
    expect(
      ids(evaluateCapRushAchievements(championFacts({ payrollDollars: 114_999_999 }))),
    ).not.toContain('the-heatles');
    expect(
      ids(
        evaluateCapRushAchievements(
          championFacts({ payrollDollars: 120_000_000, postseason: null }),
        ),
      ),
    ).not.toContain('the-heatles');
  });
});

describe('We Believe 2.0', () => {
  it('requires a champion seeded seventh or eighth', () => {
    expect(
      ids(
        evaluateCapRushAchievements(
          championFacts({ postseason: postseason(defaultSeries(), { seed: 7 }) }),
        ),
      ),
    ).toContain('we-believe-2-0');
    expect(
      ids(
        evaluateCapRushAchievements(
          championFacts({ postseason: postseason(defaultSeries(), { seed: 8 }) }),
        ),
      ),
    ).toContain('we-believe-2-0');
    expect(
      ids(
        evaluateCapRushAchievements(
          championFacts({ postseason: postseason(defaultSeries(), { seed: 6 }) }),
        ),
      ),
    ).not.toContain('we-believe-2-0');
    expect(
      ids(
        evaluateCapRushAchievements(
          championFacts({ postseason: postseason(defaultSeries(), { seed: 9 }) }),
        ),
      ),
    ).not.toContain('we-believe-2-0');
  });
});

describe('The Cardiac Kings', () => {
  it('requires all four series to go seven games', () => {
    const allSeven = postseason([
      sevenGameSeries(1),
      sevenGameSeries(2),
      sevenGameSeries(3),
      sevenGameSeries(4),
    ]);
    expect(ids(evaluateCapRushAchievements(championFacts({ postseason: allSeven })))).toContain(
      'the-cardiac-kings',
    );

    const oneSix = postseason([
      sevenGameSeries(1),
      sevenGameSeries(2),
      sevenGameSeries(3),
      sixGameSeries(4),
    ]);
    expect(ids(evaluateCapRushAchievements(championFacts({ postseason: oneSix })))).not.toContain(
      'the-cardiac-kings',
    );

    const oneSweep = postseason([
      sevenGameSeries(1),
      sevenGameSeries(2),
      sevenGameSeries(3),
      sweepSeries(4),
    ]);
    expect(ids(evaluateCapRushAchievements(championFacts({ postseason: oneSweep })))).not.toContain(
      'the-cardiac-kings',
    );
  });
});

describe('Linsanity', () => {
  it('requires the scoring leader to earn $12M or less', () => {
    const cheapLeader = basePlayers().map((player, index) =>
      index === 0 ? { ...player, points: 2000, salaryDollars: 12_000_000 } : player,
    );
    expect(ids(evaluateCapRushAchievements(championFacts({ players: cheapLeader })))).toContain(
      'linsanity',
    );

    const expensiveLeader = cheapLeader.map((player, index) =>
      index === 0 ? { ...player, salaryDollars: 12_000_001 } : player,
    );
    expect(
      ids(evaluateCapRushAchievements(championFacts({ players: expensiveLeader }))),
    ).not.toContain('linsanity');

    const cheapSecondOption = basePlayers().map((player, index) => {
      if (index === 0) return { ...player, points: 2000, salaryDollars: 13_000_000 };
      if (index === 1) return { ...player, points: 1900, salaryDollars: 5_000_000 };
      return player;
    });
    expect(
      ids(evaluateCapRushAchievements(championFacts({ players: cheapSecondOption }))),
    ).not.toContain('linsanity');
  });
});

describe('Detroit Basketball', () => {
  it('requires a champion with no 90+ original OVR starter', () => {
    const underNinety = basePlayers().map((player) => ({ ...player, originalOverall: 89 }));
    expect(ids(evaluateCapRushAchievements(championFacts({ players: underNinety })))).toContain(
      'detroit-basketball',
    );

    const oneAtNinety = underNinety.map((player, index) =>
      index === 2 ? { ...player, originalOverall: 90 } : player,
    );
    expect(ids(evaluateCapRushAchievements(championFacts({ players: oneAtNinety })))).not.toContain(
      'detroit-basketball',
    );

    const missingOverall = underNinety.map((player, index) =>
      index === 0 ? { ...player, originalOverall: null } : player,
    );
    expect(
      ids(evaluateCapRushAchievements(championFacts({ players: missingOverall }))),
    ).not.toContain('detroit-basketball');
  });
});

describe('The Shot', () => {
  it('requires a Finals Game 7 win by exactly one point', () => {
    const shot = postseason([
      fiveGameSeries(1),
      fiveGameSeries(2),
      fiveGameSeries(3),
      sevenGameSeries(4, 101, 100),
    ]);
    expect(ids(evaluateCapRushAchievements(championFacts({ postseason: shot })))).toContain(
      'the-shot',
    );

    const byTwo = postseason([
      fiveGameSeries(1),
      fiveGameSeries(2),
      fiveGameSeries(3),
      sevenGameSeries(4, 102, 100),
    ]);
    expect(ids(evaluateCapRushAchievements(championFacts({ postseason: byTwo })))).not.toContain(
      'the-shot',
    );

    const endedInSix = postseason([
      fiveGameSeries(1),
      fiveGameSeries(2),
      fiveGameSeries(3),
      sixGameSeries(4),
    ]);
    expect(
      ids(evaluateCapRushAchievements(championFacts({ postseason: endedInSix }))),
    ).not.toContain('the-shot');

    const lossByOne = postseason([
      fiveGameSeries(1),
      fiveGameSeries(2),
      fiveGameSeries(3),
      sevenGameSeries(4, 100, 101),
    ]);
    expect(
      ids(evaluateCapRushAchievements(championFacts({ postseason: lossByOne }))),
    ).not.toContain('the-shot');

    const roundThreeOnly = postseason([
      fiveGameSeries(1),
      fiveGameSeries(2),
      sevenGameSeries(3, 101, 100),
      fiveGameSeries(4),
    ]);
    expect(
      ids(evaluateCapRushAchievements(championFacts({ postseason: roundThreeOnly }))),
    ).not.toContain('the-shot');
  });
});

describe('capRushAchievementFactsFromReport', () => {
  function reportSource(): CapRushReportSource {
    return {
      variant: 'roulette',
      payrollDollars: 88_000_000,
      spin: { purchase: 'standard' },
      additionalSpins: [{ purchase: 'surge' }],
      aggregate: { wins: 74, losses: 8 },
      players: basePlayers().map((player) => ({
        slot: player.slot,
        playerId: player.playerId,
        displayName: player.displayName,
        salaryDollars: player.salaryDollars,
        points: player.points,
      })),
      postseason: postseason(defaultSeries(), { seed: 7 }),
    };
  }

  it('maps payroll, spin count, original OVR, and the postseason', () => {
    const starters: CapRushStarterSource[] = [
      { slot: 'PG', source: { originalOverall: 88 } },
      { slot: 'SG', source: { originalOverall: 87 } },
      { slot: 'SF', source: { originalOverall: 86 } },
      { slot: 'PF', source: { originalOverall: 85 } },
      { slot: 'C', source: { originalOverall: 84 } },
    ];
    const facts = capRushAchievementFactsFromReport(reportSource(), starters);
    expect(facts.variant).toBe('roulette');
    expect(facts.payrollDollars).toBe(88_000_000);
    expect(facts.purchasedSpins).toBe(2);
    expect(facts.wins).toBe(74);
    expect(facts.losses).toBe(8);
    expect(facts.players.map((player) => player.originalOverall)).toEqual([88, 87, 86, 85, 84]);
    expect(facts.postseason?.isUserChampion).toBe(true);
    expect(facts.postseason?.seed).toBe(7);
    expect(facts.postseason?.series[0]?.games[0]?.userSide).toBe('home');
  });

  it('reports no purchased spins when the report has none', () => {
    const report = { ...reportSource(), spin: null, additionalSpins: undefined };
    expect(capRushAchievementFactsFromReport(report, []).purchasedSpins).toBe(0);
  });

  it('accepts a real CapRushReport type', () => {
    const acceptsReport = (report: CapRushReport): CapRushAchievementFacts =>
      capRushAchievementFactsFromReport(report, []);
    expect(typeof acceptsReport).toBe('function');
  });
});
