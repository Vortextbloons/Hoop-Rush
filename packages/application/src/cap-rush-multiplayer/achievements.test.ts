import { describe, expect, test } from 'bun:test';
import type {
  CapRushConferenceSeries,
  CapRushLeagueGame,
  CapRushMultiplayerLockedInputs,
  CapRushMultiplayerPlayoffState,
  CapRushMultiplayerReport,
  CapRushMultiplayerSeasonState,
  CapRushMultiplayerState,
} from '@hoop-rush/data-contracts';
import { createCapRushMultiplayerState } from '@hoop-rush/engine';
import {
  capRushMultiplayerAchievementFacts,
  capRushMultiplayerAchievements,
} from './achievements.ts';

const P1_TEAM = 'franchise-p1';
const P2_TEAM = 'franchise-p2';

function state(overrides: Partial<CapRushMultiplayerState> = {}): CapRushMultiplayerState {
  return { ...createCapRushMultiplayerState(null), ...overrides };
}

function locked(input: { p1Payroll: number; p2Payroll: number }): CapRushMultiplayerLockedInputs {
  return {
    seats: {
      p1: {
        franchise: { franchiseId: P1_TEAM },
        payrollDollars: input.p1Payroll,
      },
      p2: {
        franchise: { franchiseId: P2_TEAM },
        payrollDollars: input.p2Payroll,
      },
    },
  } as unknown as CapRushMultiplayerLockedInputs;
}

function season(games: readonly CapRushLeagueGame[]): CapRushMultiplayerSeasonState {
  return { games } as unknown as CapRushMultiplayerSeasonState;
}

function game(
  slot: number,
  homeTeamId: string,
  awayTeamId: string,
  winnerTeamId: string,
): CapRushLeagueGame {
  return {
    gameId: `crl-${String(slot)}-${homeTeamId}-${awayTeamId}`,
    slot,
    homeTeamId,
    awayTeamId,
    homePoints: winnerTeamId === homeTeamId ? 110 : 100,
    awayPoints: winnerTeamId === awayTeamId ? 110 : 100,
    winnerTeamId,
  } as unknown as CapRushLeagueGame;
}

function report(input: {
  championTeamId: string;
  p1Payroll: number;
  p2Payroll: number;
  p1SpinSpend?: number;
  p2SpinSpend?: number;
}): CapRushMultiplayerReport {
  return {
    championTeamId: input.championTeamId,
    seats: {
      p1: {
        payrollDollars: input.p1Payroll,
        spinSpendDollars: input.p1SpinSpend ?? 0,
      },
      p2: {
        payrollDollars: input.p2Payroll,
        spinSpendDollars: input.p2SpinSpend ?? 0,
      },
    },
  } as unknown as CapRushMultiplayerReport;
}

function finalsSeries(highTeamId: string, lowTeamId: string): CapRushConferenceSeries {
  return {
    seriesId: 'crs-4-0',
    round: 4,
    seriesSlot: 0,
    highTeamId,
    lowTeamId,
    games: [],
  } as unknown as CapRushConferenceSeries;
}

function postseason(input: {
  championTeamId: string;
  series: readonly CapRushConferenceSeries[];
}): CapRushMultiplayerPlayoffState {
  return {
    championTeamId: input.championTeamId,
    series: input.series,
  } as unknown as CapRushMultiplayerPlayoffState;
}

describe('capRushMultiplayerAchievementFacts', () => {
  test('builds facts from accepted season, report, and human Finals state', () => {
    const homeWin = game(5, P1_TEAM, P2_TEAM, P1_TEAM);
    const awayWin = game(61, P2_TEAM, P1_TEAM, P1_TEAM);
    const roomState = state({
      locked: locked({ p1Payroll: 72_000_000, p2Payroll: 95_000_000 }),
      season: season([homeWin, awayWin, game(6, P1_TEAM, 'cpu-team', P1_TEAM)]),
      report: report({
        championTeamId: P1_TEAM,
        p1Payroll: 72_000_000,
        p2Payroll: 95_000_000,
      }),
      postseason: postseason({
        championTeamId: P1_TEAM,
        series: [finalsSeries(P1_TEAM, P2_TEAM)],
      }),
    });
    const facts = capRushMultiplayerAchievementFacts({ state: roomState, seat: 'p1' });

    expect(facts).toEqual({
      participantId: 'p1',
      rivalId: 'p2',
      championSeat: 'p1',
      payrollDollars: { p1: 72_000_000, p2: 95_000_000 },
      headToHead: [
        { gameId: 'crl-5-franchise-p1-franchise-p2', winnerSeat: 'p1' },
        { gameId: 'crl-61-franchise-p2-franchise-p1', winnerSeat: 'p1' },
      ],
      finals: {
        participantTeamId: P1_TEAM,
        rivalTeamId: P2_TEAM,
        winnerTeamId: P1_TEAM,
      },
    });
    expect(
      capRushMultiplayerAchievements({ state: roomState, seat: 'p1' }).map(
        (achievement) => achievement.id,
      ),
    ).toEqual(['moneyball-champions', 'season-sweep', 'the-finals-rematch']);
  });

  test('awards the season sweep as soon as both accepted human wins exist', () => {
    const achievements = capRushMultiplayerAchievements({
      state: state({
        locked: locked({ p1Payroll: 80_000_000, p2Payroll: 80_000_000 }),
        phase: 'season',
        season: season([game(5, P1_TEAM, P2_TEAM, P1_TEAM), game(61, P2_TEAM, P1_TEAM, P1_TEAM)]),
      }),
      seat: 'p1',
    });

    expect(achievements.map((achievement) => achievement.id)).toEqual(['season-sweep']);
  });

  test('maps seats symmetrically for the guest profile', () => {
    const roomState = state({
      locked: locked({ p1Payroll: 95_000_000, p2Payroll: 72_000_000 }),
      season: season([game(5, P1_TEAM, P2_TEAM, P2_TEAM), game(61, P2_TEAM, P1_TEAM, P2_TEAM)]),
      report: report({
        championTeamId: P2_TEAM,
        p1Payroll: 95_000_000,
        p2Payroll: 72_000_000,
      }),
      postseason: postseason({
        championTeamId: P2_TEAM,
        series: [finalsSeries(P1_TEAM, P2_TEAM)],
      }),
    });

    expect(capRushMultiplayerAchievementFacts({ state: roomState, seat: 'p2' })).toMatchObject({
      participantId: 'p2',
      rivalId: 'p1',
      championSeat: 'p2',
      headToHead: [{ winnerSeat: 'p2' }, { winnerSeat: 'p2' }],
      finals: {
        participantTeamId: P2_TEAM,
        rivalTeamId: P1_TEAM,
        winnerTeamId: P2_TEAM,
      },
    });
    expect(
      capRushMultiplayerAchievements({ state: roomState, seat: 'p2' }).map(
        (achievement) => achievement.id,
      ),
    ).toEqual(['moneyball-champions', 'season-sweep', 'the-finals-rematch']);
  });

  test('ignores a split and games against CPU teams', () => {
    const achievements = capRushMultiplayerAchievements({
      state: state({
        locked: locked({ p1Payroll: 80_000_000, p2Payroll: 80_000_000 }),
        phase: 'season',
        season: season([
          game(5, P1_TEAM, P2_TEAM, P1_TEAM),
          game(61, P2_TEAM, P1_TEAM, P2_TEAM),
          game(62, P1_TEAM, 'cpu-team', P1_TEAM),
        ]),
      }),
      seat: 'p1',
    });

    expect(achievements).toEqual([]);
  });

  test('uses locked player payroll instead of roulette mutation spend', () => {
    const achievements = capRushMultiplayerAchievements({
      state: state({
        locked: locked({ p1Payroll: 72_000_000, p2Payroll: 95_000_000 }),
        report: report({
          championTeamId: P1_TEAM,
          p1Payroll: 72_000_000,
          p2Payroll: 95_000_000,
          p1SpinSpend: 10_000_000,
        }),
      }),
      seat: 'p1',
    });

    expect(achievements.map((achievement) => achievement.id)).toEqual(['moneyball-champions']);
  });

  test('requires the Finals to be between both human seats', () => {
    const facts = capRushMultiplayerAchievementFacts({
      state: state({
        locked: locked({ p1Payroll: 80_000_000, p2Payroll: 80_000_000 }),
        report: report({
          championTeamId: P1_TEAM,
          p1Payroll: 80_000_000,
          p2Payroll: 80_000_000,
        }),
        postseason: postseason({
          championTeamId: P1_TEAM,
          series: [finalsSeries(P1_TEAM, 'cpu-team')],
        }),
      }),
      seat: 'p1',
    });

    expect(facts?.finals).toBeNull();
    expect(
      capRushMultiplayerAchievements({
        state: state({
          locked: locked({ p1Payroll: 80_000_000, p2Payroll: 80_000_000 }),
          report: report({
            championTeamId: P1_TEAM,
            p1Payroll: 80_000_000,
            p2Payroll: 80_000_000,
          }),
          postseason: postseason({
            championTeamId: P1_TEAM,
            series: [finalsSeries(P1_TEAM, 'cpu-team')],
          }),
        }),
        seat: 'p1',
      }),
    ).toEqual([]);
  });

  test('returns no facts before both rosters are locked', () => {
    expect(
      capRushMultiplayerAchievementFacts({
        state: state({ season: season([game(5, P1_TEAM, P2_TEAM, P1_TEAM)]) }),
        seat: 'p1',
      }),
    ).toBeNull();
  });
});
