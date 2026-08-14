import {
  SEASON_INFLUENCE_CAP,
  SEASON_INFLUENCE_FLOOR,
  type SeasonInfluenceLedgerEntry,
  type SeasonInfluenceState,
  type SeasonTransactionEntry,
} from '@hoop-rush/data-contracts';
import { seasonTransactionEntry } from './transactions.ts';

/**
 * M2.5 Influence economy (season-influence-v1, engine side). Pure functions
 * over the run-scoped Influence state: creation, block grants, objective
 * rewards, and spending. Balances always reconcile from the append-only
 * ledger; the +8 cap applies 0 with a recorded entry, the -3 floor rejects
 * spends by typed validation. Balance and debt NEVER modify gameplay.
 *
 * Ledger/transaction facts (M2.5 contract §6-§7):
 * - every grant/reward/spend appends ONE ledger entry recording
 *   requestedDelta, appliedDelta, balanceAfter, source, blockIndex,
 *   commandId, and explanation; `balanceAfter === balanceBefore +
 *   appliedDelta` always holds.
 * - block-grant ledger entries carry commandId null (no producing command);
 *   the league-wide `block-grant` transaction entry and the `objective-
 *   reward` transaction entry use deterministic synthetic commandIds
 *   (contract §6: system-generated entries use a deterministic synthetic
 *   command id; the ledger entry is the null-command record).
 * - `appliedAtStateRevision` on transaction entries defaults to
 *   `blockIndex + 1` (the revision the block commit produces in the
 *   standard pipeline); callers that know the real revision pass it.
 */

/**
 * Initial run-creation state: every franchise at +2 with its recorded
 * initial-grant ledger entry (blockIndex/commandId null).
 */
export function createInitialSeasonInfluenceState(
  franchiseIds: readonly string[],
): SeasonInfluenceState {
  const balances: Record<string, number> = {};
  const ledger: SeasonInfluenceLedgerEntry[] = [];
  const windows: Record<string, { windowIndex: number; extraOfferSpent: boolean }[]> = {};
  for (const franchiseId of franchiseIds) {
    balances[franchiseId] = 2;
    ledger.push({
      entryId: `influence-initial-${franchiseId}`,
      franchiseId,
      source: 'initial-grant',
      blockIndex: null,
      commandId: null,
      requestedDelta: 2,
      appliedDelta: 2,
      balanceAfter: 2,
      explanation: 'Initial +2 Influence grant at run creation',
    });
    windows[franchiseId] = [];
  }
  return {
    schemaVersion: 1,
    influenceVersion: 'season-influence-v1',
    balances,
    ledger,
    windows,
    rehabs: {},
  };
}

export interface SeasonBlockInfluenceGrantInput {
  influence: SeasonInfluenceState;
  blockIndex: number;
  humanFranchiseId: string | null;
  /** Objective success (null when no objective was locked). */
  objectiveSuccess: boolean | null;
  /**
   * The run stateRevision these entries apply at. Optional: defaults to the
   * blockIndex-derived value `blockIndex + 1` (the revision the standard
   * block pipeline produces for block `blockIndex`); the block pipeline
   * passes the real post-block revision when it knows it.
   */
  appliedAtStateRevision?: number;
}

export interface SeasonBlockInfluenceGrantOutput {
  influence: SeasonInfluenceState;
  entries: SeasonTransactionEntry[];
}

/**
 * Applies the accepted-block economy (M2.5 contract §7): +1 block grant for
 * ALL 30 franchises with cap-apply (a grant at the +8 cap applies 0 and
 * records `appliedDelta: 0` with the `cap-reached` explanation), and +1
 * objective reward for the human franchise when the locked objective
 * succeeded (also cap-applied). Every grant appends one ledger entry; the
 * function returns the new influence state plus the transaction entries
 * (one league-wide `block-grant`, plus one `objective-reward` on success).
 */
export function applySeasonBlockInfluenceGrants(
  input: SeasonBlockInfluenceGrantInput,
): SeasonBlockInfluenceGrantOutput {
  const { influence, blockIndex, humanFranchiseId, objectiveSuccess } = input;
  const appliedAtStateRevision = input.appliedAtStateRevision ?? blockIndex + 1;

  const balances: Record<string, number> = { ...influence.balances };
  const ledger: SeasonInfluenceLedgerEntry[] = [...influence.ledger];
  const capReachedFranchiseIds: string[] = [];

  for (const franchiseId of Object.keys(balances)) {
    const requestedDelta = 1;
    const appliedDelta = (balances[franchiseId] ?? 0) < SEASON_INFLUENCE_CAP ? 1 : 0;
    if (appliedDelta === 0) capReachedFranchiseIds.push(franchiseId);
    balances[franchiseId] = (balances[franchiseId] ?? 0) + appliedDelta;
    ledger.push({
      entryId: `influence-block-${String(blockIndex)}-${franchiseId}`,
      franchiseId,
      source: 'block-grant',
      blockIndex,
      commandId: null,
      requestedDelta,
      appliedDelta,
      balanceAfter: balances[franchiseId] ?? 0,
      explanation:
        appliedDelta === 1
          ? `+1 Influence block grant (block ${String(blockIndex)})`
          : `Block grant at the +8 cap (block ${String(blockIndex)})`,
    });
  }

  const entries: SeasonTransactionEntry[] = [
    seasonTransactionEntry({
      transactionId: `txn-block-grant-${String(blockIndex)}`,
      commandId: `sys-block-grant-${String(blockIndex)}`,
      franchiseId: null,
      type: 'block-grant',
      blockIndex,
      appliedAtStateRevision,
      payload: {
        blockIndex,
        franchiseCount: Object.keys(balances).length,
        appliedDelta: 1,
        capReachedCount: capReachedFranchiseIds.length,
        capReachedFranchiseIds,
      },
      explanation: `+1 Influence block grant for all 30 franchises (block ${String(blockIndex)})`,
    }),
  ];

  if (objectiveSuccess === true && humanFranchiseId !== null) {
    const requestedDelta = 1;
    const appliedDelta = (balances[humanFranchiseId] ?? 0) < SEASON_INFLUENCE_CAP ? 1 : 0;
    balances[humanFranchiseId] = (balances[humanFranchiseId] ?? 0) + appliedDelta;
    ledger.push({
      entryId: `influence-objective-${String(blockIndex)}-${humanFranchiseId}`,
      franchiseId: humanFranchiseId,
      source: 'objective-reward',
      blockIndex,
      commandId: null,
      requestedDelta,
      appliedDelta,
      balanceAfter: balances[humanFranchiseId] ?? 0,
      explanation:
        appliedDelta === 1
          ? `+1 Influence objective reward (block ${String(blockIndex)})`
          : `Objective reward at the +8 cap (block ${String(blockIndex)})`,
    });
    entries.push(
      seasonTransactionEntry({
        transactionId: `txn-objective-reward-${String(blockIndex)}`,
        commandId: `sys-objective-reward-${String(blockIndex)}`,
        franchiseId: humanFranchiseId,
        type: 'objective-reward',
        blockIndex,
        appliedAtStateRevision,
        payload: { blockIndex, appliedDelta, objectiveSuccess: true },
        explanation: `+1 Influence objective reward for ${humanFranchiseId} (block ${String(blockIndex)})`,
      }),
    );
  }

  return {
    influence: { ...influence, balances, ledger },
    entries,
  };
}

/** Spend input shared by the typed command handler and the AI window logic. */
export interface SeasonInfluenceSpendInput {
  influence: SeasonInfluenceState;
  franchiseId: string;
  source: 'extra-trade-offer' | 'risky-rehab';
  /** Negative (the cost the purpose charges). */
  requestedDelta: number;
  blockIndex: number | null;
  commandId: string | null;
  explanation: string;
  /** Track the extra-trade-offer window spend (purpose extra-trade-offer). */
  windowIndex?: number;
  /** Track the risky-rehab spend per injury (purpose risky-rehab). */
  injuryId?: string;
  /** The seeded rehab outcome to record on the rehabs entry. */
  rehabOutcome?: 'success' | 'failure' | 'pending';
}

/** Typed floor rejection for a spend that would cross the -3 floor. */
export class SeasonInfluenceFloorError extends Error {
  readonly code = 'insufficient-balance' as const;
  readonly franchiseId: string;
  readonly balance: number;
  readonly requestedDelta: number;
  readonly floor: number = SEASON_INFLUENCE_FLOOR;

  constructor(input: { franchiseId: string; balance: number; requestedDelta: number }) {
    super(
      `influence spend for ${input.franchiseId} would cross the -3 floor ` +
        `(balance ${String(input.balance)}, requested ${String(input.requestedDelta)})`,
    );
    this.name = 'SeasonInfluenceFloorError';
    this.franchiseId = input.franchiseId;
    this.balance = input.balance;
    this.requestedDelta = input.requestedDelta;
  }
}

/**
 * Applies one Influence spend with the -3 floor enforced by validation
 * (LEAD DECISION: never a silent clamp). Rejects by throwing
 * `SeasonInfluenceFloorError` when `balance + requestedDelta < -3`; the
 * typed command handler pre-validates and returns the `insufficient-balance`
 * rejection, and callers must treat the throw as an invariant. Appends one
 * ledger entry recording requested/applied delta and the balance after, and
 * tracks the spend on the influence state (`windows` for extra-trade-offer,
 * `rehabs` for risky-rehab).
 */
export function applySeasonInfluenceSpend(input: SeasonInfluenceSpendInput): {
  influence: SeasonInfluenceState;
  entry: SeasonInfluenceLedgerEntry;
} {
  const { influence, franchiseId, source, requestedDelta, blockIndex, commandId, explanation } =
    input;
  const balanceBefore = influence.balances[franchiseId] ?? 0;
  if (balanceBefore + requestedDelta < SEASON_INFLUENCE_FLOOR) {
    throw new SeasonInfluenceFloorError({ franchiseId, balance: balanceBefore, requestedDelta });
  }
  const balanceAfter = balanceBefore + requestedDelta;
  const entry: SeasonInfluenceLedgerEntry = {
    entryId: `influence-spend-${commandId ?? 'system'}`,
    franchiseId,
    source,
    blockIndex,
    commandId,
    requestedDelta,
    appliedDelta: requestedDelta,
    balanceAfter,
    explanation,
  };

  const balances: Record<string, number> = { ...influence.balances, [franchiseId]: balanceAfter };
  const ledger: SeasonInfluenceLedgerEntry[] = [...influence.ledger, entry];
  let windows = influence.windows;
  let rehabs = influence.rehabs;
  if (input.windowIndex !== undefined && source === 'extra-trade-offer') {
    windows = {
      ...windows,
      [franchiseId]: [
        ...(windows[franchiseId] ?? []),
        { windowIndex: input.windowIndex, extraOfferSpent: true },
      ],
    };
  }
  if (input.injuryId !== undefined && source === 'risky-rehab') {
    rehabs = {
      ...rehabs,
      [input.injuryId]: {
        franchiseId,
        outcome: input.rehabOutcome ?? 'pending',
        commandId: commandId ?? 'system',
      },
    };
  }
  return { influence: { ...influence, balances, ledger, windows, rehabs }, entry };
}

/** Cap + floor freeze (schema constants, re-exported for the CLI gates). */
export { SEASON_INFLUENCE_CAP, SEASON_INFLUENCE_FLOOR };
