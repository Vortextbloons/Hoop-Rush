import type {
  CapRushPayrollStatus,
  FullCourtDraftPick,
  FullCourtDraftState,
  FullCourtMoneyConfig,
  FullCourtSpendingEntry,
  PlayerId,
  SimulationRatings,
} from '@hoop-rush/data-contracts';
import {
  FULL_COURT_MATCH_MINIMUM_PLAYERS,
  FULL_COURT_MAX_ROSTER_SIZE,
  FULL_COURT_MIN_ROSTER_SIZE,
} from '@hoop-rush/data-contracts';
import { capRushEffectiveRatings } from '../cap-rush/salary.ts';
import type { FullCourtCatalogIndex } from './draft-catalog.ts';
import { fullCourtMinimumCompletionDollars } from './draft-catalog.ts';

export function fullCourtPayrollDollars(picks: readonly FullCourtDraftPick[]): number {
  return picks.reduce((total, pick) => total + pick.salaryDollars, 0);
}

export function fullCourtSpentDollars(spending: readonly FullCourtSpendingEntry[]): number {
  return spending.reduce((total, entry) => total + entry.dollars, 0);
}

export function fullCourtWarChestDollars(state: {
  readonly money: FullCourtMoneyConfig;
  readonly spending: readonly FullCourtSpendingEntry[];
}): number {
  return state.money.startingWarChestDollars - fullCourtSpentDollars(state.spending);
}

/**
 * Payroll alone selects the apron; the hard payroll limit and the War Chest are separate
 * constraints. Thresholds come from the draft's pinned money config, and the status names
 * match Cap Rush so its apron reductions apply unchanged.
 */
export function fullCourtPayrollStatus(
  payrollDollars: number,
  money: FullCourtMoneyConfig,
): CapRushPayrollStatus {
  if (!Number.isInteger(payrollDollars) || payrollDollars < 0) {
    throw new Error(
      `full court payroll must be a nonnegative integer dollar amount (got ${String(payrollDollars)})`,
    );
  }
  if (payrollDollars <= money.capLineDollars) return 'under-cap';
  if (payrollDollars <= money.firstApronDollars) return 'first-apron';
  if (payrollDollars <= money.hardLimitDollars) return 'second-apron';
  return 'illegal';
}

/** Full Court's pinned payroll status feeds the shared Cap Rush apron reduction tables. */
export function fullCourtEffectiveRatings(
  ratings: SimulationRatings,
  status: CapRushPayrollStatus,
): SimulationRatings {
  return capRushEffectiveRatings(ratings, status);
}

export type FullCourtPickRejectionReason =
  'phase-mismatch' | 'roster-full' | 'duplicate-player' | 'hard-limit' | 'cash' | 'completion';

export type FullCourtPickAssessment = {
  readonly payrollAfterPick: number;
  readonly warChestAfterPick: number;
  readonly minimumCompletionDollars: number | null;
  readonly projectedPayroll: number | null;
} & (
  | { readonly legal: true; readonly reason: null }
  | { readonly legal: false; readonly reason: FullCourtPickRejectionReason }
);

/**
 * Whether one more pick keeps the draft legally completable.
 *
 * Until `FULL_COURT_MIN_ROSTER_SIZE` picks are secured, a pick must leave both hard-limit
 * payroll room and cash for the cheapest legal completion of the missing roster places,
 * priced from eligible catalog people with current picks excluded. From six picks on depth
 * is optional, so only the immediate paycheck and cash balance must hold. Positions are
 * advisory, so a completion only needs distinct people.
 */
export function fullCourtAssessPick(input: {
  readonly index: FullCourtCatalogIndex;
  readonly state: FullCourtDraftState;
  readonly playerId: PlayerId;
  readonly salaryDollars: number;
}): FullCourtPickAssessment {
  const payrollAfterPick = fullCourtPayrollDollars(input.state.picks) + input.salaryDollars;
  const warChestAfterPick = fullCourtWarChestDollars(input.state) - input.salaryDollars;
  const rejected = (
    reason: FullCourtPickRejectionReason,
    minimumCompletionDollars: number | null,
    projectedPayroll: number | null,
  ): FullCourtPickAssessment => ({
    legal: false,
    reason,
    payrollAfterPick,
    warChestAfterPick,
    minimumCompletionDollars,
    projectedPayroll,
  });

  if (input.state.stage !== 'drafting') return rejected('phase-mismatch', null, null);
  if (input.state.picks.length >= FULL_COURT_MAX_ROSTER_SIZE) {
    return rejected('roster-full', null, null);
  }
  const excluded = new Set(input.state.picks.map((pick) => pick.player.playerId));
  if (excluded.has(input.playerId)) return rejected('duplicate-player', null, null);
  if (payrollAfterPick > input.state.money.hardLimitDollars) {
    return rejected('hard-limit', null, null);
  }
  if (warChestAfterPick < 0) return rejected('cash', null, null);

  const rosterAfter = input.state.picks.length + 1;
  if (rosterAfter >= FULL_COURT_MIN_ROSTER_SIZE) {
    return {
      legal: true,
      reason: null,
      payrollAfterPick,
      warChestAfterPick,
      minimumCompletionDollars: null,
      projectedPayroll: null,
    };
  }
  excluded.add(input.playerId);
  const minimumCompletionDollars = fullCourtMinimumCompletionDollars(
    input.index,
    excluded,
    FULL_COURT_MIN_ROSTER_SIZE - rosterAfter,
  );
  if (minimumCompletionDollars === null) {
    return rejected('completion', null, null);
  }
  const projectedPayroll = payrollAfterPick + minimumCompletionDollars;
  if (projectedPayroll > input.state.money.hardLimitDollars) {
    return rejected('completion', minimumCompletionDollars, projectedPayroll);
  }
  if (warChestAfterPick < minimumCompletionDollars) {
    return rejected('cash', minimumCompletionDollars, projectedPayroll);
  }
  return {
    legal: true,
    reason: null,
    payrollAfterPick,
    warChestAfterPick,
    minimumCompletionDollars,
    projectedPayroll,
  };
}

export type FullCourtPurchaseRejectionReason = 'cash' | 'completion';

export interface FullCourtPurchaseAssessment {
  readonly priceDollars: number;
  readonly warChestAfterPurchase: number;
  /** Reports never touch payroll, so this always equals the current draft payroll. */
  readonly payrollDollars: number;
  readonly payrollStatus: CapRushPayrollStatus;
  readonly minimumCompletionDollars: number | null;
  readonly legal: boolean;
  readonly reason: FullCourtPurchaseRejectionReason | null;
}

/**
 * Whether a War Room purchase keeps the run legal.
 *
 * Purchases are information, not salary: payroll and the apron stay exactly where they
 * were. Before six picks, the remaining War Chest must still cover the cheapest legal
 * distinct-player completion; from six picks on only the immediate balance has to hold.
 */
export function fullCourtAssessPurchase(input: {
  readonly index: FullCourtCatalogIndex;
  readonly state: FullCourtDraftState;
  readonly priceDollars: number;
}): FullCourtPurchaseAssessment {
  if (!Number.isInteger(input.priceDollars) || input.priceDollars <= 0) {
    throw new Error(
      `full court purchase requires a positive integer dollar price (got ${String(input.priceDollars)})`,
    );
  }
  const payrollDollars = fullCourtPayrollDollars(input.state.picks);
  const warChestAfterPurchase = fullCourtWarChestDollars(input.state) - input.priceDollars;
  const base = {
    priceDollars: input.priceDollars,
    warChestAfterPurchase,
    payrollDollars,
    payrollStatus: fullCourtPayrollStatus(payrollDollars, input.state.money),
  };
  if (warChestAfterPurchase < 0) {
    return { ...base, minimumCompletionDollars: null, legal: false, reason: 'cash' };
  }
  const missingPlayers = Math.max(0, FULL_COURT_MIN_ROSTER_SIZE - input.state.picks.length);
  if (missingPlayers === 0) {
    return { ...base, minimumCompletionDollars: null, legal: true, reason: null };
  }
  const excluded = new Set(input.state.picks.map((pick) => pick.player.playerId));
  const minimumCompletionDollars = fullCourtMinimumCompletionDollars(
    input.index,
    excluded,
    missingPlayers,
  );
  if (minimumCompletionDollars === null) {
    return { ...base, minimumCompletionDollars: null, legal: false, reason: 'completion' };
  }
  if (warChestAfterPurchase < minimumCompletionDollars) {
    return { ...base, minimumCompletionDollars, legal: false, reason: 'cash' };
  }
  return { ...base, minimumCompletionDollars, legal: true, reason: null };
}

export interface FullCourtDepthForecast {
  /** Cheapest way to fill the open roster places, or to add one depth player. */
  readonly costDollars: number | null;
  /** Open places before the roster is draft-legal; 0 once six picks are secured. */
  readonly missingPlayers: number;
}

/**
 * Before six picks this is the remaining cost of a legal roster; from six picks on it is
 * the cost of adding one more depth player.
 */
export function fullCourtDepthForecast(input: {
  readonly index: FullCourtCatalogIndex;
  readonly state: FullCourtDraftState;
}): FullCourtDepthForecast {
  const rosterSize = input.state.picks.length;
  if (input.state.stage === 'complete' || rosterSize >= FULL_COURT_MAX_ROSTER_SIZE) {
    return { costDollars: null, missingPlayers: 0 };
  }
  const excluded = new Set(input.state.picks.map((pick) => pick.player.playerId));
  const places = Math.max(1, FULL_COURT_MIN_ROSTER_SIZE - rosterSize);
  return {
    costDollars: fullCourtMinimumCompletionDollars(input.index, excluded, places),
    missingPlayers: Math.max(0, FULL_COURT_MIN_ROSTER_SIZE - rosterSize),
  };
}

/** Simultaneous absences the roster absorbs before dropping below a legal five. */
export function fullCourtAbsenceTolerance(rosterSize: number): number {
  return Math.max(0, rosterSize - FULL_COURT_MATCH_MINIMUM_PLAYERS);
}
