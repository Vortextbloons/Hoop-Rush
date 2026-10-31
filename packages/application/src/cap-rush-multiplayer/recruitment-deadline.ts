import type {
  CapRushMultiplayerLockedInputs,
  CapRushMultiplayerSeatId,
  CapRushMultiplayerSeasonState,
  CapRushMultiplayerState,
} from '@hoop-rush/data-contracts';
import { capRushMultiplayerAcceptedThrough } from '@hoop-rush/engine';

export interface CapRushMultiplayerNextDeadline {
  readonly cursor: string;
  readonly atIso: string;
}

export function capRushMultiplayerDeadlineOf(
  state: CapRushMultiplayerState,
): CapRushMultiplayerNextDeadline | null {
  const recruitment = state.recruitment;
  if (recruitment === null) return null;
  const round = recruitment.rounds[recruitment.rounds.length - 1];
  if (round === undefined || round.status !== 'bidding') return null;
  let earliest: CapRushMultiplayerNextDeadline | null = null;
  for (const auction of round.auctions) {
    if (auction.status !== 'open') continue;
    if (earliest === null || auction.endsAtIso < earliest.atIso) {
      earliest = {
        cursor: `auction:${String(round.index)}:${auction.playerId}`,
        atIso: auction.endsAtIso,
      };
    }
  }
  return earliest;
}

export function capRushMultiplayerIsDue(state: CapRushMultiplayerState, nowMs: number): boolean {
  const deadline = capRushMultiplayerDeadlineOf(state);
  return deadline !== null && Date.parse(deadline.atIso) <= nowMs;
}

export function capRushMultiplayerNextSlot(state: CapRushMultiplayerState): number | null {
  const season = state.season;
  if (state.phase !== 'season' || season === null) return null;
  const accepted = capRushMultiplayerAcceptedThrough(season.games);
  return accepted < season.block.endpoint ? accepted + 1 : null;
}

export function capRushMultiplayerPendingH2H(input: {
  readonly state: CapRushMultiplayerState;
  readonly locked: CapRushMultiplayerLockedInputs | null;
}): {
  readonly gameId: string;
  readonly slot: number;
  readonly missing: readonly CapRushMultiplayerSeatId[];
} | null {
  const season = input.state.season;
  const locked = input.locked;
  if (season === null || locked === null) return null;
  const ids = new Set([
    locked.seats.p1.franchise.franchiseId,
    locked.seats.p2.franchise.franchiseId,
  ]);
  for (const game of season.games) {
    if (!ids.has(game.homeTeamId) || !ids.has(game.awayTeamId)) continue;
    if (game.slot > season.frontierSlot + 1) continue;
    const missing = (['p1', 'p2'] as const).filter(
      (seat) =>
        !season.playbackAcks.some(
          (ack) => ack.gameId === game.gameId && ack.seat === seat && ack.resolved,
        ),
    );
    if (missing.length > 0) {
      return { gameId: game.gameId, slot: game.slot, missing };
    }
  }
  return null;
}

export function capRushMultiplayerSlotAckPending(
  season: CapRushMultiplayerSeasonState,
  seat: CapRushMultiplayerSeatId,
): number | null {
  const accepted = capRushMultiplayerAcceptedThrough(season.games);
  if (season.slotAcks[seat] >= accepted) return null;
  return season.slotAcks[seat] + 1;
}
