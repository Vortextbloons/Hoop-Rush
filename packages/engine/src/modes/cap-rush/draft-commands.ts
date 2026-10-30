import { buildCapRushHistoricalField } from './historical-field.ts';
import type {
  CapRushAbandonCommand,
  CapRushAcceptGameCommand,
  CapRushAcceptLeagueGamesCommand,
  CapRushAcceptPlayoffGameCommand,
  CapRushAcceptStandingsCommand,
  CapRushChoosePositionCommand,
  CapRushCommand,
  CapRushCommandRejectionCode,
  CapRushCommandResult,
  CapRushConferencePostseason,
  CapRushCreateDraftCommand,
  CapRushDraftState,
  CapRushFinalizePostseasonCommand,
  CapRushFinalizeSeasonCommand,
  CapRushLockLineupCommand,
  CapRushOffer,
  CapRushPurchaseSpinCommand,
  CapRushRerollOfferCommand,
  CapRushSignCardCommand,
  CapRushSkipSpinCommand,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_GAME_COUNT,
  CAP_RUSH_CONFERENCE_AI_GAMES,
  CAP_RUSH_CONFERENCE_GAMES,
  CAP_RUSH_HARD_LIMIT_DOLLARS,
  CAP_RUSH_PLAYOFF_ROUNDS,
  CAP_RUSH_REROLL_LIMIT,
  CAP_RUSH_SCHEMA_VERSION,
  CAP_RUSH_SERIES_GAMES,
  CAP_RUSH_USER_TEAM_ID,
  canonicalJson,
  capRushCommandResultSchema,
  capRushCreateDraftCommandSchema,
  capRushDraftStateSchema,
  capRushEmptyConferencePostseason,
  capRushEmptyPostseason,
  capRushLeagueSeed,
  capRushPlayoffGameSeed,
  isConferencePostseason,
} from '@hoop-rush/data-contracts';
import { capRushEmptySeasonState } from '@hoop-rush/data-contracts';
import { havocGameResultDigest } from '../havoc/digests.ts';
import { capRushFoldAggregate } from './season.ts';
import type { Rng } from '../../sim/rng.ts';
import type { CapRushCatalogIndex } from './catalog.ts';
import { assertCapRushCatalogSourceMatches } from './catalog.ts';
import { CapRushCatalogCoverageError, CapRushGenerationError } from './errors.ts';
import {
  capRushAssessSigning,
  assertCapRushCatalogCoverage,
  capRushOfferLegalCardIds,
} from './feasibility.ts';
import { generateCapRushOffer, generateCapRushReplacementOffer } from './offers.ts';
import { buildCapRushLockedInputs, type CapRushLockSources } from './lock.ts';
import {
  buildCapRushLeagueSchedule,
  capRushAssignFranchise,
  capRushLeagueFieldOf,
} from './league-schedule.ts';
import {
  capRushLeagueFieldOfLocked,
  capRushLeagueSlotGames,
  capRushNextLeagueSlot,
} from './league-simulation.ts';
import { buildCapRushConferenceStandings } from './conference-standings.ts';
import { buildCapRushSpinReceipt, capRushPayrollDollars, capRushSpinEligibility } from './spin.ts';
import { capRushStateDigest } from './state-digest.ts';
import {
  buildCapRushPostseasonStandings,
  capRushFinalsMvp,
  capRushOpeningSeries,
  capRushRefreshPostseason,
  capRushSeriesIsComplete,
} from './postseason.ts';
import {
  capRushConferenceFinalsMvp,
  capRushConferenceOpeningSeries,
  capRushRefreshConferencePostseason,
} from './conference-postseason.ts';

export interface CapRushCommandEnvironment {
  readonly index: CapRushCatalogIndex;
  readonly rngFactory?: (seed: string) => Rng;
  readonly lockSources?: CapRushLockSources;
  readonly nowIso?: () => string;
}

export interface CapRushCommandOutcome {
  readonly state: CapRushDraftState;
  readonly result: CapRushCommandResult;
}

export function createCapRushDraftState(
  command: CapRushCreateDraftCommand,
  index: CapRushCatalogIndex,
  lockSources?: CapRushLockSources,
): CapRushDraftState {
  const parsed = capRushCreateDraftCommandSchema.parse(command);
  assertCapRushCatalogSourceMatches(index.catalog.source, parsed.catalog);
  assertCapRushCatalogCoverage(index);
  const franchise =
    lockSources === undefined
      ? undefined
      : capRushAssignFranchise({
          runSeed: parsed.runSeed,
          field: capRushLeagueFieldOf(lockSources.bracket),
        });
  const state = capRushDraftStateSchema.parse({
    schemaVersion: CAP_RUSH_SCHEMA_VERSION,
    runId: parsed.runId,
    revision: 1,
    runSeed: parsed.runSeed,
    variant: parsed.variant,
    versionSet: parsed.versionSet,
    catalog: parsed.catalog,
    stage: 'select-position',
    round: 1,
    offer: null,
    rerollsRemaining: CAP_RUSH_REROLL_LIMIT,
    picks: [],
    spin: { status: 'unavailable' },
    ...(franchise === undefined ? {} : { franchise }),
    locked: null,
    season: capRushEmptySeasonState(),
    postseasonEligible: true,
  });
  return state;
}

function rejectCapRushCommand(
  state: CapRushDraftState,
  command: { readonly commandId: string; readonly runId: string },
  code: CapRushCommandRejectionCode,
  message: string,
): CapRushCommandOutcome {
  const result = capRushCommandResultSchema.parse({
    schemaVersion: CAP_RUSH_SCHEMA_VERSION,
    commandId: command.commandId,
    runId: command.runId,
    status: 'rejected',
    revisionBefore: state.revision,
    revisionAfter: state.revision,
    stateDigest: capRushStateDigest(state),
    rejection: { code, message },
  });
  return { state, result };
}

function acceptCapRushCommand(
  state: CapRushDraftState,
  command: { readonly commandId: string; readonly runId: string },
  nextState: CapRushDraftState,
): CapRushCommandOutcome {
  const result = capRushCommandResultSchema.parse({
    schemaVersion: CAP_RUSH_SCHEMA_VERSION,
    commandId: command.commandId,
    runId: command.runId,
    status: 'accepted',
    revisionBefore: state.revision,
    revisionAfter: nextState.revision,
    stateDigest: capRushStateDigest(nextState),
    rejection: null,
  });
  return { state: nextState, result };
}

function validateRunAndRevision(
  state: CapRushDraftState,
  command: CapRushCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome | null {
  if (command.runId !== state.runId) {
    return rejectCapRushCommand(
      state,
      command,
      'run-mismatch',
      `command targets run ${command.runId}, active state is ${state.runId}`,
    );
  }
  if (command.command === 'create-cap-rush-draft') {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'a cap rush draft already exists for this run',
    );
  }
  if (command.expectedRevision !== state.revision) {
    return rejectCapRushCommand(
      state,
      command,
      'stale-revision',
      `expected revision ${String(command.expectedRevision)}, current revision ${String(state.revision)}`,
    );
  }
  assertCapRushCatalogSourceMatches(environment.index.catalog.source, state.catalog);
  return null;
}

function applyChoosePosition(
  state: CapRushDraftState,
  command: CapRushChoosePositionCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.stage !== 'select-position') {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'the round already shows an offer',
    );
  }
  if (state.picks.some((pick) => pick.slot === command.slot)) {
    return rejectCapRushCommand(
      state,
      command,
      'position-taken',
      `${command.slot} is already filled`,
    );
  }
  let offer: CapRushOffer;
  try {
    offer = generateCapRushOffer({
      index: environment.index,
      runSeed: state.runSeed,
      round: state.round,
      slot: command.slot,
      offerRevision: 0,
      picks: state.picks,
      rngFactory: environment.rngFactory,
    });
  } catch (error) {
    if (error instanceof CapRushGenerationError || error instanceof CapRushCatalogCoverageError) {
      return rejectCapRushCommand(state, command, 'generation-failed', error.message);
    }
    throw error;
  }
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    stage: 'review-offer',
    offer,
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applyRerollOffer(
  state: CapRushDraftState,
  command: CapRushRerollOfferCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  const offer = state.offer;
  if (state.stage !== 'review-offer' || offer === null) {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'rerolling requires an open offer',
    );
  }
  if (command.offerId !== offer.offerId) {
    return rejectCapRushCommand(
      state,
      command,
      'offer-mismatch',
      `command targets offer ${command.offerId}, active offer is ${offer.offerId}`,
    );
  }
  if (state.rerollsRemaining <= 0) {
    return rejectCapRushCommand(
      state,
      command,
      'reroll-spent',
      'the draft-wide reroll budget is spent',
    );
  }
  const protectedCard = offer.cards.find((card) => card.cardId === command.protectedCardId);
  if (protectedCard === undefined) {
    return rejectCapRushCommand(
      state,
      command,
      'protected-card-required',
      `card ${command.protectedCardId} is not part of the open offer`,
    );
  }
  let replacement: CapRushOffer;
  try {
    replacement = generateCapRushReplacementOffer({
      index: environment.index,
      runSeed: state.runSeed,
      round: state.round,
      slot: offer.slot,
      offerRevision: offer.offerRevision + 1,
      picks: state.picks,
      protectedCard,
      discardedPlayerIds: offer.cards
        .filter((card) => card.cardId !== protectedCard.cardId)
        .map((card) => card.source.playerId),
      rngFactory: environment.rngFactory,
    });
  } catch (error) {
    if (error instanceof CapRushGenerationError || error instanceof CapRushCatalogCoverageError) {
      return rejectCapRushCommand(state, command, 'generation-failed', error.message);
    }
    throw error;
  }
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    offer: replacement,
    rerollsRemaining: state.rerollsRemaining - 1,
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applySignCard(
  state: CapRushDraftState,
  command: CapRushSignCardCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  const offer = state.offer;
  if (state.stage !== 'review-offer' || offer === null) {
    return rejectCapRushCommand(state, command, 'phase-mismatch', 'signing requires an open offer');
  }
  if (command.offerId !== offer.offerId) {
    return rejectCapRushCommand(
      state,
      command,
      'offer-mismatch',
      `command targets offer ${command.offerId}, active offer is ${offer.offerId}`,
    );
  }
  const card = offer.cards.find((entry) => entry.cardId === command.cardId);
  if (card === undefined) {
    return rejectCapRushCommand(
      state,
      command,
      'card-unknown',
      `card ${command.cardId} is not part of the open offer`,
    );
  }
  if (capRushOfferLegalCardIds(state, environment.index, [card]).length === 0) {
    const assessment = capRushAssessSigning(state, environment.index, card);
    return rejectCapRushCommand(
      state,
      command,
      'budget-rejected',
      assessment.reason === 'hard-limit'
        ? `signing ${card.source.displayName} would push payroll past the $${String(CAP_RUSH_HARD_LIMIT_DOLLARS)} hard limit`
        : assessment.reason === 'no-completion'
          ? `signing ${card.source.displayName} leaves no way to fill the remaining positions`
          : `signing ${card.source.displayName} leaves no budget-safe completion`,
    );
  }
  const picks = [...state.picks, { pickOrdinal: state.picks.length, slot: card.slot, card }];
  const complete = picks.length === 5;
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    stage: complete ? 'complete' : 'select-position',
    round: complete ? state.round : state.round + 1,
    offer: null,
    picks,
    spin:
      complete && state.variant === 'roulette' ? { status: 'pending' } : { status: 'unavailable' },
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applyPurchaseSpin(
  state: CapRushDraftState,
  command: CapRushPurchaseSpinCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.variant !== 'roulette') {
    return rejectCapRushCommand(state, command, 'spin-unavailable', 'Cap Clash has no spin');
  }
  if (state.stage !== 'complete') {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'the spin opens after five signings',
    );
  }
  if (state.spin.status !== 'pending' && state.spin.status !== 'purchased') {
    return rejectCapRushCommand(
      state,
      command,
      'spin-unavailable',
      `the spin decision is ${state.spin.status}`,
    );
  }
  const pick = state.picks.find((entry) => entry.card.cardId === command.targetCardId);
  if (pick === undefined) {
    return rejectCapRushCommand(
      state,
      command,
      'target-unknown',
      `card ${command.targetCardId} is not on this roster`,
    );
  }
  const receipts =
    state.spin.status === 'purchased'
      ? [state.spin.receipt, ...(state.spin.additionalReceipts ?? [])]
      : [];
  if (receipts.some((receipt) => receipt.target.cardId === command.targetCardId)) {
    return rejectCapRushCommand(
      state,
      command,
      'spin-unavailable',
      'this player already has a mutation',
    );
  }
  const payroll =
    capRushPayrollDollars(state.picks) +
    receipts.reduce((total, receipt) => total + receipt.priceDollars, 0);
  const eligibility = capRushSpinEligibility(payroll, command.purchase);
  if (!eligibility.eligible) {
    return rejectCapRushCommand(
      state,
      command,
      'spin-ineligible',
      `payroll of $${String(payroll)} cannot buy a $${String(eligibility.priceDollars)} spin; the limit is $${String(eligibility.maxEligiblePayrollDollars)}`,
    );
  }
  const receipt = buildCapRushSpinReceipt({
    runSeed: state.runSeed,
    spinOrdinal: receipts.length,
    purchase: command.purchase,
    payrollDollars: payroll,
    pick,
    ...(environment.rngFactory !== undefined ? { rngFactory: environment.rngFactory } : {}),
  });
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    spin:
      receipts.length === 0
        ? { status: 'purchased', receipt }
        : {
            status: 'purchased',
            receipt: receipts[0],
            additionalReceipts: [...receipts.slice(1), receipt],
          },
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applySkipSpin(
  state: CapRushDraftState,
  command: CapRushSkipSpinCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.variant !== 'roulette') {
    return rejectCapRushCommand(state, command, 'spin-unavailable', 'Cap Clash has no spin');
  }
  if (state.stage !== 'complete') {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'the spin opens after five signings',
    );
  }
  if (state.spin.status !== 'pending') {
    return rejectCapRushCommand(
      state,
      command,
      'spin-unavailable',
      `the spin decision is ${state.spin.status}`,
    );
  }
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    spin: { status: 'skipped' },
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applyLockLineup(
  state: CapRushDraftState,
  command: CapRushLockLineupCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.stage === 'locked') {
    return rejectCapRushCommand(
      state,
      command,
      'already-locked',
      'the cap rush lineup is already locked',
    );
  }
  if (state.stage !== 'complete') {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'locking requires a completed draft',
    );
  }
  if (state.variant === 'roulette' && state.spin.status === 'pending') {
    return rejectCapRushCommand(
      state,
      command,
      'spin-unavailable',
      'resolve the spin decision before locking',
    );
  }
  const matches =
    command.picks.length === state.picks.length &&
    command.picks.every((entry, index) => {
      const pick = state.picks[index];
      return pick !== undefined && pick.slot === entry.slot && pick.card.cardId === entry.cardId;
    });
  if (!matches) {
    return rejectCapRushCommand(
      state,
      command,
      'incomplete-lineup',
      'the locked picks do not match the completed draft',
    );
  }
  const lockSources = environment.lockSources;
  if (lockSources === undefined) {
    return rejectCapRushCommand(
      state,
      command,
      'generation-failed',
      'locking requires bracket and simulation profile sources',
    );
  }
  const takeover =
    state.franchise === undefined
      ? undefined
      : {
          franchise: state.franchise,
          games: buildCapRushLeagueSchedule({
            runSeed: state.runSeed,
            field: capRushLeagueFieldOf(lockSources.bracket),
          }).games,
        };
  const bracket =
    lockSources.historicalCatalog === undefined
      ? lockSources.bracket
      : buildCapRushHistoricalField(
          lockSources.bracket,
          lockSources.historicalCatalog,
          state.runSeed,
        );
  const locked = buildCapRushLockedInputs({
    runId: state.runId,
    runSeed: state.runSeed,
    variant: state.variant,
    versionSet: state.versionSet,
    catalog: state.catalog,
    picks: state.picks,
    spin: state.spin.status === 'purchased' ? state.spin.receipt : null,
    additionalSpins: state.spin.status === 'purchased' ? state.spin.additionalReceipts : undefined,
    bracket,
    profile: lockSources.profile,
    ...(takeover === undefined ? {} : { takeover }),
  });
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    stage: 'locked',
    offer: null,
    locked,
    season: state.season,
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applyAcceptGame(
  state: CapRushDraftState,
  command: CapRushAcceptGameCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.stage !== 'locked' || state.locked === null) {
    return rejectCapRushCommand(state, command, 'not-locked', 'the lineup is not locked');
  }
  if (state.season.completedAt !== null) {
    return rejectCapRushCommand(
      state,
      command,
      'season-complete',
      'the season is already complete',
    );
  }
  const expected = state.season.games.length + 1;
  if (command.cursor !== expected) {
    return rejectCapRushCommand(
      state,
      command,
      'stale-cursor',
      `game ${String(command.cursor)} cannot be accepted; the next game is ${String(expected)}`,
    );
  }
  if (command.summary.gameNumber !== command.cursor) {
    return rejectCapRushCommand(
      state,
      command,
      'digest-mismatch',
      'the accepted summary does not describe the cursor game',
    );
  }
  const entry = state.locked.schedule[command.cursor - 1];
  if (entry === undefined || entry.opponentId !== command.summary.opponentId) {
    return rejectCapRushCommand(
      state,
      command,
      'digest-mismatch',
      'the accepted summary does not match the frozen schedule',
    );
  }
  if (
    command.summary.inputDigest !== command.inputDigest ||
    command.summary.resultDigest !== command.resultDigest
  ) {
    return rejectCapRushCommand(
      state,
      command,
      'digest-mismatch',
      'the accept envelope digests disagree with the summary digests',
    );
  }
  let leagueGamesAccepted = state.season.leagueGamesAccepted ?? 0;
  if (state.locked.leagueSchedule !== undefined && command.leagueGames !== undefined) {
    const expected = capRushLeagueSlotGames(state.locked, command.cursor);
    const supplied = command.leagueGames ?? [];
    const expectedIds = expected.map((game) => game.gameId).sort();
    const suppliedIds = supplied.map((game) => game.gameId).sort();
    if (
      expectedIds.length !== suppliedIds.length ||
      expectedIds.some((gameId, index) => suppliedIds[index] !== gameId)
    ) {
      return rejectCapRushCommand(
        state,
        command,
        'digest-mismatch',
        'the background league games do not match the accepted slot',
      );
    }
    for (const game of supplied) {
      if (game.slot !== command.cursor) {
        return rejectCapRushCommand(
          state,
          command,
          'digest-mismatch',
          'a background league game belongs to another slot',
        );
      }
    }
    leagueGamesAccepted += supplied.length;
  }
  const aggregate = capRushFoldAggregate(state.season.aggregate, command.summary);
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    season: {
      games: [...state.season.games, command.summary],
      aggregate,
      apronTriggers: {
        isolations: state.season.apronTriggers.isolations + command.isolations,
        strikes: state.season.apronTriggers.strikes + command.strikes,
      },
      completedAt: null,
      ...(state.season.leagueGamesAccepted === undefined ? {} : { leagueGamesAccepted }),
    },
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applyAcceptLeagueGames(
  state: CapRushDraftState,
  command: CapRushAcceptLeagueGamesCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.stage !== 'locked' || state.locked === null) {
    return rejectCapRushCommand(state, command, 'not-locked', 'the lineup is not locked');
  }
  if (state.locked.leagueSchedule === undefined) {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'this run does not use background league games',
    );
  }
  if (state.season.completedAt !== null) {
    return rejectCapRushCommand(
      state,
      command,
      'season-complete',
      'the season is already complete',
    );
  }
  const accepted = state.season.leagueGamesAccepted ?? 0;
  const nextSlot = capRushNextLeagueSlot(state.locked, accepted);
  if (nextSlot === null) {
    return rejectCapRushCommand(
      state,
      command,
      'stale-cursor',
      'all background league games are already accepted',
    );
  }
  if (command.slot !== nextSlot) {
    return rejectCapRushCommand(
      state,
      command,
      'stale-cursor',
      `league slot ${String(command.slot)} cannot be accepted; the next slot is ${String(nextSlot)}`,
    );
  }
  const expected = capRushLeagueSlotGames(state.locked, command.slot);
  const expectedIds = expected.map((game) => game.gameId).sort();
  const suppliedIds = command.leagueGames.map((game) => game.gameId).sort();
  if (
    expectedIds.length !== suppliedIds.length ||
    expectedIds.some((gameId, index) => suppliedIds[index] !== gameId)
  ) {
    return rejectCapRushCommand(
      state,
      command,
      'digest-mismatch',
      'the background league games do not match the accepted slot',
    );
  }
  for (const game of command.leagueGames) {
    if (game.slot !== command.slot) {
      return rejectCapRushCommand(
        state,
        command,
        'digest-mismatch',
        'a background league game belongs to another slot',
      );
    }
  }
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    season: {
      ...state.season,
      leagueGamesAccepted: accepted + expected.length,
    },
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applyFinalizeSeason(
  state: CapRushDraftState,
  command: CapRushFinalizeSeasonCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.stage !== 'locked' || state.locked === null) {
    return rejectCapRushCommand(state, command, 'not-locked', 'the lineup is not locked');
  }
  if (state.season.completedAt !== null) {
    return rejectCapRushCommand(
      state,
      command,
      'season-complete',
      'the season is already complete',
    );
  }
  if (state.season.games.length !== CAP_RUSH_GAME_COUNT) {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      `the season has ${String(state.season.games.length)} of ${String(CAP_RUSH_GAME_COUNT)} games`,
    );
  }
  if (
    state.locked.leagueSchedule !== undefined &&
    (state.season.leagueGamesAccepted ?? 0) !== CAP_RUSH_CONFERENCE_AI_GAMES
  ) {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      `the background league has ${String(state.season.leagueGamesAccepted ?? 0)} of ${String(CAP_RUSH_CONFERENCE_AI_GAMES)} games`,
    );
  }
  const completedAt = environment.nowIso?.() ?? new Date().toISOString();
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    stage: state.postseasonEligible === true ? 'postseason' : 'completed',
    season: { ...state.season, completedAt },
    ...(state.postseasonEligible === true
      ? {
          postseason:
            state.locked.leagueSchedule === undefined
              ? capRushEmptyPostseason()
              : capRushEmptyConferencePostseason(),
        }
      : {}),
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applyAcceptStandings(
  state: CapRushDraftState,
  command: CapRushAcceptStandingsCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.stage !== 'postseason' || state.locked === null || state.postseason === undefined) {
    return rejectCapRushCommand(
      state,
      command,
      'postseason-unavailable',
      'the run is not in its postseason',
    );
  }
  if (state.postseason.phase !== 'awaiting-standings') {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'the final standings were already accepted',
    );
  }
  if (state.season.games.length !== CAP_RUSH_GAME_COUNT) {
    return rejectCapRushCommand(
      state,
      command,
      'standings-invalid',
      'the regular season is incomplete',
    );
  }
  if (
    state.locked.leagueSchedule !== undefined &&
    (state.season.leagueGamesAccepted ?? 0) !== CAP_RUSH_CONFERENCE_AI_GAMES
  ) {
    return rejectCapRushCommand(
      state,
      command,
      'standings-invalid',
      'the background league games are incomplete',
    );
  }
  if (command.standings !== undefined) {
    if (state.locked.leagueSchedule === undefined) {
      return rejectCapRushCommand(
        state,
        command,
        'standings-invalid',
        'this run does not use conference standings',
      );
    }
    const standings = command.standings;
    const expectedTeams = new Set<string>([
      state.locked.human.teamId,
      ...state.locked.opponents.map((entry) => entry.team.teamId),
    ]);
    if (standings.games.length !== CAP_RUSH_CONFERENCE_GAMES) {
      return rejectCapRushCommand(
        state,
        command,
        'standings-invalid',
        'the conference standings must cover all 1,230 league games',
      );
    }
    const seen = new Set<string>();
    for (const game of standings.games) {
      if (!expectedTeams.has(game.homeTeamId) || !expectedTeams.has(game.awayTeamId)) {
        return rejectCapRushCommand(
          state,
          command,
          'standings-invalid',
          'the standings reference an unknown team',
        );
      }
      if (seen.has(game.gameId)) {
        return rejectCapRushCommand(
          state,
          command,
          'standings-invalid',
          `the standings repeat game ${game.gameId}`,
        );
      }
      seen.add(game.gameId);
    }
    let recomputed;
    try {
      recomputed = buildCapRushConferenceStandings({
        teams: capRushLeagueFieldOfLocked(state.locked),
        games: standings.games,
      });
    } catch (error) {
      return rejectCapRushCommand(
        state,
        command,
        'standings-invalid',
        error instanceof Error ? error.message : 'the conference standings are invalid',
      );
    }
    if (canonicalJson(recomputed) !== canonicalJson(standings)) {
      return rejectCapRushCommand(
        state,
        command,
        'standings-invalid',
        'the conference standings do not match their accepted results',
      );
    }
    const qualified = standings.qualifiedTeamIds.includes(state.locked.human.teamId);
    const nextState = capRushDraftStateSchema.parse({
      ...state,
      revision: state.revision + 1,
      postseason: capRushRefreshConferencePostseason({
        postseason: {
          ...capRushEmptyConferencePostseason(),
          phase: 'playoffs',
          standings,
          series: capRushConferenceOpeningSeries(standings),
          userOutcome: qualified
            ? { status: 'pending', round: null }
            : { status: 'not-qualified', round: null },
        },
        userTeamId: state.locked.human.teamId,
      }),
    });
    return acceptCapRushCommand(state, command, nextState);
  }
  if (command.league === undefined) {
    return rejectCapRushCommand(
      state,
      command,
      'standings-invalid',
      'the command carries no standings',
    );
  }
  if (isConferencePostseason(state.postseason)) {
    return rejectCapRushCommand(
      state,
      command,
      'standings-invalid',
      'conference runs require conference standings',
    );
  }
  if (command.league.league.seed !== capRushLeagueSeed(state.runSeed)) {
    return rejectCapRushCommand(
      state,
      command,
      'digest-mismatch',
      'the league standings do not carry the locked background seed',
    );
  }
  let standings;
  try {
    standings = buildCapRushPostseasonStandings({
      locked: state.locked,
      league: command.league,
      userGames: state.season.games.map((game) => ({
        opponentId: game.opponentId,
        humanPoints: game.humanPoints,
        opponentPoints: game.opponentPoints,
        won: game.won,
      })),
    });
  } catch (error) {
    return rejectCapRushCommand(
      state,
      command,
      'standings-invalid',
      error instanceof Error ? error.message : 'the league standings are invalid',
    );
  }
  const userEntry = standings.entries.find((entry) => entry.teamId === CAP_RUSH_USER_TEAM_ID);
  const qualified = userEntry?.qualified === true;
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    postseason: capRushRefreshPostseason({
      postseason: {
        ...state.postseason,
        phase: 'playoffs',
        standings,
        series: capRushOpeningSeries(standings),
        userOutcome: qualified
          ? { status: 'pending', round: null }
          : { status: 'not-qualified', round: null },
      },
      userTeamId: state.locked.human.teamId,
    }),
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applyAcceptPlayoffGame(
  state: CapRushDraftState,
  command: CapRushAcceptPlayoffGameCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.stage !== 'postseason' || state.locked === null || state.postseason === undefined) {
    return rejectCapRushCommand(
      state,
      command,
      'postseason-unavailable',
      'the run is not in its postseason',
    );
  }
  if (isConferencePostseason(state.postseason)) {
    return applyAcceptConferencePlayoffGame(state, command, environment, state.postseason);
  }
  if (state.postseason.phase !== 'playoffs') {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'the playoff bracket is not open',
    );
  }
  const { game } = command;
  if (!command.audit.ok) {
    return rejectCapRushCommand(state, command, 'digest-mismatch', 'the playoff game audit failed');
  }
  const series = state.postseason.series.find((entry) => entry.seriesId === game.seriesId);
  if (series === undefined) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      'the playoff game belongs to an unknown series',
    );
  }
  if (capRushSeriesIsComplete(series)) {
    return rejectCapRushCommand(state, command, 'series-complete', 'the series is already decided');
  }
  if (series.round !== game.round || series.seriesSlot !== game.seriesSlot) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      'the playoff game identity does not match its series',
    );
  }
  const expectedOrdinal = series.games.length + 1;
  if (game.gameOrdinal !== expectedOrdinal || expectedOrdinal > CAP_RUSH_SERIES_GAMES) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      `the series expects game ${String(expectedOrdinal)}`,
    );
  }
  const highHome = [1, 2, 5, 7].includes(expectedOrdinal);
  const expectedHome = highHome ? series.highTeamId : series.lowTeamId;
  const expectedAway = highHome ? series.lowTeamId : series.highTeamId;
  if (game.homeTeamId !== expectedHome || game.awayTeamId !== expectedAway) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      'the playoff game does not follow the bracket home court',
    );
  }
  if (game.homeSeed !== (highHome ? series.highSeed : series.lowSeed)) {
    return rejectCapRushCommand(state, command, 'playoff-mismatch', 'the home seed is wrong');
  }
  if (game.awaySeed !== (highHome ? series.lowSeed : series.highSeed)) {
    return rejectCapRushCommand(state, command, 'playoff-mismatch', 'the away seed is wrong');
  }
  if (
    game.seed !==
    capRushPlayoffGameSeed(state.runSeed, game.round, game.seriesSlot, game.gameOrdinal)
  ) {
    return rejectCapRushCommand(
      state,
      command,
      'digest-mismatch',
      'the playoff game seed does not match the locked run seed',
    );
  }
  const isUserGame =
    series.highTeamId === state.locked.human.teamId ||
    series.lowTeamId === state.locked.human.teamId;
  if (isUserGame !== (game.userSide !== null)) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      'the playoff game user side does not match the matchup',
    );
  }
  if (isUserGame && command.result === null) {
    return rejectCapRushCommand(
      state,
      command,
      'digest-mismatch',
      'a user playoff game requires its box score',
    );
  }
  if (command.result !== null) {
    if (
      command.result.home.points !== game.homePoints ||
      command.result.away.points !== game.awayPoints ||
      command.result.home.teamId !== game.homeTeamId ||
      command.result.away.teamId !== game.awayTeamId ||
      command.result.humanSide !== game.userSide ||
      havocGameResultDigest(command.result) !== game.resultDigest
    ) {
      return rejectCapRushCommand(
        state,
        command,
        'digest-mismatch',
        'the playoff box score disagrees with the accepted summary',
      );
    }
  }
  const nextSeries = { ...series, games: [...series.games, game] };
  const updatedPostseason = capRushRefreshPostseason({
    postseason: {
      ...state.postseason,
      series: state.postseason.series.map((entry) =>
        entry.seriesId === series.seriesId ? nextSeries : entry,
      ),
    },
    userTeamId: state.locked.human.teamId,
  });
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    postseason: updatedPostseason,
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applyFinalizePostseason(
  state: CapRushDraftState,
  command: CapRushFinalizePostseasonCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.stage !== 'postseason' || state.postseason === undefined) {
    return rejectCapRushCommand(
      state,
      command,
      'postseason-unavailable',
      'the run is not in its postseason',
    );
  }
  if (isConferencePostseason(state.postseason)) {
    return applyFinalizeConferencePostseason(state, command, environment, state.postseason);
  }
  if (state.postseason.phase !== 'playoffs') {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'the playoff bracket is not open',
    );
  }
  if (state.postseason.championTeamId === null) {
    return rejectCapRushCommand(
      state,
      command,
      'postseason-complete',
      'the postseason is not finished',
    );
  }
  const finalsSeries = state.postseason.series.find(
    (series) => series.round === CAP_RUSH_PLAYOFF_ROUNDS && series.seriesSlot === 0,
  );
  if (finalsSeries === undefined || !capRushSeriesIsComplete(finalsSeries)) {
    return rejectCapRushCommand(
      state,
      command,
      'postseason-complete',
      'the Finals are not finished',
    );
  }
  const finalsMvp = capRushFinalsMvp(state.postseason);
  if (finalsMvp === null) {
    return rejectCapRushCommand(
      state,
      command,
      'postseason-complete',
      'the Finals MVP evidence is missing',
    );
  }
  const completedAt = environment.nowIso?.() ?? new Date().toISOString();
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    stage: 'completed',
    postseason: {
      ...state.postseason,
      phase: 'complete',
      finalsMvp,
      completedAt,
    },
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applyAbandon(
  state: CapRushDraftState,
  command: CapRushAbandonCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.stage === 'abandoned' || state.stage === 'completed') {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      `the run is already ${state.stage}`,
    );
  }
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    stage: 'abandoned',
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applyFinalizeConferencePostseason(
  state: CapRushDraftState,
  command: CapRushFinalizePostseasonCommand,
  environment: CapRushCommandEnvironment,
  postseason: CapRushConferencePostseason,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (postseason.phase !== 'playoffs') {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'the playoff bracket is not open',
    );
  }
  if (postseason.championTeamId === null) {
    return rejectCapRushCommand(
      state,
      command,
      'postseason-complete',
      'the postseason is not finished',
    );
  }
  const finalsSeries = postseason.series.find(
    (series) => series.round === CAP_RUSH_PLAYOFF_ROUNDS && series.seriesSlot === 0,
  );
  if (finalsSeries === undefined || !capRushSeriesIsComplete(finalsSeries)) {
    return rejectCapRushCommand(
      state,
      command,
      'postseason-complete',
      'the Finals are not finished',
    );
  }
  const userTeamId = state.locked?.human.teamId ?? CAP_RUSH_USER_TEAM_ID;
  const finalsMvp = capRushConferenceFinalsMvp(postseason, userTeamId);
  if (finalsMvp === null) {
    return rejectCapRushCommand(
      state,
      command,
      'postseason-complete',
      'the Finals MVP evidence is missing',
    );
  }
  const completedAt = environment.nowIso?.() ?? new Date().toISOString();
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    stage: 'completed',
    postseason: {
      ...postseason,
      phase: 'complete',
      finalsMvp,
      completedAt,
    },
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applyAcceptConferencePlayoffGame(
  state: CapRushDraftState,
  command: CapRushAcceptPlayoffGameCommand,
  environment: CapRushCommandEnvironment,
  postseason: CapRushConferencePostseason,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.locked === null) {
    return rejectCapRushCommand(state, command, 'not-locked', 'the lineup is not locked');
  }
  if (postseason.phase !== 'playoffs') {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'the playoff bracket is not open',
    );
  }
  const { game } = command;
  if (!command.audit.ok) {
    return rejectCapRushCommand(state, command, 'digest-mismatch', 'the playoff game audit failed');
  }
  const series = postseason.series.find((entry) => entry.seriesId === game.seriesId);
  if (series === undefined) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      'the playoff game belongs to an unknown series',
    );
  }
  if (capRushSeriesIsComplete(series)) {
    return rejectCapRushCommand(state, command, 'series-complete', 'the series is already decided');
  }
  if (series.round !== game.round || series.seriesSlot !== game.seriesSlot) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      'the playoff game identity does not match its series',
    );
  }
  const expectedOrdinal = series.games.length + 1;
  if (game.gameOrdinal !== expectedOrdinal || expectedOrdinal > CAP_RUSH_SERIES_GAMES) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      `the series expects game ${String(expectedOrdinal)}`,
    );
  }
  const highHome = [1, 2, 5, 7].includes(expectedOrdinal);
  const expectedHome = highHome ? series.highTeamId : series.lowTeamId;
  const expectedAway = highHome ? series.lowTeamId : series.highTeamId;
  if (game.homeTeamId !== expectedHome || game.awayTeamId !== expectedAway) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      'the playoff game does not follow the bracket home court',
    );
  }
  if (
    game.homeSeed !== (highHome ? series.highSeed : series.lowSeed) ||
    game.awaySeed !== (highHome ? series.lowSeed : series.highSeed)
  ) {
    return rejectCapRushCommand(state, command, 'playoff-mismatch', 'the game seeds are wrong');
  }
  if (
    game.seed !==
    capRushPlayoffGameSeed(state.runSeed, game.round, game.seriesSlot, game.gameOrdinal)
  ) {
    return rejectCapRushCommand(
      state,
      command,
      'digest-mismatch',
      'the playoff game seed does not match the locked run seed',
    );
  }
  const isUserGame =
    series.highTeamId === state.locked.human.teamId ||
    series.lowTeamId === state.locked.human.teamId;
  if (isUserGame !== (game.userSide !== null)) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      'the playoff game user side does not match the matchup',
    );
  }
  if (isUserGame && command.result === null) {
    return rejectCapRushCommand(
      state,
      command,
      'digest-mismatch',
      'a user playoff game requires its box score',
    );
  }
  if (command.result !== null) {
    if (
      command.result.home.points !== game.homePoints ||
      command.result.away.points !== game.awayPoints ||
      command.result.home.teamId !== game.homeTeamId ||
      command.result.away.teamId !== game.awayTeamId ||
      command.result.humanSide !== game.userSide ||
      havocGameResultDigest(command.result) !== game.resultDigest
    ) {
      return rejectCapRushCommand(
        state,
        command,
        'digest-mismatch',
        'the playoff box score disagrees with the accepted summary',
      );
    }
  }
  const nextSeries = { ...series, games: [...series.games, game] };
  const updatedPostseason = capRushRefreshConferencePostseason({
    postseason: {
      ...postseason,
      series: postseason.series.map((entry) =>
        entry.seriesId === series.seriesId ? nextSeries : entry,
      ),
    },
    userTeamId: state.locked.human.teamId,
  });
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    postseason: updatedPostseason,
  });
  return acceptCapRushCommand(state, command, nextState);
}

export function applyCapRushCommand(
  state: CapRushDraftState,
  command: CapRushCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  switch (command.command) {
    case 'create-cap-rush-draft':
      return rejectCapRushCommand(
        state,
        command,
        'phase-mismatch',
        'a cap rush draft already exists for this run',
      );
    case 'choose-cap-rush-position':
      return applyChoosePosition(state, command, environment);
    case 'reroll-cap-rush-offer':
      return applyRerollOffer(state, command, environment);
    case 'sign-cap-rush-card':
      return applySignCard(state, command, environment);
    case 'purchase-cap-rush-spin':
      return applyPurchaseSpin(state, command, environment);
    case 'skip-cap-rush-spin':
      return applySkipSpin(state, command, environment);
    case 'lock-cap-rush-lineup':
      return applyLockLineup(state, command, environment);
    case 'accept-cap-rush-game':
      return applyAcceptGame(state, command, environment);
    case 'accept-cap-rush-league-games':
      return applyAcceptLeagueGames(state, command, environment);
    case 'finalize-cap-rush-season':
      return applyFinalizeSeason(state, command, environment);
    case 'accept-cap-rush-standings':
      return applyAcceptStandings(state, command, environment);
    case 'accept-cap-rush-playoff-game':
      return applyAcceptPlayoffGame(state, command, environment);
    case 'finalize-cap-rush-postseason':
      return applyFinalizePostseason(state, command, environment);
    case 'abandon-cap-rush-run':
      return applyAbandon(state, command, environment);
  }
}
