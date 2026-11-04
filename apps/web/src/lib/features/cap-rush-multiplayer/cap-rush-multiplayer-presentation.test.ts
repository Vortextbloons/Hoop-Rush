import { describe, expect, test } from 'bun:test';
import type {
  CapRushLeagueGame,
  CapRushLeagueScheduleEntry,
  CapRushMultiplayerAuction,
  CapRushMultiplayerMarketPlayer,
  CapRushMultiplayerRecruitment,
  CapRushMultiplayerRound,
  CapRushMultiplayerSeatRecruitment,
  CapRushMultiplayerSigning,
  CapRushMultiplayerState,
} from '@hoop-rush/data-contracts';
import {
  playoffSeriesSeat,
  bidProjection,
  bidQuickChoices,
  bidRejectionNotice,
  capRushMultiplayerAcceptedAt,
  auctionClock,
  marketPools,
  nextMinimumBid,
  parseBidDollars,
  seatPayrollSummary,
  seatScheduleCells,
} from './cap-rush-multiplayer-presentation.js';

const player = {
  playerId: 'p-1',
  playerVersionId: 'v-1',
  displayName: 'Test Guard',
  position: 'SG',
  bucket: 'star',
  franchiseId: 'lakers',
  seasonKey: '1995-96',
  originalOverall: 92,
  soloSalaryDollars: 34_500_000,
  minimumBidDollars: 12_075_000,
  source: {
    playerId: 'p-1',
    playerVersionId: 'v-1',
    displayName: 'Test Guard',
    franchiseId: 'lakers',
    eraId: '1990s',
    seasonKey: '1995-96',
    positions: ['SG'],
    originalOverall: 92,
    profile: {
      ratings: {} as never,
      tendencies: {} as never,
    },
    physical: { heightInches: 76, weightLbs: 200 },
  },
} as unknown as CapRushMultiplayerMarketPlayer;

type AuctionOverrides = Partial<Omit<CapRushMultiplayerAuction, 'playerId'>> & {
  playerId?: string;
};

function auction(overrides: AuctionOverrides = {}): CapRushMultiplayerAuction {
  return {
    playerId: 'p-1',
    position: 'SG',
    status: 'open',
    openedAtIso: '2026-11-01T00:00:00.000Z',
    endsAtIso: '2026-11-01T00:01:00.000Z',
    leaderSeat: null,
    leaderBidDollars: null,
    winningSeat: null,
    winningBidDollars: null,
    ...overrides,
  } as unknown as CapRushMultiplayerAuction;
}

const pointGuard = {
  ...player,
  playerId: 'p-pg',
  playerVersionId: 'v-pg',
  displayName: 'Test Point',
  position: 'PG',
  bucket: 'strong',
  minimumBidDollars: 8_000_000,
} as unknown as CapRushMultiplayerMarketPlayer;

function round(
  index: number,
  position: CapRushMultiplayerRound['position'],
  auctions: CapRushMultiplayerAuction[],
  status: CapRushMultiplayerRound['status'] = 'bidding',
): CapRushMultiplayerRound {
  return {
    index,
    position,
    status,
    auctions,
    closedAtIso: status === 'complete' ? '2026-11-01T00:02:00.000Z' : null,
  };
}

const emptySeat = (seat: 'p1' | 'p2'): CapRushMultiplayerSeatRecruitment => ({
  seat,
  filledPositions: [],
  leadPlayerId: null,
  payrollDollars: 0,
});

type RecruitmentOverrides = Partial<
  Omit<CapRushMultiplayerRecruitment, 'market' | 'seats' | 'rounds'>
> & {
  market?: unknown;
  seats?: unknown;
  rounds?: CapRushMultiplayerRound[];
};

function recruitment(overrides: RecruitmentOverrides = {}): CapRushMultiplayerRecruitment {
  return {
    schemaVersion: 1,
    market: { players: [player, pointGuard] },
    roundIndex: 0,
    rounds: [round(0, 'SG', [auction()])],
    signings: [],
    seats: { p1: emptySeat('p1'), p2: emptySeat('p2') },
    ...overrides,
  } as unknown as CapRushMultiplayerRecruitment;
}

function stateOf(
  value: CapRushMultiplayerRecruitment | null,
  locked: CapRushMultiplayerState['locked'] = null,
): CapRushMultiplayerState {
  return { recruitment: value, locked } as unknown as CapRushMultiplayerState;
}

describe('cap rush multiplayer presentation', () => {
  test('normalizes the coordination clock to UTC ISO with a Z suffix', () => {
    expect(capRushMultiplayerAcceptedAt('2026-10-31T22:05:48.210+00:00')).toBe(
      '2026-10-31T22:05:48.210Z',
    );
    expect(capRushMultiplayerAcceptedAt(null, new Date('2026-10-31T22:05:48.210Z'))).toBe(
      '2026-10-31T22:05:48.210Z',
    );
  });

  test('requires a $100,000 raise over the leader', () => {
    expect(nextMinimumBid(auction(), player)).toBe(12_075_000);
    expect(
      nextMinimumBid(auction({ leaderSeat: 'p1', leaderBidDollars: 13_000_000 }), player),
    ).toBe(13_100_000);
  });

  test('derives the lot clock label and urgency from the auction', () => {
    const open = auction();
    expect(auctionClock(open, Date.parse('2026-11-01T00:00:30.000Z'))).toEqual({
      remainingMs: 30_000,
      label: '0:30',
      urgent: false,
    });
    expect(auctionClock(open, Date.parse('2026-11-01T00:00:50.000Z')).urgent).toBe(true);
    expect(auctionClock(open, Date.parse('2026-11-01T00:02:00.000Z')).label).toBe('Pending');
    expect(auctionClock(auction({ status: 'closed' }), 0).label).toBe('Closed');
    expect(auctionClock(null, 0)).toEqual({ remainingMs: 0, label: '—', urgent: false });
  });
});

describe('cap rush multiplayer bidding presentation', () => {
  test('parses only whole-dollar totals', () => {
    expect(parseBidDollars('13,123,456')).toBe(13_123_456);
    expect(parseBidDollars('$ 13 123 456')).toBe(13_123_456);
    expect(parseBidDollars('')).toBeNull();
    expect(parseBidDollars('13.5M')).toBeNull();
    expect(parseBidDollars('12.5')).toBeNull();
    expect(parseBidDollars('-12')).toBeNull();
    expect(parseBidDollars('abc')).toBeNull();
  });

  test('offers unique quick totals anchored to the current offer', () => {
    const unopened = bidQuickChoices(auction(), player);
    expect(unopened.map((choice) => choice.totalDollars)).toEqual([
      12_075_000, 12_175_000, 12_575_000, 13_075_000,
    ]);

    const opened = bidQuickChoices(
      auction({ leaderSeat: 'p2', leaderBidDollars: 13_000_000 }),
      player,
    );
    expect(opened.map((choice) => choice.totalDollars)).toEqual([
      13_100_000, 13_500_000, 14_000_000,
    ]);
    expect(opened.map((choice) => choice.hint)).toEqual(['Next bid', '+$500K', '+$1M']);
  });

  test('keeps signed payroll separate from a binding lead', () => {
    const signing = {
      seat: 'p1',
      position: 'PG',
      playerId: 'p-pg',
      playerVersionId: 'v-pg',
      displayName: 'Test Point',
      salaryDollars: 40_000_000,
      source: 'bid',
    } as unknown as CapRushMultiplayerSigning;
    const activeAuction = auction({
      playerId: 'p-1',
      leaderSeat: 'p1',
      leaderBidDollars: 12_000_000,
    });
    const value = recruitment({
      roundIndex: 1,
      rounds: [
        round(0, 'PG', [auction({ playerId: 'p-pg' })], 'complete'),
        round(1, 'SG', [activeAuction]),
      ],
      signings: [signing],
      seats: {
        p1: {
          seat: 'p1',
          filledPositions: ['PG'],
          leadPlayerId: 'p-1',
          payrollDollars: 40_000_000,
        } as CapRushMultiplayerSeatRecruitment,
        p2: emptySeat('p2'),
      },
    });
    const summary = seatPayrollSummary(stateOf(value), 'p1');
    expect(summary.signedPayrollDollars).toBe(40_000_000);
    expect(summary.bindingBidDollars).toBe(12_000_000);
    expect(summary.bindingPlayerName).toBe('Test Guard');
    expect(summary.payrollDollars).toBe(52_000_000);
    expect(summary.status).toBe('under-cap');
    expect(summary.filledPositions).toEqual(['PG']);
  });

  test('replaces the current commitment when projecting a raise', () => {
    const activeAuction = auction({
      playerId: 'p-1',
      leaderSeat: 'p1',
      leaderBidDollars: 12_000_000,
    });
    const value = recruitment({
      rounds: [round(0, 'SG', [activeAuction])],
      seats: {
        p1: {
          seat: 'p1',
          filledPositions: ['PG'],
          leadPlayerId: 'p-1',
          payrollDollars: 40_000_000,
        } as CapRushMultiplayerSeatRecruitment,
        p2: emptySeat('p2'),
      },
    });
    const projection = bidProjection(stateOf(value), 'p1', 15_000_000);
    expect(projection.signedPayrollDollars).toBe(40_000_000);
    expect(projection.bindingBidDollars).toBe(12_000_000);
    expect(projection.projectedPayrollDollars).toBe(55_000_000);
    expect(projection.headroomDollars).toBe(127_000_000);
    expect(projection.overHardLimit).toBe(false);
  });

  test('explains rejections with actionable context', () => {
    expect(
      bidRejectionNotice('bid-too-low', {
        nextMinimumDollars: 13_100_000,
        position: 'SG',
      }),
    ).toEqual({
      message: 'The next legal bid is $13,100,000.',
      action: { kind: 'use-next-bid', totalDollars: 13_100_000 },
    });

    expect(
      bidRejectionNotice('multiple-leads', {
        nextMinimumDollars: 13_100_000,
        position: 'SG',
        leadPlayerId: 'p-2',
        leadPlayerName: 'Other Wing',
      }).action,
    ).toEqual({ kind: 'view-lead', playerId: 'p-2', label: 'View Other Wing' });

    expect(
      bidRejectionNotice('completion-rejected', {
        nextMinimumDollars: 13_100_000,
        position: 'SG',
      }).message,
    ).toContain('hard limit');
    expect(
      bidRejectionNotice('position-filled', {
        nextMinimumDollars: 13_100_000,
        position: 'SG',
      }).message,
    ).toBe('You already signed a Shooting guard this round.');
  });

  test('builds completed, active, and upcoming pools from recorded rounds', () => {
    const value = recruitment({
      market: { players: [player, pointGuard] },
      roundIndex: 1,
      rounds: [
        round(
          0,
          'PG',
          [
            auction({
              playerId: 'p-pg',
              status: 'closed',
              leaderSeat: 'p1',
              leaderBidDollars: 9_000_000,
              winningSeat: 'p1',
              winningBidDollars: 9_000_000,
            }),
          ],
          'complete',
        ),
        round(1, 'SG', [auction()]),
      ],
    });
    const pools = marketPools(value);
    expect(pools.map((pool) => pool.status)).toEqual([
      'completed',
      'active',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
    expect(pools[0]?.lots[0]?.auction?.winningSeat).toBe('p1');
    expect(pools[1]?.lots[0]?.player.playerId).toBe(player.playerId);
    expect(pools[2]?.lots).toEqual([]);
  });
});

describe('cap rush multiplayer season presentation', () => {
  test('maps the local seat fixture to ordered schedule cells', () => {
    const schedule = [
      { gameId: 'g-3', slot: 3, homeTeamId: 'other', awayTeamId: 'other-2' },
      { gameId: 'g-2', slot: 2, homeTeamId: 'rival', awayTeamId: 'local' },
      { gameId: 'g-1', slot: 1, homeTeamId: 'local', awayTeamId: 'opponent' },
    ] as unknown as CapRushLeagueScheduleEntry[];
    const games = [
      {
        gameId: 'g-1',
        homeTeamId: 'local',
        awayTeamId: 'opponent',
        homePoints: 101,
        awayPoints: 96,
      },
      {
        gameId: 'g-2',
        homeTeamId: 'rival',
        awayTeamId: 'local',
        homePoints: 110,
        awayPoints: 104,
      },
    ] as unknown as CapRushLeagueGame[];

    const cells = seatScheduleCells({
      schedule,
      games,
      teamId: 'local',
      opponentTeamId: 'rival',
    });

    expect(cells.map((cell) => cell.slot)).toEqual([1, 2]);
    expect(cells[0]).toMatchObject({
      played: true,
      h2h: false,
      won: true,
      pointsFor: 101,
      pointsAgainst: 96,
    });
    expect(cells[1]).toMatchObject({
      played: true,
      h2h: true,
      won: false,
      pointsFor: 104,
      pointsAgainst: 110,
    });
  });

  test('keeps unplayed schedule cells in order', () => {
    const schedule = [
      { gameId: 'g-2', slot: 2, homeTeamId: 'local', awayTeamId: 'opponent' },
      { gameId: 'g-1', slot: 1, homeTeamId: 'opponent', awayTeamId: 'local' },
    ] as unknown as CapRushLeagueScheduleEntry[];
    const cells = seatScheduleCells({
      schedule,
      games: [],
      teamId: 'local',
      opponentTeamId: 'rival',
    });
    expect(cells).toHaveLength(2);
    expect(cells[0]).toMatchObject({ slot: 1, humanHome: false, played: false, won: null });
    expect(cells[1]).toMatchObject({ slot: 2, humanHome: true, played: false, won: null });
  });
});

describe('playoff series focus', () => {
  for (const localSeat of ['p1', 'p2'] as const) {
    const otherSeat = localSeat === 'p1' ? 'p2' : 'p1';
    for (const localStatus of ['pending', 'eliminated', 'not-qualified'] as const) {
      for (const otherStatus of ['pending', 'eliminated', 'not-qualified'] as const) {
        test(`${localSeat}: local ${localStatus}, opponent ${otherStatus}`, () => {
          const outcomes = {
            p1: { status: 'pending' as typeof localStatus, round: null },
            p2: { status: 'pending' as typeof otherStatus, round: null },
          };
          outcomes[localSeat].status = localStatus;
          outcomes[otherSeat].status = otherStatus;
          const expected =
            localStatus === 'pending' ? localSeat : otherStatus === 'pending' ? otherSeat : null;
          expect(playoffSeriesSeat(outcomes, localSeat)).toBe(expected);
        });
      }
    }
  }
});
