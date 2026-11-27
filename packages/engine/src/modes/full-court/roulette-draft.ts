import type {
  CommandId,
  FullCourtDraftState,
  FullCourtFinalizeRouletteCommand,
  FullCourtPurchaseSpinCommand,
  FullCourtSkipSpinCommand,
  FullCourtSpinReceipt,
  HavocMutationId,
  Position,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_SPIN_PURCHASES,
  canonicalJson,
  fullCourtSpinReceiptSchema,
  fullCourtDraftStateSchema,
  seasonDigestHex,
  type CapRushSpinPurchaseId,
  type FullCourtCommand,
  type FullCourtRouletteDraftState,
} from '@hoop-rush/data-contracts';
import type { Rng } from '../../sim/rng.ts';
import { drawCapRushSpin, CapRushSpinDrawUnavailableError } from '../cap-rush/spin.ts';
import { capRushHavocSourceOf } from '../cap-rush/effective-profile.ts';
import { HAVOC_MUTATION_DEFINITIONS, teamExclusiveMutationIdsOf } from '../havoc/mutations.ts';
import { applyHavocMutationPackage } from '../havoc/transform.ts';
import {
  fullCourtPayrollDollars,
  fullCourtPayrollStatus,
  fullCourtWarChestDollars,
} from './draft-economy.ts';
import {
  acceptFullCourtCommand,
  rejectFullCourtCommand,
  validateFullCourtRunAndRevision,
  type FullCourtCommandEnvironment,
  type FullCourtCommandOutcome,
} from './draft-outcome.ts';

export const FULL_COURT_SPIN_RECEIPT_DIGEST_PREFIX = 'full-court-spin-receipt-v1';

const TEAM_EXCLUSIVE_MUTATIONS = teamExclusiveMutationIdsOf(HAVOC_MUTATION_DEFINITIONS);

export function fullCourtSpinReceiptDigest(
  receipt: Omit<FullCourtSpinReceipt, 'receiptDigest'>,
): string {
  return seasonDigestHex(`${FULL_COURT_SPIN_RECEIPT_DIGEST_PREFIX}\u0000${canonicalJson(receipt)}`);
}

/** Recompute every receipt digest so persisted or tampered profiles fail closed. */
export function assertFullCourtSpinReceiptDigests(state: FullCourtDraftState): void {
  const exclusive = new Set<HavocMutationId>();
  for (const receipt of state.roulette?.receipts ?? []) {
    const { receiptDigest, ...payload } = receipt;
    const expected = fullCourtSpinReceiptDigest(payload);
    if (expected !== receiptDigest) {
      throw new Error(`Full Court Roulette receipt ${receiptDigest} does not match its profile`);
    }
    for (const entry of [receipt.entry, ...(receipt.additionalEntries ?? [])]) {
      if (!TEAM_EXCLUSIVE_MUTATIONS.has(entry.mutationId)) continue;
      if (exclusive.has(entry.mutationId)) {
        throw new Error(
          `Full Court Roulette receipts repeat team-exclusive mutation ${entry.mutationId}`,
        );
      }
      exclusive.add(entry.mutationId);
    }
  }
}

function ownedTeamExclusiveMutationIds(state: FullCourtDraftState): ReadonlySet<HavocMutationId> {
  const owned = new Set<HavocMutationId>();
  for (const receipt of fullCourtRouletteReceipts(state)) {
    for (const entry of [receipt.entry, ...(receipt.additionalEntries ?? [])]) {
      if (TEAM_EXCLUSIVE_MUTATIONS.has(entry.mutationId)) owned.add(entry.mutationId);
    }
  }
  return owned;
}

export function fullCourtSpinEntryId(receipt: Pick<FullCourtSpinReceipt, 'receiptDigest'>): string {
  return `fcs-${receipt.receiptDigest}`;
}

export function fullCourtRouletteReceipts(
  state: FullCourtDraftState,
): readonly FullCourtSpinReceipt[] {
  return state.roulette?.receipts ?? [];
}

/** Locked payroll plus every earlier spin, matching Cap Rush's cap eligibility figure. */
export function fullCourtSpinPayrollDollars(state: FullCourtDraftState): number {
  return (
    fullCourtPayrollDollars(state.picks) +
    fullCourtRouletteReceipts(state).reduce((total, receipt) => total + receipt.priceDollars, 0)
  );
}

export interface FullCourtSpinEligibility {
  readonly eligible: boolean;
  readonly payrollDollars: number;
  readonly priceDollars: number;
  readonly maxEligiblePayrollDollars: number;
  readonly warChestAfterSpin: number;
  readonly apronStatus: ReturnType<typeof fullCourtPayrollStatus>;
  readonly reason: 'cap' | 'cash' | null;
}

/**
 * Cap eligibility adds earlier spin spending to the locked payroll. The apron reads the
 * locked payroll alone, and the War Chest funds the price separately.
 */
export function fullCourtSpinEligibility(
  state: FullCourtDraftState,
  purchase: CapRushSpinPurchaseId,
): FullCourtSpinEligibility {
  const priceDollars = CAP_RUSH_SPIN_PURCHASES[purchase].priceDollars;
  const payrollDollars = fullCourtSpinPayrollDollars(state);
  const maxEligiblePayrollDollars = state.money.capLineDollars - priceDollars;
  const warChestAfterSpin = fullCourtWarChestDollars(state) - priceDollars;
  const capEligible = payrollDollars <= maxEligiblePayrollDollars;
  const cashEligible = warChestAfterSpin >= 0;
  return {
    eligible: capEligible && cashEligible,
    payrollDollars,
    priceDollars,
    maxEligiblePayrollDollars,
    warChestAfterSpin,
    apronStatus: fullCourtPayrollStatus(fullCourtPayrollDollars(state.picks), state.money),
    reason: capEligible ? (cashEligible ? null : 'cash') : 'cap',
  };
}

function spinSlotOf(state: FullCourtDraftState, playerVersionId: string): Position {
  const pick = state.picks.find((entry) => entry.player.playerVersionId === playerVersionId);
  if (pick === undefined) {
    throw new Error(`full court roulette target ${playerVersionId} is not on the roster`);
  }
  const slot = pick.player.positions[0];
  if (slot === undefined) {
    throw new Error(`full court roulette target ${playerVersionId} has no playable position`);
  }
  return slot;
}

export function buildFullCourtSpinReceipt(input: {
  readonly state: FullCourtDraftState;
  readonly purchase: CapRushSpinPurchaseId;
  readonly targetPlayerVersionId: string;
  readonly commandId: CommandId;
  readonly rngFactory?: (seed: string) => Rng;
}): FullCourtSpinReceipt {
  assertFullCourtSpinReceiptDigests(input.state);
  const pick = input.state.picks.find(
    (entry) => entry.player.playerVersionId === input.targetPlayerVersionId,
  );
  if (pick === undefined) {
    throw new Error(
      `full court roulette target ${input.targetPlayerVersionId} is not on the roster`,
    );
  }
  const eligibility = fullCourtSpinEligibility(input.state, input.purchase);
  if (!eligibility.eligible) {
    throw new Error(
      `full court ${input.purchase} spin is not eligible (${eligibility.reason ?? 'unknown'})`,
    );
  }
  const spinOrdinal = fullCourtRouletteReceipts(input.state).length;
  const { tier, entries } = drawCapRushSpin({
    runSeed: input.state.runSeed,
    purchase: input.purchase,
    spinOrdinal,
    excludedMutationIds: ownedTeamExclusiveMutationIds(input.state),
    ...(input.rngFactory === undefined ? {} : { rngFactory: input.rngFactory }),
  });
  const entry = entries[0];
  if (entry === undefined) throw new Error('full court spin produced no mutation');
  const target = {
    playerId: pick.player.playerId,
    playerVersionId: pick.player.playerVersionId,
    slot: spinSlotOf(input.state, pick.player.playerVersionId),
  };
  const effective = applyHavocMutationPackage(capRushHavocSourceOf(pick.player), entries, {
    slot: target.slot,
  });
  const payload: Omit<FullCourtSpinReceipt, 'receiptDigest'> = {
    purchase: input.purchase,
    priceDollars: eligibility.priceDollars,
    payrollDollars: eligibility.payrollDollars,
    tier,
    target,
    entry,
    ...(entries.length > 1 ? { additionalEntries: entries.slice(1) } : {}),
    effective,
    commandId: input.commandId,
  };
  return fullCourtSpinReceiptSchema.parse({
    ...payload,
    receiptDigest: fullCourtSpinReceiptDigest(payload),
  });
}

function rouletteStateOf(state: FullCourtDraftState): FullCourtRouletteDraftState {
  return state.roulette ?? { status: 'open', receipts: [] };
}

function applyPurchaseSpin(
  state: FullCourtDraftState,
  command: FullCourtPurchaseSpinCommand,
  environment: FullCourtCommandEnvironment,
): FullCourtCommandOutcome {
  const mismatch = validateFullCourtRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.variant !== 'roulette') {
    return rejectFullCourtCommand(
      state,
      command,
      'spin-unavailable',
      'Full Court Standard has no roulette spins',
    );
  }
  if (state.stage !== 'complete') {
    return rejectFullCourtCommand(
      state,
      command,
      'phase-mismatch',
      'confirm the roster before buying a spin',
    );
  }
  const roulette = rouletteStateOf(state);
  if (roulette.status !== 'open') {
    return rejectFullCourtCommand(
      state,
      command,
      'spin-unavailable',
      `the roulette decision is ${roulette.status}`,
    );
  }
  const pick = state.picks.find(
    (entry) => entry.player.playerVersionId === command.targetPlayerVersionId,
  );
  if (pick === undefined) {
    return rejectFullCourtCommand(
      state,
      command,
      'player-not-rostered',
      `player version ${command.targetPlayerVersionId} is not on the roster`,
    );
  }
  if (
    roulette.receipts.some(
      (receipt) => receipt.target.playerVersionId === command.targetPlayerVersionId,
    )
  ) {
    return rejectFullCourtCommand(
      state,
      command,
      'spin-owned',
      `${pick.player.displayName} already has a mutation`,
    );
  }
  const eligibility = fullCourtSpinEligibility(state, command.purchase);
  if (!eligibility.eligible) {
    return rejectFullCourtCommand(
      state,
      command,
      'spin-ineligible',
      eligibility.reason === 'cap'
        ? `locked payroll plus earlier spins of $${String(eligibility.payrollDollars)} cannot fit a $${String(eligibility.priceDollars)} spin under the $${String(state.money.capLineDollars)} cap line`
        : `the War Chest cannot afford a $${String(eligibility.priceDollars)} spin`,
    );
  }
  let receipt: FullCourtSpinReceipt;
  try {
    receipt = buildFullCourtSpinReceipt({
      state,
      purchase: command.purchase,
      targetPlayerVersionId: command.targetPlayerVersionId,
      commandId: command.commandId,
      ...(environment.rngFactory !== undefined ? { rngFactory: environment.rngFactory } : {}),
    });
  } catch (error) {
    if (error instanceof CapRushSpinDrawUnavailableError) {
      return rejectFullCourtCommand(state, command, 'spin-draw-unavailable', error.message);
    }
    throw error;
  }
  const nextState = fullCourtDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    spending: [
      ...state.spending,
      {
        entryId: fullCourtSpinEntryId(receipt),
        kind: 'spin' as const,
        dollars: receipt.priceDollars,
        commandId: command.commandId,
      },
    ],
    roulette: { status: 'open', receipts: [...roulette.receipts, receipt] },
  });
  return acceptFullCourtCommand(state, command, nextState);
}

function applySkipSpin(
  state: FullCourtDraftState,
  command: FullCourtSkipSpinCommand,
  environment: FullCourtCommandEnvironment,
): FullCourtCommandOutcome {
  const mismatch = validateFullCourtRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.variant !== 'roulette') {
    return rejectFullCourtCommand(
      state,
      command,
      'spin-unavailable',
      'Full Court Standard has no roulette spins',
    );
  }
  if (state.stage !== 'complete') {
    return rejectFullCourtCommand(
      state,
      command,
      'phase-mismatch',
      'confirm the roster before skipping the spin',
    );
  }
  const roulette = rouletteStateOf(state);
  if (roulette.status !== 'open') {
    return rejectFullCourtCommand(
      state,
      command,
      'spin-unavailable',
      `the roulette decision is ${roulette.status}`,
    );
  }
  const nextState = fullCourtDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    roulette: { status: 'skipped', receipts: roulette.receipts },
  });
  return acceptFullCourtCommand(state, command, nextState);
}

function applyFinalizeRoulette(
  state: FullCourtDraftState,
  command: FullCourtFinalizeRouletteCommand,
  environment: FullCourtCommandEnvironment,
): FullCourtCommandOutcome {
  const mismatch = validateFullCourtRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.variant !== 'roulette') {
    return rejectFullCourtCommand(
      state,
      command,
      'spin-unavailable',
      'Full Court Standard starts directly after confirmation',
    );
  }
  if (state.stage !== 'complete') {
    return rejectFullCourtCommand(
      state,
      command,
      'phase-mismatch',
      'confirm the roster before finalizing roulette',
    );
  }
  const roulette = rouletteStateOf(state);
  if (roulette.status === 'finalized') {
    return rejectFullCourtCommand(
      state,
      command,
      'spin-unavailable',
      'roulette is already finalized',
    );
  }
  const nextState = fullCourtDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    roulette: { status: 'finalized', receipts: roulette.receipts },
  });
  return acceptFullCourtCommand(state, command, nextState);
}

export function applyFullCourtRouletteCommand(
  state: FullCourtDraftState,
  command: Extract<
    FullCourtCommand,
    {
      command: 'purchase-full-court-spin' | 'skip-full-court-spin' | 'finalize-full-court-roulette';
    }
  >,
  environment: FullCourtCommandEnvironment,
): FullCourtCommandOutcome {
  switch (command.command) {
    case 'purchase-full-court-spin':
      return applyPurchaseSpin(state, command, environment);
    case 'skip-full-court-spin':
      return applySkipSpin(state, command, environment);
    case 'finalize-full-court-roulette':
      return applyFinalizeRoulette(state, command, environment);
  }
}
