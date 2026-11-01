import { describe, expect, test } from 'bun:test';
import type {
  CapRushMultiplayerAuction,
  CapRushMultiplayerRecruitment,
  CapRushMultiplayerRound,
  CapRushMultiplayerSigning,
  CapRushMultiplayerState,
} from '@hoop-rush/data-contracts';
import { CapRushAuctionMotion } from './cap-rush-multiplayer-motion.js';

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

function round(
  index: number,
  auctions: CapRushMultiplayerAuction[],
  position: CapRushMultiplayerRound['position'] = 'SG',
): CapRushMultiplayerRound {
  return {
    index,
    position,
    status: 'bidding',
    auctions,
    closedAtIso: null,
  } as unknown as CapRushMultiplayerRound;
}

function stateOf(
  rounds: CapRushMultiplayerRound[],
  roundIndex: number,
  signings: CapRushMultiplayerSigning[] = [],
): CapRushMultiplayerState {
  const recruitment = {
    schemaVersion: 1,
    market: { players: [{}] },
    roundIndex,
    rounds,
    signings,
    seats: {},
  } as unknown as CapRushMultiplayerRecruitment;
  return { recruitment } as unknown as CapRushMultiplayerState;
}

const signing = {
  seat: 'p1',
  position: 'SG',
  playerId: 'p-1',
  playerVersionId: 'v-1',
  displayName: 'Test Guard',
  salaryDollars: 12_100_000,
  source: 'bid',
} as unknown as CapRushMultiplayerSigning;

describe('cap rush multiplayer auction motion', () => {
  test('primes without replaying recorded state', () => {
    const motion = new CapRushAuctionMotion('p1');
    const state = stateOf(
      [round(0, [auction({ leaderSeat: 'p2', leaderBidDollars: 13_000_000 })])],
      0,
      [signing],
    );
    expect(motion.observe(state)).toEqual([]);

    const reconnect = new CapRushAuctionMotion('p1');
    expect(reconnect.observe(state)).toEqual([]);
  });

  test('reports a price change once', () => {
    const motion = new CapRushAuctionMotion('p1');
    motion.observe(stateOf([round(0, [auction()])], 0));
    const next = stateOf(
      [round(0, [auction({ leaderSeat: 'p2', leaderBidDollars: 12_175_000 })])],
      0,
    );
    expect(motion.observe(next)).toEqual([{ kind: 'price', playerId: 'p-1' }]);
    expect(motion.observe(next)).toEqual([]);
  });

  test('reports a deadline extension only when the lot clock moves later', () => {
    const motion = new CapRushAuctionMotion('p1');
    motion.observe(stateOf([round(0, [auction()])], 0));
    expect(
      motion.observe(stateOf([round(0, [auction({ endsAtIso: '2026-11-01T00:01:10.000Z' })])], 0)),
    ).toEqual([{ kind: 'extension', playerId: 'p-1' }]);
    expect(
      motion.observe(stateOf([round(0, [auction({ endsAtIso: '2026-11-01T00:01:10.000Z' })])], 0)),
    ).toEqual([]);
  });

  test('reports a lost lead only after the local seat led', () => {
    const motion = new CapRushAuctionMotion('p1');
    motion.observe(
      stateOf([round(0, [auction({ leaderSeat: 'p2', leaderBidDollars: 13_000_000 })])], 0),
    );
    expect(
      motion.observe(
        stateOf([round(0, [auction({ leaderSeat: 'p2', leaderBidDollars: 13_100_000 })])], 0),
      ),
    ).toEqual([{ kind: 'price', playerId: 'p-1' }]);

    const leading = new CapRushAuctionMotion('p1');
    leading.observe(
      stateOf([round(0, [auction({ leaderSeat: 'p1', leaderBidDollars: 13_000_000 })])], 0),
    );
    expect(
      leading.observe(
        stateOf([round(0, [auction({ leaderSeat: 'p2', leaderBidDollars: 13_100_000 })])], 0),
      ),
    ).toEqual([
      { kind: 'price', playerId: 'p-1' },
      { kind: 'lost-lead', playerId: 'p-1' },
    ]);
  });

  test('reports a confirmed signing once', () => {
    const motion = new CapRushAuctionMotion('p1');
    motion.observe(stateOf([round(0, [auction()])], 0));
    const signed = stateOf([round(0, [auction()])], 0, [signing]);
    expect(motion.observe(signed)).toEqual([{ kind: 'signed', signing }]);
    expect(motion.observe(signed)).toEqual([]);
  });

  test('reports a round change without replaying the new pool', () => {
    const motion = new CapRushAuctionMotion('p1');
    motion.observe(stateOf([round(0, [auction()])], 0));
    const next = stateOf(
      [round(0, [auction()], 'SG'), round(1, [auction({ playerId: 'p-2', position: 'SF' })], 'SF')],
      1,
    );
    expect(motion.observe(next)).toEqual([{ kind: 'round' }]);
    expect(motion.observe(next)).toEqual([]);
  });
});
