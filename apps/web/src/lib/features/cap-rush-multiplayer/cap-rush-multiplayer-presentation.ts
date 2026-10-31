import type {
  CapRushMultiplayerAuction,
  CapRushMultiplayerMarketPlayer,
  CapRushMultiplayerRecruitment,
  CapRushMultiplayerSeatId,
  CapRushMultiplayerState,
  Position,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_MULTIPLAYER_AUCTION_MS,
  CAP_RUSH_MULTIPLAYER_BID_INCREMENT_DOLLARS,
} from '@hoop-rush/data-contracts';
import { formatMillions } from '../cap-rush/cap-rush-presentation.js';

export function seatLabel(seat: CapRushMultiplayerSeatId): string {
  return seat === 'p1' ? 'Host' : 'Guest';
}

export function seatLabelFor(
  seat: CapRushMultiplayerSeatId,
  localSeat: CapRushMultiplayerSeatId,
): string {
  return seat === localSeat ? 'You' : seatLabel(seat);
}

export function positionLabel(position: Position): string {
  switch (position) {
    case 'PG':
      return 'Point guard';
    case 'SG':
      return 'Shooting guard';
    case 'SF':
      return 'Small forward';
    case 'PF':
      return 'Power forward';
    default:
      return 'Center';
  }
}

export function money(dollars: number): string {
  return formatMillions(dollars);
}

/** Normalizes the coordination clock to the UTC ISO form the state schema requires. */
export function capRushMultiplayerAcceptedAt(clockValue: unknown, now: Date = new Date()): string {
  if (typeof clockValue === 'string') {
    const parsed = Date.parse(clockValue);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return now.toISOString();
}

export function remainingMs(endsAtIso: string, nowMs: number): number {
  return Math.max(0, Date.parse(endsAtIso) - nowMs);
}

export function clockLabel(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

export function auctionProgress(auction: CapRushMultiplayerAuction, nowMs: number): number {
  const opened = Date.parse(auction.openedAtIso);
  const ends = Date.parse(auction.endsAtIso);
  if (ends <= opened) return 0;
  const remaining = Math.max(0, ends - nowMs);
  return Math.min(1, remaining / Math.max(CAP_RUSH_MULTIPLAYER_AUCTION_MS, ends - opened));
}

export function currentRound(
  recruitment: CapRushMultiplayerRecruitment,
): CapRushMultiplayerRecruitment['rounds'][number] {
  const round = recruitment.rounds[recruitment.rounds.length - 1];
  if (round === undefined) throw new Error('the recruitment has no active round');
  return round;
}

export function playerById(
  recruitment: CapRushMultiplayerRecruitment,
  playerId: string,
): CapRushMultiplayerMarketPlayer | undefined {
  return recruitment.market.players.find((player) => player.playerId === playerId);
}

export function nextMinimumBid(
  auction: CapRushMultiplayerAuction,
  player: CapRushMultiplayerMarketPlayer,
): number {
  return auction.leaderBidDollars === null
    ? player.minimumBidDollars
    : auction.leaderBidDollars + CAP_RUSH_MULTIPLAYER_BID_INCREMENT_DOLLARS;
}

export type LotState =
  'open' | 'you-lead' | 'outbid' | 'sold-to-you' | 'sold-to-opponent' | 'unsold';

export function lotState(
  auction: CapRushMultiplayerAuction,
  localSeat: CapRushMultiplayerSeatId,
): LotState {
  if (auction.status === 'closed') {
    if (auction.winningSeat === null) return 'unsold';
    return auction.winningSeat === localSeat ? 'sold-to-you' : 'sold-to-opponent';
  }
  if (auction.leaderSeat === null) return 'open';
  return auction.leaderSeat === localSeat ? 'you-lead' : 'outbid';
}

export function lotStateLabel(state: LotState): string {
  switch (state) {
    case 'open':
      return 'No bids';
    case 'you-lead':
      return 'You lead';
    case 'outbid':
      return 'Opponent leads';
    case 'sold-to-you':
      return 'Sold to you';
    case 'sold-to-opponent':
      return 'Sold to opponent';
    default:
      return 'Unsold';
  }
}

export function seatSignedCount(
  state: CapRushMultiplayerState,
  seat: CapRushMultiplayerSeatId,
): number {
  return state.recruitment?.seats[seat].filledPositions.length ?? 0;
}

export function deadlineLabel(state: CapRushMultiplayerState, nowMs: number): string | null {
  if (state.recruitment === null) return null;
  const round = currentRound(state.recruitment);
  if (round.status !== 'bidding') return null;
  const ends = round.auctions
    .filter((auction) => auction.status === 'open')
    .map((auction) => Date.parse(auction.endsAtIso));
  if (ends.length === 0) return null;
  return clockLabel(Math.min(...ends) - nowMs);
}
