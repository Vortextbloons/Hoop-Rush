import type {
  CapRushMultiplayerAuction,
  CapRushMultiplayerCommandRejectionCode,
  CapRushMultiplayerMarket,
  CapRushMultiplayerMarketPlayer,
  CapRushMultiplayerRecruitment,
  CapRushMultiplayerRound,
  CapRushMultiplayerSeatId,
  CapRushMultiplayerSeatRecruitment,
  CapRushMultiplayerSigning,
  Position,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_MULTIPLAYER_AUCTION_MS,
  CAP_RUSH_MULTIPLAYER_BID_INCREMENT_DOLLARS,
  CAP_RUSH_MULTIPLAYER_MIN_EXTENSION_MS,
  CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
  POSITIONS,
  capRushMultiplayerAutoSignPrioritySeed,
} from '@hoop-rush/data-contracts';
import { createRng } from '../../../sim/rng.ts';
import { capRushMultiplayerCompletionFeasible } from './joint-feasibility.ts';
import { capRushMultiplayerMarketPlayerOf } from './market.ts';
import { CapRushMultiplayerCompletionError } from './market.ts';

export type CapRushAuctionOutcome =
  | {
      readonly ok: true;
      readonly recruitment: CapRushMultiplayerRecruitment;
      readonly roundComplete: boolean;
    }
  | {
      readonly ok: false;
      readonly code: CapRushMultiplayerCommandRejectionCode;
      readonly message: string;
    };

function reject(
  code: CapRushMultiplayerCommandRejectionCode,
  message: string,
): CapRushAuctionOutcome {
  return { ok: false, code, message };
}

function lastRound(recruitment: CapRushMultiplayerRecruitment): CapRushMultiplayerRound {
  const round = recruitment.rounds[recruitment.rounds.length - 1];
  if (round === undefined) throw new Error('cap rush multiplayer: recruitment has no round');
  return round;
}

function signingOf(
  recruitment: CapRushMultiplayerRecruitment,
  seat: CapRushMultiplayerSeatId,
  position: Position,
): CapRushMultiplayerSigning | undefined {
  return recruitment.signings.find(
    (signing) => signing.seat === seat && signing.position === position,
  );
}

function committedDollars(
  recruitment: CapRushMultiplayerRecruitment,
  seat: CapRushMultiplayerSeatId,
): number {
  return recruitment.signings
    .filter((signing) => signing.seat === seat)
    .reduce((total, signing) => total + signing.salaryDollars, 0);
}

function reservedDollars(round: CapRushMultiplayerRound, seat: CapRushMultiplayerSeatId): number {
  return round.auctions
    .filter(
      (auction) =>
        auction.status === 'open' &&
        auction.leaderSeat === seat &&
        auction.leaderBidDollars !== null,
    )
    .reduce((total, auction) => total + (auction.leaderBidDollars ?? 0), 0);
}

function filledPositions(
  recruitment: CapRushMultiplayerRecruitment,
  seat: CapRushMultiplayerSeatId,
): Position[] {
  return recruitment.signings
    .filter((signing) => signing.seat === seat)
    .map((signing) => signing.position);
}

function recomputeSeats(
  recruitment: CapRushMultiplayerRecruitment,
  round = lastRound(recruitment),
): CapRushMultiplayerRecruitment['seats'] {
  const seatOf = (seat: CapRushMultiplayerSeatId): CapRushMultiplayerSeatRecruitment => ({
    seat,
    filledPositions: filledPositions(recruitment, seat),
    leadPlayerId:
      round.auctions.find((auction) => auction.status === 'open' && auction.leaderSeat === seat)
        ?.playerId ?? null,
    payrollDollars: committedDollars(recruitment, seat),
  });
  return { p1: seatOf('p1'), p2: seatOf('p2') };
}

function feasibilityOf(
  recruitment: CapRushMultiplayerRecruitment,
  round: CapRushMultiplayerRound,
): boolean {
  const reserved = new Set(
    round.auctions
      .filter((auction) => auction.status === 'open' && auction.leaderSeat !== null)
      .map((auction) => auction.playerId),
  );
  const signed = new Set(recruitment.signings.map((signing) => signing.playerId));
  const unavailable = new Set<string>([...signed, ...reserved]);
  return capRushMultiplayerCompletionFeasible({
    players: recruitment.market.players,
    unavailablePlayerIds: unavailable,
    seats: {
      p1: {
        committedDollars: committedDollars(recruitment, 'p1'),
        reservedDollars: reservedDollars(round, 'p1'),
        filledPositions: filledPositions(recruitment, 'p1'),
      },
      p2: {
        committedDollars: committedDollars(recruitment, 'p2'),
        reservedDollars: reservedDollars(round, 'p2'),
        filledPositions: filledPositions(recruitment, 'p2'),
      },
    },
  });
}

export function capRushMultiplayerOpenRound(input: {
  readonly market: CapRushMultiplayerMarket;
  readonly index: number;
  readonly openedAtIso: string;
}): CapRushMultiplayerRound {
  const position = POSITIONS[input.index];
  if (position === undefined) {
    throw new Error(`cap rush multiplayer: round ${String(input.index)} is out of range`);
  }
  const openedAt = Date.parse(input.openedAtIso);
  if (!Number.isFinite(openedAt)) {
    throw new Error(`cap rush multiplayer: invalid round open time ${input.openedAtIso}`);
  }
  const endsAtIso = new Date(openedAt + CAP_RUSH_MULTIPLAYER_AUCTION_MS).toISOString();
  const auctions: CapRushMultiplayerAuction[] = input.market.players
    .filter((player) => player.position === position)
    .map((player) => ({
      playerId: player.playerId,
      position,
      status: 'open' as const,
      openedAtIso: input.openedAtIso,
      endsAtIso,
      leaderSeat: null,
      leaderBidDollars: null,
      winningSeat: null,
      winningBidDollars: null,
    }));
  if (auctions.length !== 12) {
    throw new Error(
      `cap rush multiplayer: ${position} market holds ${String(auctions.length)} players`,
    );
  }
  return { index: input.index, position, status: 'bidding', auctions, closedAtIso: null };
}

export function createCapRushMultiplayerRecruitment(input: {
  readonly market: CapRushMultiplayerMarket;
  readonly openedAtIso: string;
}): CapRushMultiplayerRecruitment {
  const round = capRushMultiplayerOpenRound({
    market: input.market,
    index: 0,
    openedAtIso: input.openedAtIso,
  });
  const recruitment: CapRushMultiplayerRecruitment = {
    schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
    market: input.market,
    roundIndex: 0,
    rounds: [round],
    signings: [],
    seats: {
      p1: { seat: 'p1', filledPositions: [], leadPlayerId: null, payrollDollars: 0 },
      p2: { seat: 'p2', filledPositions: [], leadPlayerId: null, payrollDollars: 0 },
    },
  };
  return recruitment;
}

export function applyCapRushMultiplayerBid(
  recruitment: CapRushMultiplayerRecruitment,
  input: {
    readonly seat: CapRushMultiplayerSeatId;
    readonly playerId: string;
    readonly totalDollars: number;
    readonly acceptedAtIso: string;
  },
): CapRushAuctionOutcome {
  const round = lastRound(recruitment);
  if (round.status !== 'bidding') {
    return reject('invalid-phase', 'the position round is already complete');
  }
  if (signingOf(recruitment, input.seat, round.position) !== undefined) {
    return reject('position-filled', 'this seat already signed a player for the position');
  }
  const auction = round.auctions.find((entry) => entry.playerId === input.playerId);
  if (auction === undefined) {
    return reject('auction-closed', 'that player is not in the active round');
  }
  if (auction.status !== 'open') {
    return reject('auction-closed', 'that auction has closed');
  }
  const competingLead = round.auctions.find(
    (entry) =>
      entry.status === 'open' &&
      entry.leaderSeat === input.seat &&
      entry.playerId !== input.playerId,
  );
  if (competingLead !== undefined) {
    return reject('multiple-leads', 'this seat already leads another auction');
  }
  const marketPlayer = capRushMultiplayerMarketPlayerOf(recruitment.market, input.playerId);
  if (input.totalDollars < marketPlayer.minimumBidDollars) {
    return reject('bid-too-low', 'the bid is below the player minimum');
  }
  if (
    auction.leaderBidDollars !== null &&
    input.totalDollars < auction.leaderBidDollars + CAP_RUSH_MULTIPLAYER_BID_INCREMENT_DOLLARS
  ) {
    return reject('bid-too-low', 'a new bid must beat the leader by at least $100,000');
  }
  const acceptedAt = Date.parse(input.acceptedAtIso);
  if (!Number.isFinite(acceptedAt)) {
    throw new Error(`cap rush multiplayer: invalid accepted time ${input.acceptedAtIso}`);
  }
  const currentEnds = Date.parse(auction.endsAtIso);
  const minimumEnd = acceptedAt + CAP_RUSH_MULTIPLAYER_MIN_EXTENSION_MS;
  const endsAtIso = new Date(Math.max(currentEnds, minimumEnd)).toISOString();
  const nextAuctions = round.auctions.map((entry) =>
    entry.playerId === input.playerId
      ? {
          ...entry,
          leaderSeat: input.seat,
          leaderBidDollars: input.totalDollars,
          endsAtIso,
        }
      : entry,
  );
  const nextRound: CapRushMultiplayerRound = { ...round, auctions: nextAuctions };
  const next: CapRushMultiplayerRecruitment = {
    ...recruitment,
    rounds: [...recruitment.rounds.slice(0, -1), nextRound],
  };
  if (!feasibilityOf(next, nextRound)) {
    return reject(
      'completion-rejected',
      'that bid would leave the two teams unable to complete their rosters under the hard limit',
    );
  }
  return {
    ok: true,
    recruitment: { ...next, seats: recomputeSeats(next, nextRound) },
    roundComplete: false,
  };
}

function closeAuction(
  auction: CapRushMultiplayerAuction,
  closedAtIso: string,
): CapRushMultiplayerAuction {
  return {
    ...auction,
    status: 'closed',
    winningSeat: auction.leaderSeat,
    winningBidDollars: auction.leaderBidDollars,
    endsAtIso: auction.endsAtIso < closedAtIso ? auction.endsAtIso : closedAtIso,
  };
}

function awardsOf(
  round: CapRushMultiplayerRound,
  market: CapRushMultiplayerMarket,
): CapRushMultiplayerSigning[] {
  const signings: CapRushMultiplayerSigning[] = [];
  for (const auction of round.auctions) {
    if (auction.status !== 'closed' || auction.winningSeat === null) continue;
    const player = capRushMultiplayerMarketPlayerOf(market, auction.playerId);
    signings.push({
      seat: auction.winningSeat,
      position: round.position,
      playerId: player.playerId,
      playerVersionId: player.playerVersionId,
      displayName: player.displayName,
      salaryDollars: auction.winningBidDollars ?? player.minimumBidDollars,
      source: 'bid',
    });
  }
  return signings;
}

function autoSignSeat(
  recruitment: CapRushMultiplayerRecruitment,
  round: CapRushMultiplayerRound,
  seat: CapRushMultiplayerSeatId,
): CapRushMultiplayerSigning {
  const candidates = recruitment.market.players
    .filter(
      (player) =>
        player.position === round.position &&
        !recruitment.signings.some((signing) => signing.playerId === player.playerId),
    )
    .sort(
      (left, right) =>
        left.minimumBidDollars - right.minimumBidDollars ||
        (left.playerId < right.playerId ? -1 : left.playerId > right.playerId ? 1 : 0),
    );
  for (const player of candidates) {
    const signing: CapRushMultiplayerSigning = {
      seat,
      position: round.position,
      playerId: player.playerId,
      playerVersionId: player.playerVersionId,
      displayName: player.displayName,
      salaryDollars: player.minimumBidDollars,
      source: 'auto',
    };
    const hypothetical: CapRushMultiplayerRecruitment = {
      ...recruitment,
      signings: [...recruitment.signings, signing],
    };
    if (feasibilityOf(hypothetical, round)) return signing;
  }
  throw new CapRushMultiplayerCompletionError(
    seat,
    `cap rush multiplayer: no affordable ${round.position} remains for ${seat}`,
  );
}

function autoSignPriority(
  recruitment: CapRushMultiplayerRecruitment,
  round: CapRushMultiplayerRound,
): readonly [CapRushMultiplayerSeatId, CapRushMultiplayerSeatId] {
  const first = createRng(capRushMultiplayerAutoSignPrioritySeed(recruitment.market.seed)).pick([
    'p1',
    'p2',
  ] as const);
  const second: CapRushMultiplayerSeatId = first === 'p1' ? 'p2' : 'p1';
  return round.index % 2 === 0 ? [first, second] : [second, first];
}

export function capRushMultiplayerCloseDueAuctions(
  recruitment: CapRushMultiplayerRecruitment,
  input: {
    readonly round: number;
    readonly acceptedAtIso: string;
  },
): CapRushAuctionOutcome {
  if (input.round !== recruitment.roundIndex) {
    return reject('round-mismatch', 'that position round is not active');
  }
  const round = lastRound(recruitment);
  if (round.status !== 'bidding') {
    return reject('invalid-phase', 'the position round is already complete');
  }
  const now = Date.parse(input.acceptedAtIso);
  if (!Number.isFinite(now)) {
    throw new Error(`cap rush multiplayer: invalid closure time ${input.acceptedAtIso}`);
  }
  const due = round.auctions.filter(
    (auction) => auction.status === 'open' && Date.parse(auction.endsAtIso) <= now,
  );
  if (due.length === 0) {
    return reject('auction-not-due', 'no auction has reached its deadline');
  }
  let closed: CapRushMultiplayerRound = {
    ...round,
    auctions: round.auctions.map((auction) =>
      auction.status === 'open' && Date.parse(auction.endsAtIso) <= now
        ? closeAuction(auction, input.acceptedAtIso)
        : auction,
    ),
  };
  let signings = [...recruitment.signings, ...awardsOf(closed, recruitment.market)];
  const bothFilled =
    signings.some((signing) => signing.seat === 'p1' && signing.position === round.position) &&
    signings.some((signing) => signing.seat === 'p2' && signing.position === round.position);
  if (bothFilled) {
    closed = {
      ...closed,
      auctions: closed.auctions.map((auction) =>
        auction.status === 'open' ? closeAuction(auction, input.acceptedAtIso) : auction,
      ),
    };
  }
  const allClosed = closed.auctions.every((auction) => auction.status === 'closed');
  let next: CapRushMultiplayerRecruitment = {
    ...recruitment,
    rounds: [...recruitment.rounds.slice(0, -1), closed],
    signings,
  };
  if (allClosed || bothFilled) {
    for (const seat of autoSignPriority(next, closed)) {
      if (signingOf(next, seat, closed.position) !== undefined) continue;
      const signing = autoSignSeat(next, closed, seat);
      signings = [...next.signings, signing];
      next = { ...next, signings };
    }
    const completed: CapRushMultiplayerRound = {
      ...closed,
      status: 'complete',
      closedAtIso: input.acceptedAtIso,
    };
    const rounds = [...next.rounds.slice(0, -1), completed];
    next = { ...next, rounds };
    if (completed.index < POSITIONS.length - 1) {
      const nextRound = capRushMultiplayerOpenRound({
        market: next.market,
        index: completed.index + 1,
        openedAtIso: input.acceptedAtIso,
      });
      next = { ...next, roundIndex: nextRound.index, rounds: [...rounds, nextRound] };
    }
    return {
      ok: true,
      recruitment: { ...next, seats: recomputeSeats(next, lastRound(next)) },
      roundComplete: completed.index === POSITIONS.length - 1,
    };
  }
  return {
    ok: true,
    recruitment: { ...next, seats: recomputeSeats(next, closed) },
    roundComplete: false,
  };
}

export function capRushMultiplayerRecruitmentComplete(
  recruitment: CapRushMultiplayerRecruitment,
): boolean {
  const round = lastRound(recruitment);
  return round.index === POSITIONS.length - 1 && round.status === 'complete';
}

export function capRushMultiplayerActiveRound(
  recruitment: CapRushMultiplayerRecruitment,
): CapRushMultiplayerRound {
  return lastRound(recruitment);
}

export function capRushMultiplayerNextDeadline(
  recruitment: CapRushMultiplayerRecruitment,
): { readonly cursor: string; readonly atIso: string } | null {
  const round = lastRound(recruitment);
  if (round.status !== 'bidding') return null;
  let earliest: CapRushMultiplayerAuction | null = null;
  for (const auction of round.auctions) {
    if (auction.status !== 'open') continue;
    if (earliest === null || auction.endsAtIso < earliest.endsAtIso) earliest = auction;
  }
  if (earliest === null) return null;
  return {
    cursor: `auction:${String(round.index)}:${earliest.playerId}`,
    atIso: earliest.endsAtIso,
  };
}

export function capRushMultiplayerLeaders(recruitment: CapRushMultiplayerRecruitment): {
  readonly p1: string | null;
  readonly p2: string | null;
} {
  return { p1: recruitment.seats.p1.leadPlayerId, p2: recruitment.seats.p2.leadPlayerId };
}

export function capRushMultiplayerSigningPlayer(
  recruitment: CapRushMultiplayerRecruitment,
  playerId: string,
): CapRushMultiplayerMarketPlayer {
  return capRushMultiplayerMarketPlayerOf(recruitment.market, playerId);
}
