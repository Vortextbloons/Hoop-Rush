import { describe, expect, test } from 'bun:test';
import type {
  CapRushMultiplayerAuction,
  CapRushMultiplayerMarketPlayer,
} from '@hoop-rush/data-contracts';
import {
  clockLabel,
  lotState,
  nextMinimumBid,
  remainingMs,
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

function auction(overrides: Partial<CapRushMultiplayerAuction> = {}): CapRushMultiplayerAuction {
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

describe('cap rush multiplayer presentation', () => {
  test('formats the auction clock', () => {
    expect(clockLabel(60_000)).toBe('1:00');
    expect(clockLabel(9_400)).toBe('0:10');
    expect(clockLabel(0)).toBe('0:00');
    expect(remainingMs('2026-11-01T00:00:10.000Z', Date.parse('2026-11-01T00:00:00.000Z'))).toBe(
      10_000,
    );
  });

  test('requires a $100,000 raise over the leader', () => {
    expect(nextMinimumBid(auction(), player)).toBe(12_075_000);
    expect(
      nextMinimumBid(auction({ leaderSeat: 'p1', leaderBidDollars: 13_000_000 }), player),
    ).toBe(13_100_000);
  });

  test('labels lots from the local seat perspective', () => {
    expect(lotState(auction(), 'p1')).toBe('open');
    expect(lotState(auction({ leaderSeat: 'p1', leaderBidDollars: 12_100_000 }), 'p1')).toBe(
      'you-lead',
    );
    expect(lotState(auction({ leaderSeat: 'p2', leaderBidDollars: 12_100_000 }), 'p1')).toBe(
      'outbid',
    );
    expect(
      lotState(
        auction({
          status: 'closed',
          leaderSeat: 'p1',
          leaderBidDollars: 12_100_000,
          winningSeat: 'p1',
          winningBidDollars: 12_100_000,
        }),
        'p1',
      ),
    ).toBe('sold-to-you');
    expect(
      lotState(auction({ status: 'closed', leaderSeat: null, leaderBidDollars: null }), 'p1'),
    ).toBe('unsold');
  });
});
