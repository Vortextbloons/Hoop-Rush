import { describe, expect, test } from 'bun:test';
import {
  CAP_RUSH_MULTIPLAYER_AUCTION_MS,
  CAP_RUSH_MULTIPLAYER_BID_INCREMENT_DOLLARS,
  CAP_RUSH_MULTIPLAYER_MIN_EXTENSION_MS,
  POSITIONS,
  capRushMultiplayerAutoSignPrioritySeed,
  capRushMultiplayerMarketSeed,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { capRushTestSetup } from '../cap-rush-test-support.ts';
import { capRushSalaryDollars } from '../salary.ts';
import { capRushMultiplayerMinimumBidDollars } from './pricing.ts';
import { buildCapRushMultiplayerMarket } from './market.ts';
import { capRushMultiplayerCompletionFeasible } from './joint-feasibility.ts';
import {
  applyCapRushMultiplayerBid,
  cancelCapRushMultiplayerBid,
  capRushMultiplayerActiveRound,
  capRushMultiplayerCloseDueAuctions,
  capRushMultiplayerNextDeadline,
  createCapRushMultiplayerRecruitment,
} from './auction.ts';
import { createRng } from '../../../sim/rng.ts';

const ROOT = seedSchema.parse('abc123def4567890');
const OPEN = '2026-11-01T00:00:00.000Z';

function market() {
  const setup = capRushTestSetup();
  return buildCapRushMultiplayerMarket({ index: setup.index, rootSeed: ROOT });
}

function recruitment() {
  return createCapRushMultiplayerRecruitment({ market: market(), openedAtIso: OPEN });
}

function bid(
  state: ReturnType<typeof recruitment>,
  seat: 'p1' | 'p2',
  playerId: string,
  totalDollars: number,
  acceptedAtIso = '2026-11-01T00:00:05.000Z',
) {
  return applyCapRushMultiplayerBid(state, { seat, playerId, totalDollars, acceptedAtIso });
}

describe('cap rush multiplayer pricing', () => {
  test('applies the 35% discount at and above 90 overall', () => {
    for (const overall of [90, 95, 99]) {
      const solo = capRushSalaryDollars(overall, '1995-96');
      expect(capRushMultiplayerMinimumBidDollars(overall, '1995-96')).toBe(
        Math.floor((solo * 35 + 50) / 100),
      );
    }
  });

  test('applies the 65% discount below 90 overall', () => {
    for (const overall of [40, 60, 75, 80, 85, 89]) {
      const solo = capRushSalaryDollars(overall, '1995-96');
      expect(capRushMultiplayerMinimumBidDollars(overall, '1995-96')).toBe(
        Math.floor((solo * 65 + 50) / 100),
      );
    }
  });

  test('keeps the intentional 89/90 price cliff', () => {
    const below = capRushMultiplayerMinimumBidDollars(89, '1995-96');
    const at = capRushMultiplayerMinimumBidDollars(90, '1995-96');
    expect(at).toBeLessThan(below);
  });

  test('keeps the era adjustment before discounting', () => {
    const modern = capRushMultiplayerMinimumBidDollars(80, '1995-96');
    const sixties = capRushMultiplayerMinimumBidDollars(80, '1965-66');
    expect(sixties).toBeLessThan(modern);
  });
});

describe('cap rush multiplayer market', () => {
  test('is reproducible for the same root seed', () => {
    expect(market().digest).toBe(market().digest);
  });

  test('changes when the root seed changes', () => {
    const setup = capRushTestSetup();
    const left = buildCapRushMultiplayerMarket({ index: setup.index, rootSeed: ROOT });
    const right = buildCapRushMultiplayerMarket({
      index: setup.index,
      rootSeed: seedSchema.parse('fff123def4567890'),
    });
    expect(left.digest).not.toBe(right.digest);
  });

  test('holds 60 distinct players, twelve per position', () => {
    const built = market();
    expect(built.players).toHaveLength(60);
    expect(new Set(built.players.map((player) => player.playerId)).size).toBe(60);
    for (const position of POSITIONS) {
      expect(built.players.filter((player) => player.position === position)).toHaveLength(12);
    }
  });

  test('fills every bucket twice per position', () => {
    const built = market();
    for (const position of POSITIONS) {
      const pool = built.players.filter((player) => player.position === position);
      for (const bucket of ['elite', 'star', 'strong', 'rotation', 'budget', 'wildcard'] as const) {
        expect(pool.filter((player) => player.bucket === bucket)).toHaveLength(2);
      }
    }
  });

  test('keeps every minimum at or below the solo salary', () => {
    for (const player of market().players) {
      expect(player.minimumBidDollars).toBeLessThanOrEqual(player.soloSalaryDollars);
      expect(player.minimumBidDollars).toBeGreaterThan(0);
    }
  });

  test('produces an affordable route for both seats', () => {
    expect(
      capRushMultiplayerCompletionFeasible({
        players: market().players,
        unavailablePlayerIds: new Set(),
        seats: {
          p1: { committedDollars: 0, reservedDollars: 0, filledPositions: [] },
          p2: { committedDollars: 0, reservedDollars: 0, filledPositions: [] },
        },
      }),
    ).toBe(true);
  });

  test('assigns one position to a player eligible at several positions', () => {
    const built = market();
    const positions = new Map<string, string>();
    for (const player of built.players) {
      expect(positions.has(player.playerId)).toBe(false);
      positions.set(player.playerId, player.position);
    }
  });
});

describe('cap rush multiplayer joint feasibility', () => {
  test('rejects when the two cheapest players cannot both be afforded', () => {
    const players = [
      { playerId: 'a', position: 'PG' as const, minimumBidDollars: 10 },
      { playerId: 'b', position: 'PG' as const, minimumBidDollars: 20 },
    ];
    const filledElsewhere = ['SG', 'SF', 'PF', 'C'] as const;
    const seats = {
      p1: { committedDollars: 15, reservedDollars: 0, filledPositions: [...filledElsewhere] },
      p2: { committedDollars: 0, reservedDollars: 0, filledPositions: [...filledElsewhere] },
    };
    expect(
      capRushMultiplayerCompletionFeasible({
        players,
        unavailablePlayerIds: new Set(),
        seats,
        limitDollars: 24,
      }),
    ).toBe(false);
    expect(
      capRushMultiplayerCompletionFeasible({
        players,
        unavailablePlayerIds: new Set(),
        seats,
        limitDollars: 25,
      }),
    ).toBe(true);
  });

  test('uses only the cheapest player when one seat still needs the position', () => {
    const players = [
      { playerId: 'a', position: 'PG' as const, minimumBidDollars: 10 },
      { playerId: 'b', position: 'PG' as const, minimumBidDollars: 99 },
    ];
    expect(
      capRushMultiplayerCompletionFeasible({
        players,
        unavailablePlayerIds: new Set(),
        seats: {
          p1: { committedDollars: 0, reservedDollars: 0, filledPositions: ['SG', 'SF', 'PF', 'C'] },
          p2: {
            committedDollars: 0,
            reservedDollars: 0,
            filledPositions: ['PG', 'SG', 'SF', 'PF', 'C'],
          },
        },
        limitDollars: 10,
      }),
    ).toBe(true);
  });

  test('counts committed and reserved money', () => {
    const players = [{ playerId: 'a', position: 'PG' as const, minimumBidDollars: 10 }];
    expect(
      capRushMultiplayerCompletionFeasible({
        players,
        unavailablePlayerIds: new Set(),
        seats: {
          p1: { committedDollars: 5, reservedDollars: 5, filledPositions: ['SG', 'SF', 'PF', 'C'] },
          p2: {
            committedDollars: 0,
            reservedDollars: 0,
            filledPositions: ['PG', 'SG', 'SF', 'PF', 'C'],
          },
        },
        limitDollars: 19,
      }),
    ).toBe(false);
  });
});

describe('cap rush multiplayer auction', () => {
  test('opens twelve lots with sixty seconds', () => {
    const state = recruitment();
    const round = capRushMultiplayerActiveRound(state);
    expect(round.auctions).toHaveLength(12);
    for (const auction of round.auctions) {
      expect(Date.parse(auction.endsAtIso) - Date.parse(auction.openedAtIso)).toBe(
        CAP_RUSH_MULTIPLAYER_AUCTION_MS,
      );
    }
    expect(capRushMultiplayerNextDeadline(state)?.atIso).toBe(round.auctions[0]?.endsAtIso);
  });

  test('accepts a minimum bid and records the leader', () => {
    const state = recruitment();
    const lot = capRushMultiplayerActiveRound(state).auctions[0];
    if (lot === undefined) throw new Error('no lot');
    const player = market().players.find((entry) => entry.playerId === lot.playerId);
    if (player === undefined) throw new Error('no player');
    const outcome = bid(state, 'p1', lot.playerId, player.minimumBidDollars);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const round = capRushMultiplayerActiveRound(outcome.recruitment);
    expect(round.auctions[0]?.leaderSeat).toBe('p1');
    expect(round.auctions[0]?.leaderBidDollars).toBe(player.minimumBidDollars);
    expect(outcome.recruitment.seats.p1.leadPlayerId).toBe(lot.playerId);
  });

  test('accepts multiple leads and signs only the highest winning offer', () => {
    const state = recruitment();
    const [first, second] = capRushMultiplayerActiveRound(state).auctions;
    if (first === undefined || second === undefined) throw new Error('no lots');
    const firstPlayer = market().players.find((entry) => entry.playerId === first.playerId);
    const secondPlayer = market().players.find((entry) => entry.playerId === second.playerId);
    if (firstPlayer === undefined || secondPlayer === undefined) throw new Error('no players');
    const leading = bid(state, 'p1', first.playerId, firstPlayer.minimumBidDollars);
    if (!leading.ok) throw new Error(leading.message);
    const rejected = bid(
      leading.recruitment,
      'p1',
      second.playerId,
      secondPlayer.minimumBidDollars,
    );
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    const closed = capRushMultiplayerCloseDueAuctions(rejected.recruitment, {
      round: 0,
      acceptedAtIso: '2026-11-01T00:02:00.000Z',
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    const signed = closed.recruitment.signings.filter((entry) => entry.seat === 'p1');
    expect(signed).toHaveLength(1);
    expect(signed[0]?.salaryDollars).toBe(
      Math.max(firstPlayer.minimumBidDollars, secondPlayer.minimumBidDollars),
    );
    const cancelled = cancelCapRushMultiplayerBid(rejected.recruitment, {
      seat: 'p1',
      playerId: first.playerId,
      acceptedAtIso: '2026-11-01T00:00:06.000Z',
    });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(
      capRushMultiplayerActiveRound(cancelled.recruitment).auctions.find(
        (entry) => entry.playerId === first.playerId,
      )?.leaderSeat,
    ).toBeNull();
    expect(cancelled.recruitment.seats.p1.leadPlayerId).toBe(second.playerId);
  });

  test('requires a $100,000 raise and never replaces an equal offer', () => {
    const state = recruitment();
    const lot = capRushMultiplayerActiveRound(state).auctions[0];
    if (lot === undefined) throw new Error('no lot');
    const player = market().players.find((entry) => entry.playerId === lot.playerId);
    if (player === undefined) throw new Error('no player');
    const leading = bid(state, 'p1', lot.playerId, player.minimumBidDollars);
    if (!leading.ok) throw new Error(leading.message);
    const equal = bid(leading.recruitment, 'p2', lot.playerId, player.minimumBidDollars);
    expect(equal.ok).toBe(false);
    const tooSmall = bid(
      leading.recruitment,
      'p2',
      lot.playerId,
      player.minimumBidDollars + CAP_RUSH_MULTIPLAYER_BID_INCREMENT_DOLLARS - 1,
    );
    expect(tooSmall.ok).toBe(false);
    const legal = bid(
      leading.recruitment,
      'p2',
      lot.playerId,
      player.minimumBidDollars + CAP_RUSH_MULTIPLAYER_BID_INCREMENT_DOLLARS,
    );
    expect(legal.ok).toBe(true);
    if (!legal.ok) return;
    expect(capRushMultiplayerActiveRound(legal.recruitment).auctions[0]?.leaderSeat).toBe('p2');
  });

  test('frees an outbid seat to lead another lot', () => {
    const state = recruitment();
    const [first, second] = capRushMultiplayerActiveRound(state).auctions;
    if (first === undefined || second === undefined) throw new Error('no lots');
    const firstPlayer = market().players.find((entry) => entry.playerId === first.playerId);
    const secondPlayer = market().players.find((entry) => entry.playerId === second.playerId);
    if (firstPlayer === undefined || secondPlayer === undefined) throw new Error('no players');
    const p1 = bid(state, 'p1', first.playerId, firstPlayer.minimumBidDollars);
    if (!p1.ok) throw new Error(p1.message);
    const p2 = bid(
      p1.recruitment,
      'p2',
      first.playerId,
      firstPlayer.minimumBidDollars + CAP_RUSH_MULTIPLAYER_BID_INCREMENT_DOLLARS,
    );
    if (!p2.ok) throw new Error(p2.message);
    const switchLot = bid(p2.recruitment, 'p1', second.playerId, secondPlayer.minimumBidDollars);
    expect(switchLot.ok).toBe(true);
  });

  test('extends a late auction to at least ten seconds without resetting it', () => {
    const state = recruitment();
    const lot = capRushMultiplayerActiveRound(state).auctions[0];
    if (lot === undefined) throw new Error('no lot');
    const player = market().players.find((entry) => entry.playerId === lot.playerId);
    if (player === undefined) throw new Error('no player');
    const late = new Date(Date.parse(lot.endsAtIso) - 2_000).toISOString();
    const outcome = bid(state, 'p1', lot.playerId, player.minimumBidDollars, late);
    if (!outcome.ok) throw new Error(outcome.message);
    const updated = capRushMultiplayerActiveRound(outcome.recruitment).auctions[0];
    expect(updated?.endsAtIso).toBe(
      new Date(Date.parse(late) + CAP_RUSH_MULTIPLAYER_MIN_EXTENSION_MS).toISOString(),
    );
  });

  test('awards a closed lot at the winning bid and closes the round when both seats fill', () => {
    const built = market();
    const state = recruitment();
    const round = capRushMultiplayerActiveRound(state);
    const [first, second] = round.auctions;
    if (first === undefined || second === undefined) throw new Error('no lots');
    const firstPlayer = built.players.find((entry) => entry.playerId === first.playerId);
    const secondPlayer = built.players.find((entry) => entry.playerId === second.playerId);
    if (firstPlayer === undefined || secondPlayer === undefined) throw new Error('no players');
    const p1 = bid(state, 'p1', first.playerId, firstPlayer.minimumBidDollars);
    if (!p1.ok) throw new Error(p1.message);
    const p2 = bid(p1.recruitment, 'p2', second.playerId, secondPlayer.minimumBidDollars);
    if (!p2.ok) throw new Error(p2.message);
    const closed = capRushMultiplayerCloseDueAuctions(p2.recruitment, {
      round: 0,
      acceptedAtIso: new Date(
        Date.parse(OPEN) + CAP_RUSH_MULTIPLAYER_AUCTION_MS + 1_000,
      ).toISOString(),
    });
    if (!closed.ok) throw new Error(closed.message);
    expect(closed.roundComplete).toBe(false);
    expect(closed.recruitment.signings).toHaveLength(2);
    expect(closed.recruitment.signings.every((signing) => signing.source === 'bid')).toBe(true);
    expect(closed.recruitment.rounds[closed.recruitment.roundIndex]?.position).toBe('SG');
    expect(closed.recruitment.seats.p1.filledPositions).toEqual(['PG']);
    expect(closed.recruitment.seats.p2.filledPositions).toEqual(['PG']);
  });

  test('auto-signs the cheapest feasible player when a seat finishes the round empty', () => {
    const built = market();
    const state = recruitment();
    const round = capRushMultiplayerActiveRound(state);
    const lot = round.auctions[0];
    if (lot === undefined) throw new Error('no lot');
    const player = built.players.find((entry) => entry.playerId === lot.playerId);
    if (player === undefined) throw new Error('no player');
    const p1 = bid(state, 'p1', lot.playerId, player.minimumBidDollars);
    if (!p1.ok) throw new Error(p1.message);
    const closed = capRushMultiplayerCloseDueAuctions(p1.recruitment, {
      round: 0,
      acceptedAtIso: new Date(
        Date.parse(OPEN) + CAP_RUSH_MULTIPLAYER_AUCTION_MS + 1_000,
      ).toISOString(),
    });
    if (!closed.ok) throw new Error(closed.message);
    expect(closed.recruitment.signings).toHaveLength(2);
    const auto = closed.recruitment.signings.find((signing) => signing.seat === 'p2');
    expect(auto?.source).toBe('auto');
    expect(auto?.position).toBe('PG');
  });

  test('rejects a bid that would block joint completion', () => {
    const built = market();
    const state = recruitment();
    const lot = capRushMultiplayerActiveRound(state).auctions[0];
    if (lot === undefined) throw new Error('no lot');
    const player = built.players.find((entry) => entry.playerId === lot.playerId);
    if (player === undefined) throw new Error('no player');
    const rejected = bid(state, 'p1', lot.playerId, 182_000_000);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(['completion-rejected', 'bid-too-low']).toContain(rejected.code);
  });

  test('rejects closure before any deadline', () => {
    const state = recruitment();
    const outcome = capRushMultiplayerCloseDueAuctions(state, {
      round: 0,
      acceptedAtIso: OPEN,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('auction-not-due');
  });

  test('uses a deterministic auto-sign priority seed', () => {
    const seed = capRushMultiplayerAutoSignPrioritySeed(ROOT);
    const first = createRng(seed).pick(['p1', 'p2'] as const);
    const second = createRng(seed).pick(['p1', 'p2'] as const);
    expect(first).toBe(second);
    expect(capRushMultiplayerMarketSeed(ROOT, 0)).toBe(capRushMultiplayerMarketSeed(ROOT, 0));
  });
});

describe('multiple offers and cancellation', () => {
  function leadingOffers() {
    let state = recruitment();
    const players = state.market.players.filter((entry) => entry.position === 'PG').slice(0, 2);
    const amount = Math.max(...players.map((entry) => entry.minimumBidDollars)) + 100_000;
    for (const player of players) {
      const result = bid(state, 'p1', player.playerId, amount);
      if (!result.ok) throw new Error(result.message);
      state = result.recruitment;
    }
    return { state, players, amount };
  }

  test('breaks equal offers deterministically and releases unselected players', () => {
    const { state, players } = leadingOffers();
    const result = capRushMultiplayerCloseDueAuctions(state, {
      round: 0,
      acceptedAtIso: '2026-11-01T00:02:00.000Z',
    });
    if (!result.ok) throw new Error(result.message);
    const preferred = players.map((player) => player.playerId).sort()[0];
    expect(result.recruitment.signings.find((entry) => entry.seat === 'p1')?.playerId).toBe(
      preferred,
    );
    expect(
      result.recruitment.rounds[0]?.auctions.filter((entry) => entry.winningSeat === 'p1'),
    ).toHaveLength(1);
    expect(new Set(result.recruitment.signings.map((entry) => entry.playerId)).size).toBe(2);
    expect(
      capRushMultiplayerCloseDueAuctions(state, {
        round: 0,
        acceptedAtIso: '2026-11-01T00:02:00.000Z',
      }),
    ).toEqual(result);
  });

  test('only the leading owner can cancel before the deadline', () => {
    const { state, players } = leadingOffers();
    const player = players[0];
    if (!player) throw new Error('missing player');
    expect(
      cancelCapRushMultiplayerBid(state, {
        seat: 'p2',
        playerId: player.playerId,
        acceptedAtIso: '2026-11-01T00:00:06.000Z',
      }).ok,
    ).toBe(false);
    expect(
      cancelCapRushMultiplayerBid(state, {
        seat: 'p1',
        playerId: player.playerId,
        acceptedAtIso: '2026-11-01T00:01:00.000Z',
      }).ok,
    ).toBe(false);
    const result = cancelCapRushMultiplayerBid(state, {
      seat: 'p1',
      playerId: player.playerId,
      acceptedAtIso: '2026-11-01T00:00:06.000Z',
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.recruitment.signings).toHaveLength(0);
    expect(result.recruitment.seats.p1.leadPlayerId).toBe(players[1]?.playerId ?? null);
    expect(
      state.rounds[0]?.auctions.find((entry) => entry.playerId === player.playerId)?.leaderSeat,
    ).toBe('p1');
  });

  test('extends all lots together and prevents early signing', () => {
    const { state, players, amount } = leadingOffers();
    const player = players[0];
    if (!player) throw new Error('missing player');
    const result = bid(state, 'p2', player.playerId, amount + 100_000, '2026-11-01T00:00:59.000Z');
    if (!result.ok) throw new Error(result.message);
    expect(new Set(result.recruitment.rounds[0]?.auctions.map((entry) => entry.endsAtIso))).toEqual(
      new Set(['2026-11-01T00:01:09.000Z']),
    );
    expect(
      capRushMultiplayerCloseDueAuctions(result.recruitment, {
        round: 0,
        acceptedAtIso: '2026-11-01T00:01:00.000Z',
      }).ok,
    ).toBe(false);
    expect(result.recruitment.signings).toHaveLength(0);
  });
});
