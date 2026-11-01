import type {
  CapRushChoosePositionCommand,
  CapRushCommand,
  CapRushCreateDraftCommand,
  CapRushDraftState,
  CapRushLockLineupCommand,
  CapRushOffer,
  CapRushPurchaseSpinCommand,
  CapRushRerollOfferCommand,
  CapRushSignCardCommand,
  CapRushSkipSpinCommand,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_HARD_LIMIT_DOLLARS,
  CAP_RUSH_PLAYOFF_FORMULA_VERSION,
  CAP_RUSH_REROLL_LIMIT,
  CAP_RUSH_SCHEMA_VERSION,
  capRushCreateDraftCommandSchema,
  capRushDraftStateSchema,
  capRushEmptySeasonState,
} from '@hoop-rush/data-contracts';
import type { CapRushCatalogIndex } from './catalog.ts';
import { assertCapRushCatalogSourceMatches } from './catalog.ts';
import {
  acceptCapRushCommand,
  rejectCapRushCommand,
  validateRunAndRevision,
  type CapRushCommandEnvironment,
  type CapRushCommandOutcome,
} from './command-outcome.ts';
import { CapRushCatalogCoverageError, CapRushGenerationError } from './errors.ts';
import {
  assertCapRushCatalogCoverage,
  capRushAssessSigning,
  capRushOfferLegalCardIds,
} from './feasibility.ts';
import { buildCapRushHistoricalField } from './historical-field.ts';
import {
  buildCapRushLeagueSchedule,
  capRushAssignFranchise,
  capRushLeagueFieldOf,
} from './league-schedule.ts';
import {
  buildCapRushLockedInputs,
  capRushPlayoffProfilesOf,
  type CapRushLockSources,
} from './lock.ts';
import { generateCapRushOffer, generateCapRushReplacementOffer } from './offers.ts';
import { buildCapRushSpinReceipt, capRushPayrollDollars, capRushSpinEligibility } from './spin.ts';
export type CapRushDraftCommand = Extract<
  CapRushCommand,
  {
    command:
      | 'choose-cap-rush-position'
      | 'reroll-cap-rush-offer'
      | 'sign-cap-rush-card'
      | 'purchase-cap-rush-spin'
      | 'skip-cap-rush-spin'
      | 'lock-cap-rush-lineup';
  }
>;
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
    playoffFormulaVersion: CAP_RUSH_PLAYOFF_FORMULA_VERSION,
  });
  return state;
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
    playoffProfiles: capRushPlayoffProfilesOf({
      catalog: lockSources.historicalCatalog,
      picks: state.picks,
    }),
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
export function applyCapRushDraftCommand(
  state: CapRushDraftState,
  command: CapRushDraftCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  switch (command.command) {
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
  }
}
