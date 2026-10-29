import type {
  CapRushChoosePositionCommand,
  CapRushCommand,
  CapRushCommandRejectionCode,
  CapRushCommandResult,
  CapRushCreateDraftCommand,
  CapRushDraftState,
  CapRushOffer,
  CapRushPurchaseSpinCommand,
  CapRushRerollOfferCommand,
  CapRushSignCardCommand,
  CapRushSkipSpinCommand,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_HARD_LIMIT_DOLLARS,
  CAP_RUSH_REROLL_LIMIT,
  CAP_RUSH_SCHEMA_VERSION,
  capRushCommandResultSchema,
  capRushCreateDraftCommandSchema,
  capRushDraftStateSchema,
} from '@hoop-rush/data-contracts';
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
import { buildCapRushSpinReceipt, capRushPayrollDollars, capRushSpinEligibility } from './spin.ts';
import { capRushStateDigest } from './state-digest.ts';

export interface CapRushCommandEnvironment {
  readonly index: CapRushCatalogIndex;
  readonly rngFactory?: (seed: string) => Rng;
}

export interface CapRushCommandOutcome {
  readonly state: CapRushDraftState;
  readonly result: CapRushCommandResult;
}

export function createCapRushDraftState(
  command: CapRushCreateDraftCommand,
  index: CapRushCatalogIndex,
): CapRushDraftState {
  const parsed = capRushCreateDraftCommandSchema.parse(command);
  assertCapRushCatalogSourceMatches(index.catalog.source, parsed.catalog);
  assertCapRushCatalogCoverage(index);
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
  if (state.spin.status !== 'pending') {
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
  const payroll = capRushPayrollDollars(state.picks);
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
    purchase: command.purchase,
    payrollDollars: payroll,
    pick,
    ...(environment.rngFactory !== undefined ? { rngFactory: environment.rngFactory } : {}),
  });
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    spin: { status: 'purchased', receipt },
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
  }
}
