import type {
  CapRushLeagueGame,
  CapRushLeagueScheduleEntry,
  CapRushMultiplayerAuction,
  CapRushMultiplayerLockedInputs,
  CapRushMultiplayerCommandRejectionCode,
  CapRushMultiplayerMarketPlayer,
  CapRushMultiplayerRecruitment,
  CapRushMultiplayerRound,
  CapRushMultiplayerSeatId,
  CapRushMultiplayerState,
  CapRushPayrollStatus,
  CapRushPostseasonUserOutcome,
  Position,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_MULTIPLAYER_BID_INCREMENT_DOLLARS,
  CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS,
  POSITIONS,
} from '@hoop-rush/data-contracts';
import { capRushPayrollStatus } from '@hoop-rush/engine';
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

export function activeRound(recruitment: CapRushMultiplayerRecruitment): CapRushMultiplayerRound {
  return (
    recruitment.rounds.find((round) => round.index === recruitment.roundIndex) ??
    currentRound(recruitment)
  );
}

export function teamNameOf(locked: CapRushMultiplayerLockedInputs | null, teamId: string): string {
  if (locked === null) return teamId;
  if (locked.seats.p1.franchise.franchiseId === teamId)
    return locked.seats.p1.franchise.displayName;
  if (locked.seats.p2.franchise.franchiseId === teamId)
    return locked.seats.p2.franchise.displayName;
  return locked.opponents.find((entry) => entry.team.teamId === teamId)?.team.displayName ?? teamId;
}

export function seatOrder(
  localSeat: CapRushMultiplayerSeatId,
): readonly [CapRushMultiplayerSeatId, CapRushMultiplayerSeatId] {
  return localSeat === 'p1' ? ['p1', 'p2'] : ['p2', 'p1'];
}

export interface CapRushSeatScheduleCell {
  readonly slot: number;
  readonly gameId: string;
  readonly opponentId: string;
  readonly humanHome: boolean;
  readonly played: boolean;
  readonly h2h: boolean;
  readonly won: boolean | null;
  readonly pointsFor: number | null;
  readonly pointsAgainst: number | null;
}

export function seatScheduleCells(input: {
  readonly schedule: readonly CapRushLeagueScheduleEntry[];
  readonly games: readonly CapRushLeagueGame[];
  readonly teamId: string;
  readonly opponentTeamId: string;
}): CapRushSeatScheduleCell[] {
  const played = new Map(input.games.map((game) => [game.gameId, game]));
  return input.schedule
    .filter((entry) => entry.homeTeamId === input.teamId || entry.awayTeamId === input.teamId)
    .sort((left, right) => left.slot - right.slot)
    .map((entry) => {
      const humanHome = entry.homeTeamId === input.teamId;
      const opponentId = humanHome ? entry.awayTeamId : entry.homeTeamId;
      const game = played.get(entry.gameId) ?? null;
      const pointsFor = game === null ? null : humanHome ? game.homePoints : game.awayPoints;
      const pointsAgainst = game === null ? null : humanHome ? game.awayPoints : game.homePoints;
      return {
        slot: entry.slot,
        gameId: entry.gameId,
        opponentId,
        humanHome,
        played: game !== null,
        h2h: opponentId === input.opponentTeamId,
        won: pointsFor === null || pointsAgainst === null ? null : pointsFor > pointsAgainst,
        pointsFor,
        pointsAgainst,
      };
    });
}

/** Exact integer dollars for submitted totals and button labels. Never approximates. */
export function exactMoney(dollars: number): string {
  const rounded = Math.trunc(dollars);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$${Math.abs(rounded).toLocaleString('en-US')}`;
}

/** Parses a typed total. Returns null unless the value is a whole dollar amount. */
export function parseBidDollars(raw: string): number | null {
  const cleaned = raw.trim().replace(/^\$/, '').replace(/[,\s]/g, '');
  if (cleaned === '' || !/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}

export interface BidQuickChoice {
  readonly totalDollars: number;
  readonly hint: string;
}

export function bidQuickChoices(
  auction: CapRushMultiplayerAuction,
  player: CapRushMultiplayerMarketPlayer,
): BidQuickChoice[] {
  const baseline = auction.leaderBidDollars ?? player.minimumBidDollars;
  const offset = CAP_RUSH_MULTIPLAYER_BID_INCREMENT_DOLLARS;
  const choices: BidQuickChoice[] = [
    { totalDollars: nextMinimumBid(auction, player), hint: 'Next bid' },
    { totalDollars: baseline + offset, hint: '+$100K' },
    { totalDollars: baseline + 5 * offset, hint: '+$500K' },
    { totalDollars: baseline + 10 * offset, hint: '+$1M' },
  ];
  const seen = new Set<number>();
  return choices.filter((choice) => {
    if (seen.has(choice.totalDollars)) return false;
    seen.add(choice.totalDollars);
    return true;
  });
}

export interface SeatPayrollSummary {
  readonly signedPayrollDollars: number;
  readonly bindingBidDollars: number | null;
  readonly bindingPlayerId: string | null;
  readonly bindingPlayerName: string | null;
  readonly payrollDollars: number;
  readonly headroomDollars: number;
  readonly status: CapRushPayrollStatus;
  readonly filledPositions: readonly Position[];
}

export function seatPayrollSummary(
  state: CapRushMultiplayerState,
  seat: CapRushMultiplayerSeatId,
): SeatPayrollSummary {
  const recruitment = state.recruitment;
  const lockedPayroll = state.locked?.seats[seat].payrollDollars ?? null;
  const signedPayrollDollars = lockedPayroll ?? recruitment?.seats[seat].payrollDollars ?? 0;
  const round = recruitment === null ? null : activeRound(recruitment);
  const bindingAuction =
    round?.auctions
      .filter((auction) => auction.status === 'open' && auction.leaderSeat === seat)
      .sort(
        (left, right) =>
          (right.leaderBidDollars ?? 0) - (left.leaderBidDollars ?? 0) ||
          (left.playerId < right.playerId ? -1 : left.playerId > right.playerId ? 1 : 0),
      )[0] ?? null;
  const bindingBidDollars = bindingAuction?.leaderBidDollars ?? null;
  const bindingPlayerId = bindingAuction?.playerId ?? null;
  const bindingPlayerName =
    bindingPlayerId === null || recruitment === null
      ? null
      : (playerById(recruitment, bindingPlayerId)?.displayName ?? null);
  const payrollDollars = signedPayrollDollars + (bindingBidDollars ?? 0);
  const filledPositions =
    state.locked?.seats[seat].picks.map((pick) => pick.slot) ??
    recruitment?.seats[seat].filledPositions ??
    [];
  return {
    signedPayrollDollars,
    bindingBidDollars,
    bindingPlayerId,
    bindingPlayerName,
    payrollDollars,
    headroomDollars: CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS - payrollDollars,
    status: capRushPayrollStatus(payrollDollars),
    filledPositions,
  };
}

export interface BidProjection {
  readonly signedPayrollDollars: number;
  readonly bindingBidDollars: number | null;
  readonly projectedPayrollDollars: number;
  readonly headroomDollars: number;
  readonly status: CapRushPayrollStatus;
  readonly overHardLimit: boolean;
}

export function bidProjection(
  state: CapRushMultiplayerState,
  seat: CapRushMultiplayerSeatId,
  totalDollars: number,
): BidProjection {
  const summary = seatPayrollSummary(state, seat);
  const projectedPayrollDollars =
    summary.signedPayrollDollars + Math.max(totalDollars, summary.bindingBidDollars ?? 0);
  const headroomDollars = CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS - projectedPayrollDollars;
  return {
    signedPayrollDollars: summary.signedPayrollDollars,
    bindingBidDollars: summary.bindingBidDollars,
    projectedPayrollDollars,
    headroomDollars,
    status: capRushPayrollStatus(projectedPayrollDollars),
    overHardLimit: headroomDollars < 0,
  };
}

export interface BidRejectionContext {
  readonly nextMinimumDollars: number;
  readonly position: Position;
  readonly leadPlayerId?: string | null;
  readonly leadPlayerName?: string | null;
}

export type BidRejectionAction =
  | { readonly kind: 'use-next-bid'; readonly totalDollars: number }
  | { readonly kind: 'view-lead'; readonly playerId: string; readonly label: string };

export interface BidRejectionNotice {
  readonly message: string;
  readonly action: BidRejectionAction | null;
}

export interface CapRushBidAttempt {
  readonly round: number;
  readonly playerId: string;
  readonly totalDollars: number;
  readonly state: 'pending' | 'rejected';
  readonly code: string | null;
}

export function bidRejectionNotice(
  code: string | null,
  context: BidRejectionContext,
): BidRejectionNotice {
  const position = positionLabel(context.position);
  switch (code) {
    case 'auction-closed':
      return { message: 'That auction has closed. Pick another lot.', action: null };
    case 'invalid-phase':
    case 'round-mismatch':
      return {
        message: 'This position round has closed. The board is refreshing.',
        action: null,
      };
    case 'position-filled':
      return { message: `You already signed a ${position} this round.`, action: null };
    case 'multiple-leads':
      return {
        message:
          context.leadPlayerName === null || context.leadPlayerName === undefined
            ? 'Only one binding lead is allowed per position.'
            : `You are already leading ${context.leadPlayerName}. Only one binding lead is allowed per position.`,
        action:
          context.leadPlayerId === null || context.leadPlayerId === undefined
            ? null
            : {
                kind: 'view-lead',
                playerId: context.leadPlayerId,
                label: `View ${context.leadPlayerName ?? 'your lead'}`,
              },
      };
    case 'bid-too-low':
      return {
        message: `The next legal bid is ${exactMoney(context.nextMinimumDollars)}.`,
        action: { kind: 'use-next-bid', totalDollars: context.nextMinimumDollars },
      };
    case 'budget-rejected':
      return {
        message: 'That total is outside the room budget rules for this bid.',
        action: null,
      };
    case 'completion-rejected':
      return {
        message:
          'That bid would leave the two teams unable to fill every position under the hard limit. Lower the total.',
        action: null,
      };
    case 'stale-revision':
    case 'command-conflict':
      return {
        message:
          'Another update landed first. The board refreshed; review the total and try again.',
        action: null,
      };
    case 'not-a-member':
      return { message: 'You are not an active member of this room.', action: null };
    case 'not-ready':
      return { message: 'The room is not ready for that action yet.', action: null };
    case 'expired':
      return { message: 'This room has expired.', action: null };
    default:
      return {
        message: 'The room rejected that bid. Check the current offer and try again.',
        action: null,
      };
  }
}

const COMMAND_ERROR_LABELS: Partial<Record<CapRushMultiplayerCommandRejectionCode, string>> = {
  'not-a-member': 'You are not an active member of this room.',
  'not-host': 'Only the host can do that.',
  'invalid-phase': 'The room has moved to another phase. Refresh to see the latest state.',
  'stale-revision': 'Another update landed first. Try that action again.',
  'room-full': 'This room already has two seats.',
  expired: 'This room has expired.',
  'command-conflict': 'Another update landed first. Try that action again.',
  'unknown-command': 'The room did not recognize that action.',
  'not-ready': 'Both seats must be ready first.',
  'round-mismatch': 'That round is no longer active.',
  'auction-closed': 'That auction has closed.',
  'auction-not-due': 'That auction has not reached its deadline yet.',
  'bid-too-low': 'That bid is below the next legal amount.',
  'multiple-leads': 'Only one binding lead is allowed per position.',
  'position-filled': 'That position is already signed.',
  'budget-rejected': 'That action is outside the room budget rules.',
  'completion-rejected': 'That action would leave a roster unable to finish under the hard limit.',
  'not-locked': 'Both rosters must be locked first.',
  'plan-missing': 'The room is missing a required plan.',
  'frontier-gap': 'Earlier results are still waiting.',
  'result-mismatch': 'The result did not match the room.',
  'verification-mismatch': 'The result failed verification.',
  'playoff-mismatch': 'The playoff step did not match the room.',
  'not-due': 'That action is not due yet.',
};

export function commandErrorLabel(raw: string | null): string | null {
  if (raw === null || raw === '') return null;
  return COMMAND_ERROR_LABELS[raw as CapRushMultiplayerCommandRejectionCode] ?? raw;
}

export type MarketPoolStatus = 'completed' | 'active' | 'upcoming';

export interface MarketPoolLot {
  readonly player: CapRushMultiplayerMarketPlayer;
  readonly auction: CapRushMultiplayerAuction | null;
}

export interface MarketPool {
  readonly index: number;
  readonly position: Position;
  readonly status: MarketPoolStatus;
  readonly lots: readonly MarketPoolLot[];
}

export function marketPools(recruitment: CapRushMultiplayerRecruitment): readonly MarketPool[] {
  const rounds = new Map(recruitment.rounds.map((round) => [round.index, round]));
  return POSITIONS.map((position, index) => {
    const round = rounds.get(index) ?? null;
    const status: MarketPoolStatus =
      index < recruitment.roundIndex
        ? 'completed'
        : index === recruitment.roundIndex
          ? round?.status === 'complete'
            ? 'completed'
            : 'active'
          : 'upcoming';
    const lots = recruitment.market.players
      .filter((player) => player.position === position)
      .map((player) => ({
        player,
        auction: round?.auctions.find((auction) => auction.playerId === player.playerId) ?? null,
      }));
    return { index, position, status, lots };
  });
}

export function playoffSeriesSeat(
  outcomes: Readonly<Record<CapRushMultiplayerSeatId, CapRushPostseasonUserOutcome>>,
  localSeat: CapRushMultiplayerSeatId,
): CapRushMultiplayerSeatId | null {
  return (
    seatOrder(localSeat).find(
      (seat) => outcomes[seat].status !== 'eliminated' && outcomes[seat].status !== 'not-qualified',
    ) ?? null
  );
}
