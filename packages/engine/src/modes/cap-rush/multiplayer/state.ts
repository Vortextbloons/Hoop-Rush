import type {
  CapRushCatalogSource,
  CapRushDraftPick,
  CapRushLeagueGame,
  CapRushMultiplayerCommand,
  CapRushMultiplayerCommandRejectionCode,
  CapRushMultiplayerLockedInputs,
  CapRushMultiplayerSeasonState,
  CapRushMultiplayerSeatId,
  CapRushMultiplayerSeatLock,
  CapRushMultiplayerState,
  CapRushMultiplayerVariant,
  CapRushMultiplayerVersionLocks,
  CapRushSpinReceipt,
  EraSimulationProfile,
  OpponentBracket,
  SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_MULTIPLAYER_BLOCK_ENDPOINTS,
  CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
  POSITIONS,
  canonicalJson,
  capRushMultiplayerMutationSeed,
  capRushMultiplayerStateSchema,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';
import {
  applyCapRushMultiplayerBid,
  capRushMultiplayerCloseDueAuctions,
  capRushMultiplayerRecruitmentComplete,
  createCapRushMultiplayerRecruitment,
} from './auction.ts';
import { buildCapRushMultiplayerMarket } from './market.ts';
import { buildCapRushMultiplayerSeatLock } from './roster.ts';
import {
  buildCapRushMultiplayerLockedInputs,
  capRushMultiplayerAssignFranchises,
} from './locked.ts';
import {
  capRushMultiplayerAcceptedThrough,
  capRushMultiplayerH2HSlots,
  capRushMultiplayerSlotEntries,
} from './league.ts';
import {
  capRushMultiplayerApplyPlayoffStep,
  capRushMultiplayerCurrentRound,
  capRushMultiplayerOpenPostseason,
} from './postseason.ts';
import { buildCapRushMultiplayerReport } from './report.ts';
import { buildCapRushSpinReceipt, capRushSpinEligibility } from '../spin.ts';
import { capRushLeagueFieldOf } from '../league-schedule.ts';
import type { CapRushCatalogIndex } from '../catalog.ts';

export interface CapRushMultiplayerEnvironment {
  readonly variant: CapRushMultiplayerVariant;
  readonly bracket: OpponentBracket;
  readonly seasonCatalog: SeasonDraftCatalog;
  readonly index: CapRushCatalogIndex;
  readonly profile: EraSimulationProfile;
  readonly catalogSource: CapRushCatalogSource;
  readonly versionLocks: CapRushMultiplayerVersionLocks;
}

export type CapRushMultiplayerCommandOutcome =
  | {
      readonly ok: true;
      readonly state: CapRushMultiplayerState;
      readonly stateDigest: string;
    }
  | {
      readonly ok: false;
      readonly code: CapRushMultiplayerCommandRejectionCode;
      readonly message: string;
    };

function reject(
  code: CapRushMultiplayerCommandRejectionCode,
  message: string,
): CapRushMultiplayerCommandOutcome {
  return { ok: false, code, message };
}

function digestOf(value: unknown): string {
  return seasonDigestHex(canonicalJson(value));
}

export function capRushMultiplayerStateDigest(state: CapRushMultiplayerState): string {
  return digestOf(state);
}

export function capRushMultiplayerLockDigest(state: CapRushMultiplayerState): string | null {
  return state.locked === null ? null : digestOf({ locked: state.locked });
}

export function createCapRushMultiplayerState(rootSeed: string | null): CapRushMultiplayerState {
  return capRushMultiplayerStateSchema.parse({
    schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
    phase: 'lobby',
    rootSeed,
    franchises: null,
    ready: { p1: false, p2: false },
    lockConfirmations: { p1: null, p2: null },
    recruitment: null,
    locked: null,
    season: null,
    postseason: null,
    completion: null,
    report: null,
  });
}

function accept(state: CapRushMultiplayerState): CapRushMultiplayerCommandOutcome {
  return {
    ok: true,
    state,
    get stateDigest() {
      return capRushMultiplayerStateDigest(state);
    },
  };
}

function seasonFor(locked: CapRushMultiplayerLockedInputs): CapRushMultiplayerSeasonState {
  return {
    games: [],
    frontierSlot: 0,
    h2hSlots: capRushMultiplayerH2HSlots(locked),
    block: {
      index: 0,
      endpoint: CAP_RUSH_MULTIPLAYER_BLOCK_ENDPOINTS[0],
      plans: { p1: null, p2: null },
      status: 'choosing',
      startedAtIso: null,
      completedAtIso: null,
    },
    slotAcks: { p1: 0, p2: 0 },
    playbackAcks: [],
  };
}

function isH2HGame(locked: CapRushMultiplayerLockedInputs, game: CapRushLeagueGame): boolean {
  const ids = new Set([
    locked.seats.p1.franchise.franchiseId,
    locked.seats.p2.franchise.franchiseId,
  ]);
  return ids.has(game.homeTeamId) && ids.has(game.awayTeamId);
}

function revealState(input: { readonly season: CapRushMultiplayerSeasonState }): {
  readonly season: CapRushMultiplayerSeasonState;
  readonly complete: boolean;
} {
  const accepted = capRushMultiplayerAcceptedThrough(input.season.games);
  const frontier = Math.min(input.season.slotAcks.p1, input.season.slotAcks.p2, accepted);
  let season: CapRushMultiplayerSeasonState = { ...input.season, frontierSlot: frontier };
  if (frontier < season.block.endpoint) return { season, complete: false };
  const blockIndex = season.block.index;
  if (blockIndex >= CAP_RUSH_MULTIPLAYER_BLOCK_ENDPOINTS.length - 1) {
    return { season, complete: true };
  }
  const nextIndex = blockIndex + 1;
  season = {
    ...season,
    block: {
      index: nextIndex,
      endpoint: CAP_RUSH_MULTIPLAYER_BLOCK_ENDPOINTS[nextIndex] ?? 82,
      plans: { p1: null, p2: null },
      status: 'choosing',
      startedAtIso: null,
      completedAtIso: null,
    },
  };
  return { season, complete: false };
}

function draftPickForSpin(input: {
  readonly state: CapRushMultiplayerState;
  readonly playerId: string;
}): CapRushDraftPick {
  const locked = input.state.locked;
  const recruitment = input.state.recruitment;
  if (locked === null || recruitment === null) {
    throw new Error('cap rush multiplayer: spin requires a prepared roster');
  }
  const pick = Object.values(locked.seats)
    .flatMap((seat) => seat.picks)
    .find((entry) => entry.playerId === input.playerId);
  const player = recruitment.market.players.find((entry) => entry.playerId === input.playerId);
  if (pick === undefined || player === undefined) {
    throw new Error(`cap rush multiplayer: ${input.playerId} is not on a roster`);
  }
  const offerId = `cro-${seasonDigestHex(`offer|${recruitment.market.digest}|${player.playerId}`)}`;
  return {
    pickOrdinal: pick.pickOrdinal,
    slot: pick.slot,
    card: {
      cardId: pick.cardId,
      offerId,
      cardIndex: POSITIONS.indexOf(pick.slot),
      slot: pick.slot,
      bucket: pick.bucket,
      source: player.source,
      salaryDollars: pick.salaryDollars,
    },
  };
}

function seatWithReceipts(input: {
  readonly state: CapRushMultiplayerState;
  readonly seat: CapRushMultiplayerSeatId;
  readonly spin: CapRushSpinReceipt | null;
  readonly additionalSpins?: readonly CapRushSpinReceipt[] | undefined;
}): CapRushMultiplayerSeatLock {
  const locked = input.state.locked;
  const recruitment = input.state.recruitment;
  if (locked === null || recruitment === null) {
    throw new Error('cap rush multiplayer: roster rebuild requires locked inputs');
  }
  return buildCapRushMultiplayerSeatLock({
    rootSeed: locked.rootSeed,
    seat: input.seat,
    franchise: locked.seats[input.seat].franchise,
    market: recruitment.market,
    signings: recruitment.signings,
    spin: input.spin,
    additionalSpins: input.additionalSpins,
  });
}

function rebuildLocked(input: {
  readonly state: CapRushMultiplayerState;
  readonly environment: CapRushMultiplayerEnvironment;
  readonly seats: {
    readonly p1: CapRushMultiplayerSeatLock;
    readonly p2: CapRushMultiplayerSeatLock;
  };
  readonly scheduleGames: CapRushMultiplayerLockedInputs['leagueSchedule'];
}): CapRushMultiplayerLockedInputs {
  const locked = input.state.locked;
  if (locked === null) {
    throw new Error('cap rush multiplayer: rebuild requires existing locked inputs');
  }
  return buildCapRushMultiplayerLockedInputs({
    roomId: locked.roomId,
    rootSeed: locked.rootSeed,
    variant: locked.variant,
    versionLocks: input.environment.versionLocks,
    catalog: input.environment.catalogSource,
    profile: input.environment.profile,
    seats: input.seats,
    bracket: input.environment.bracket,
    seasonCatalog: input.environment.seasonCatalog,
    schedule: { teams: [], games: input.scheduleGames },
  });
}

export function applyCapRushMultiplayerCommand(
  state: CapRushMultiplayerState,
  command: CapRushMultiplayerCommand,
  environment: CapRushMultiplayerEnvironment,
  variant: CapRushMultiplayerVariant = environment.variant,
): CapRushMultiplayerCommandOutcome {
  const actor = command.actorParticipantId;
  const payload = command.payload;
  switch (payload.kind) {
    case 'ready': {
      if (state.phase !== 'lobby') {
        return reject('invalid-phase', 'readiness is only available in the lobby');
      }
      return accept({ ...state, ready: { ...state.ready, [actor]: payload.ready } });
    }
    case 'start': {
      if (actor !== 'p1') return reject('not-host', 'only the host starts the league');
      if (state.phase !== 'lobby') return reject('invalid-phase', 'the league already started');
      if (state.rootSeed === null) return reject('invalid-phase', 'the room has no root seed');
      const field = capRushLeagueFieldOf(environment.bracket);
      const franchises = capRushMultiplayerAssignFranchises({
        rootSeed: state.rootSeed,
        field,
      });
      const market = buildCapRushMultiplayerMarket({
        index: environment.index,
        rootSeed: state.rootSeed,
      });
      const recruitment = createCapRushMultiplayerRecruitment({
        market,
        openedAtIso: command.acceptedAtIso,
      });
      return accept({
        ...state,
        phase: 'recruiting',
        franchises,
        recruitment: { ...recruitment },
      });
    }
    case 'bid': {
      if (state.phase !== 'recruiting' || state.recruitment === null) {
        return reject('invalid-phase', 'bidding is closed');
      }
      const outcome = applyCapRushMultiplayerBid(state.recruitment, {
        seat: actor,
        playerId: payload.playerId,
        totalDollars: payload.totalDollars,
        acceptedAtIso: command.acceptedAtIso,
      });
      if (!outcome.ok) return reject(outcome.code, outcome.message);
      return accept({ ...state, recruitment: outcome.recruitment });
    }
    case 'close-due-auctions': {
      if (state.phase !== 'recruiting' || state.recruitment === null) {
        return reject('invalid-phase', 'bidding is closed');
      }
      if (state.franchises === null || state.rootSeed === null) {
        return reject('invalid-phase', 'the league has no franchise assignments');
      }
      const outcome = capRushMultiplayerCloseDueAuctions(state.recruitment, {
        round: payload.round,
        acceptedAtIso: command.acceptedAtIso,
      });
      if (!outcome.ok) return reject(outcome.code, outcome.message);
      if (!capRushMultiplayerRecruitmentComplete(outcome.recruitment)) {
        return accept({ ...state, recruitment: outcome.recruitment });
      }
      const seats = {
        p1: buildCapRushMultiplayerSeatLock({
          rootSeed: state.rootSeed,
          seat: 'p1',
          franchise: state.franchises.p1,
          market: outcome.recruitment.market,
          signings: outcome.recruitment.signings,
          spin: null,
        }),
        p2: buildCapRushMultiplayerSeatLock({
          rootSeed: state.rootSeed,
          seat: 'p2',
          franchise: state.franchises.p2,
          market: outcome.recruitment.market,
          signings: outcome.recruitment.signings,
          spin: null,
        }),
      };
      const locked = buildCapRushMultiplayerLockedInputs({
        roomId: command.roomId,
        rootSeed: state.rootSeed,
        variant,
        versionLocks: environment.versionLocks,
        catalog: environment.catalogSource,
        profile: environment.profile,
        seats,
        bracket: environment.bracket,
        seasonCatalog: environment.seasonCatalog,
      });
      return accept({
        ...state,
        phase: 'preparation',
        recruitment: outcome.recruitment,
        locked,
      });
    }
    case 'purchase-mutation': {
      if (state.phase !== 'preparation' || state.locked === null || state.recruitment === null) {
        return reject('invalid-phase', 'mutations are only available before the lock');
      }
      const seatLock = state.locked.seats[actor];
      const receipts = [seatLock.spin, ...(seatLock.additionalSpins ?? [])].filter(
        (entry): entry is CapRushSpinReceipt => entry !== null,
      );
      if (receipts.length >= 5) {
        return reject('budget-rejected', 'this seat has no mutation purchases left');
      }
      if (!seatLock.picks.some((pick) => pick.playerId === payload.targetPlayerId)) {
        return reject('result-mismatch', 'the mutation target is not on this roster');
      }
      const eligibility = capRushSpinEligibility(seatLock.payrollDollars, payload.purchase);
      if (!eligibility.eligible) {
        return reject('budget-rejected', 'this payroll is not eligible for that mutation');
      }
      const ordinal = receipts.length;
      const pick = draftPickForSpin({ state, playerId: payload.targetPlayerId });
      const receipt = buildCapRushSpinReceipt({
        runSeed: capRushMultiplayerMutationSeed(
          state.locked.rootSeed,
          actor,
          payload.purchase,
          ordinal,
        ),
        purchase: payload.purchase,
        spinOrdinal: ordinal,
        payrollDollars: seatLock.payrollDollars,
        pick,
      });
      const spin = seatLock.spin ?? receipt;
      const additionalSpins =
        seatLock.spin === null ? [] : [...(seatLock.additionalSpins ?? []), receipt];
      const rebuiltSeat = seatWithReceipts({
        state,
        seat: actor,
        spin,
        additionalSpins,
      });
      const seats = { ...state.locked.seats, [actor]: rebuiltSeat };
      const locked = rebuildLocked({
        state,
        environment,
        seats,
        scheduleGames: state.locked.leagueSchedule,
      });
      return accept({ ...state, locked });
    }
    case 'skip-mutation': {
      if (state.phase !== 'preparation') {
        return reject('invalid-phase', 'mutations are only available before the lock');
      }
      return accept(state);
    }
    case 'confirm-lock': {
      if ((state.phase !== 'preparation' && state.phase !== 'locking') || state.locked === null) {
        return reject('invalid-phase', 'the league is not ready to lock');
      }
      const expected = capRushMultiplayerLockDigest(state);
      if (expected === null || payload.stateDigest !== expected) {
        return reject('verification-mismatch', 'the roster digest does not match this seat');
      }
      const confirmations = { ...state.lockConfirmations, [actor]: payload.stateDigest };
      const lockedNow =
        confirmations.p1 !== null &&
        confirmations.p2 !== null &&
        confirmations.p1 === confirmations.p2;
      if (!lockedNow) {
        return accept({ ...state, phase: 'locking', lockConfirmations: confirmations });
      }
      return accept({
        ...state,
        phase: 'season',
        lockConfirmations: confirmations,
        season: seasonFor(state.locked),
      });
    }
    case 'choose-block-plan': {
      if (state.phase !== 'season' || state.season === null) {
        return reject('invalid-phase', 'the season is not running');
      }
      const block = state.season.block;
      if (payload.block !== block.index) {
        return reject('round-mismatch', 'that block is not active');
      }
      if (block.status !== 'choosing') {
        return reject('invalid-phase', 'this block already started');
      }
      const plans = { ...block.plans, [actor]: payload.choice };
      const both = plans.p1 !== null && plans.p2 !== null;
      return accept({
        ...state,
        season: {
          ...state.season,
          block: {
            ...block,
            plans,
            status: both ? 'running' : 'choosing',
            startedAtIso: both ? command.acceptedAtIso : null,
          },
        },
      });
    }
    case 'accept-slot': {
      if (actor !== 'p1') return reject('not-host', 'only the host accepts league results');
      if (state.phase !== 'season' || state.season === null || state.locked === null) {
        return reject('invalid-phase', 'the season is not running');
      }
      const locked = state.locked;
      const season = state.season;
      if (season.block.status !== 'running') {
        return reject('invalid-phase', 'both seats must choose a block plan first');
      }
      const accepted = capRushMultiplayerAcceptedThrough(season.games);
      if (payload.slot !== accepted + 1) {
        return reject('frontier-gap', 'slots must be accepted in order');
      }
      if (payload.slot > season.block.endpoint) {
        return reject('invalid-phase', 'that slot is beyond the block endpoint');
      }
      const expected = capRushMultiplayerSlotEntries(locked, payload.slot);
      if (expected.length === 0) {
        return reject('invalid-phase', 'the schedule has no games in that slot');
      }
      if (payload.games.length !== expected.length) {
        return reject('result-mismatch', 'the slot does not carry every scheduled game');
      }
      const byId = new Map(expected.map((entry) => [entry.gameId, entry]));
      const seen = new Set<string>();
      for (const game of payload.games) {
        const entry = byId.get(game.gameId);
        if (entry === undefined || seen.has(game.gameId)) {
          return reject('result-mismatch', 'the slot contains an unexpected game');
        }
        if (
          game.slot !== entry.slot ||
          game.homeTeamId !== entry.homeTeamId ||
          game.awayTeamId !== entry.awayTeamId
        ) {
          return reject('result-mismatch', 'a result does not match its schedule entry');
        }
        seen.add(game.gameId);
      }
      return accept({
        ...state,
        season: { ...season, games: [...season.games, ...payload.games] },
      });
    }
    case 'ack-slot': {
      if (state.phase !== 'season' || state.season === null || state.locked === null) {
        return reject('invalid-phase', 'the season is not running');
      }
      const locked = state.locked;
      const season = state.season;
      const accepted = capRushMultiplayerAcceptedThrough(season.games);
      if (payload.slot > accepted) {
        return reject('frontier-gap', 'that slot has no accepted results yet');
      }
      const h2h = season.games.find(
        (game) => game.slot === payload.slot && isH2HGame(locked, game),
      );
      if (h2h !== undefined) {
        const resolved = (seat: CapRushMultiplayerSeatId) =>
          season.playbackAcks.some(
            (ack) => ack.gameId === h2h.gameId && ack.seat === seat && ack.resolved,
          );
        if (!resolved('p1') || !resolved('p2')) {
          return reject('not-due', 'both seats must finish the head-to-head broadcast');
        }
      }
      const slotAcks = {
        ...season.slotAcks,
        [actor]: Math.max(season.slotAcks[actor], payload.slot),
      };
      const revealed = revealState({ season: { ...season, slotAcks } });
      if (revealed.complete) {
        const postseason = capRushMultiplayerOpenPostseason({
          locked,
          games: revealed.season.games,
        });
        return accept({
          ...state,
          phase: 'postseason',
          season: revealed.season,
          postseason,
        });
      }
      return accept({ ...state, season: revealed.season });
    }
    case 'ack-broadcast': {
      if (state.phase !== 'season' || state.season === null) {
        return reject('invalid-phase', 'the season is not running');
      }
      const game = state.season.games.find((entry) => entry.gameId === payload.gameId);
      if (game === undefined) {
        return reject('result-mismatch', 'that game is not accepted yet');
      }
      if (payload.cursor > payload.total) {
        return reject('result-mismatch', 'the playback cursor exceeds the recording');
      }
      if (payload.resolved && payload.cursor !== payload.total) {
        return reject('result-mismatch', 'a resolved broadcast must reach the end');
      }
      const ack = {
        gameId: payload.gameId,
        seat: actor,
        cursor: payload.cursor,
        total: payload.total,
        resolved: payload.resolved,
      };
      const playbackAcks = [
        ...state.season.playbackAcks.filter(
          (entry) => !(entry.gameId === payload.gameId && entry.seat === actor),
        ),
        ack,
      ].slice(-256);
      return accept({ ...state, season: { ...state.season, playbackAcks } });
    }
    case 'choose-playoff-plan': {
      if (state.phase !== 'postseason' || state.postseason === null) {
        return reject('invalid-phase', 'the playoffs are not running');
      }
      if (payload.round !== state.postseason.planRound) {
        return reject('playoff-mismatch', 'that playoff round is not active');
      }
      return accept({
        ...state,
        postseason: {
          ...state.postseason,
          plans: { ...state.postseason.plans, [actor]: payload.choice },
        },
      });
    }
    case 'accept-playoff-step': {
      if (actor !== 'p1') return reject('not-host', 'only the host accepts playoff results');
      if (state.phase !== 'postseason' || state.postseason === null || state.locked === null) {
        return reject('invalid-phase', 'the playoffs are not running');
      }
      if (state.postseason.plans.p1 === null || state.postseason.plans.p2 === null) {
        return reject('plan-missing', 'both seats must choose a playoff plan');
      }
      const round = capRushMultiplayerCurrentRound(state.postseason);
      if (payload.round !== round) {
        return reject('playoff-mismatch', 'that playoff round is not active');
      }
      const existing = new Set(
        state.postseason.series.flatMap((series) => series.games.map((game) => game.gameId)),
      );
      for (const game of payload.games) {
        if (existing.has(game.gameId)) {
          return reject('result-mismatch', 'that playoff game was already accepted');
        }
      }
      const postseason = capRushMultiplayerApplyPlayoffStep({
        locked: state.locked,
        state: state.postseason,
        games: payload.games,
      });
      return accept({ ...state, postseason });
    }
    case 'ack-playoff-playback': {
      if (state.phase !== 'postseason' || state.season === null || state.postseason === null) {
        return reject('invalid-phase', 'the playoffs are not running');
      }
      if (payload.cursor > payload.total) {
        return reject('result-mismatch', 'the playback cursor exceeds the recording');
      }
      const ack = {
        gameId: payload.gameId,
        seat: actor,
        cursor: payload.cursor,
        total: payload.total,
        resolved: payload.resolved,
      };
      const playbackAcks = [
        ...state.season.playbackAcks.filter(
          (entry) => !(entry.gameId === payload.gameId && entry.seat === actor),
        ),
        ack,
      ].slice(-256);
      return accept({ ...state, season: { ...state.season, playbackAcks } });
    }
    case 'complete-league': {
      if (
        state.phase !== 'postseason' ||
        state.postseason === null ||
        state.locked === null ||
        state.season === null
      ) {
        return reject('invalid-phase', 'the league is not ready to complete');
      }
      if (state.postseason.championTeamId === null) {
        return reject('playoff-mismatch', 'the Finals have not finished');
      }
      const report = buildCapRushMultiplayerReport({
        locked: state.locked,
        games: state.season.games,
        postseason: state.postseason,
        completedAtIso: command.acceptedAtIso,
      });
      return accept({
        ...state,
        phase: 'completed',
        completion: {
          championTeamId: report.championTeamId,
          completedAtIso: command.acceptedAtIso,
        },
        report,
      });
    }
    case 'leave': {
      return accept({ ...state, phase: 'expired' });
    }
    case 'remove-guest': {
      if (actor !== 'p1') return reject('not-host', 'only the host removes a guest');
      return accept(state);
    }
    case 'rematch': {
      return reject('invalid-phase', 'a rematch needs a new room');
    }
  }
}
