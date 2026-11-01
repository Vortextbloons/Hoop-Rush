import type {
  CapRushMultiplayerAuction,
  CapRushMultiplayerSeatId,
  CapRushMultiplayerSigning,
  CapRushMultiplayerState,
} from '@hoop-rush/data-contracts';
import { activeRound } from './cap-rush-multiplayer-presentation.js';

interface LotSnapshot {
  readonly endsAtIso: string;
  readonly leaderSeat: CapRushMultiplayerSeatId | null;
  readonly leaderBidDollars: number | null;
}

export type AuctionMotionEvent =
  | { readonly kind: 'round' }
  | { readonly kind: 'price'; readonly playerId: string }
  | { readonly kind: 'extension'; readonly playerId: string }
  | { readonly kind: 'lost-lead'; readonly playerId: string }
  | { readonly kind: 'signed'; readonly signing: CapRushMultiplayerSigning };

function snapshotOf(auction: CapRushMultiplayerAuction): LotSnapshot {
  return {
    endsAtIso: auction.endsAtIso,
    leaderSeat: auction.leaderSeat,
    leaderBidDollars: auction.leaderBidDollars,
  };
}

/**
 * Reports recorded changes once. The first observation primes the baseline, so a
 * reconnect renders the restored state without replaying past celebrations.
 */
export class CapRushAuctionMotion {
  private primed = false;
  private roundIndex: number | null = null;
  private readonly lots = new Map<string, LotSnapshot>();
  private readonly signed = new Set<string>();
  private readonly localSeat: CapRushMultiplayerSeatId;

  constructor(localSeat: CapRushMultiplayerSeatId) {
    this.localSeat = localSeat;
  }

  observe(state: CapRushMultiplayerState): AuctionMotionEvent[] {
    const recruitment = state.recruitment;
    if (recruitment === null) return [];
    const round = activeRound(recruitment);
    if (!this.primed) {
      this.roundIndex = round.index;
      for (const auction of round.auctions) this.lots.set(auction.playerId, snapshotOf(auction));
      for (const signing of recruitment.signings) this.signed.add(signing.playerId);
      this.primed = true;
      return [];
    }

    const events: AuctionMotionEvent[] = [];
    if (this.roundIndex !== round.index) {
      events.push({ kind: 'round' });
      this.roundIndex = round.index;
      this.lots.clear();
    }

    for (const auction of round.auctions) {
      const previous = this.lots.get(auction.playerId);
      if (previous !== undefined) {
        if (
          auction.leaderBidDollars !== null &&
          previous.leaderBidDollars !== auction.leaderBidDollars
        ) {
          events.push({ kind: 'price', playerId: auction.playerId });
        }
        if (Date.parse(auction.endsAtIso) > Date.parse(previous.endsAtIso)) {
          events.push({ kind: 'extension', playerId: auction.playerId });
        }
        if (previous.leaderSeat === this.localSeat && auction.leaderSeat !== this.localSeat) {
          events.push({ kind: 'lost-lead', playerId: auction.playerId });
        }
      }
      this.lots.set(auction.playerId, snapshotOf(auction));
    }

    for (const signing of recruitment.signings) {
      if (this.signed.has(signing.playerId)) continue;
      this.signed.add(signing.playerId);
      events.push({ kind: 'signed', signing });
    }

    return events;
  }
}
