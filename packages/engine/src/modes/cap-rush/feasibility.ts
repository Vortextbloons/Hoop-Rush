import type { CapRushCard, CapRushDraftPick, Position } from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_HARD_LIMIT_DOLLARS,
  CAP_RUSH_OFFER_RECIPE,
  CAP_RUSH_OFFER_SIZE,
  POSITIONS,
} from '@hoop-rush/data-contracts';
import type { CapRushCatalogIndex } from './catalog.ts';
import { CapRushCatalogCoverageError } from './errors.ts';
import { capRushSalaryDollars } from './salary.ts';

export interface CapRushSlotSalaryOption {
  readonly playerId: string;
  readonly salaryDollars: number;
}

export interface CapRushCompletionInput {
  readonly index: CapRushCatalogIndex;
  readonly signedPlayerIds: ReadonlySet<string>;
  readonly slots: readonly Position[];
}

export function capRushSlotSalaryOptions(
  index: CapRushCatalogIndex,
  slot: Position,
  signedPlayerIds: ReadonlySet<string>,
  limit: number,
): readonly CapRushSlotSalaryOption[] {
  const byPlayer = new Map<string, number>();
  for (const player of index.bySlot.get(slot) ?? []) {
    if (signedPlayerIds.has(player.playerId)) continue;
    const salary = capRushSalaryDollars(player.originalOverall, player.seasonKey);
    const current = byPlayer.get(player.playerId);
    if (current === undefined || salary < current) byPlayer.set(player.playerId, salary);
  }
  return [...byPlayer.entries()]
    .map(([playerId, salaryDollars]) => ({ playerId, salaryDollars }))
    .sort((left, right) => {
      if (left.salaryDollars !== right.salaryDollars) {
        return left.salaryDollars - right.salaryDollars;
      }
      return left.playerId < right.playerId ? -1 : left.playerId > right.playerId ? 1 : 0;
    })
    .slice(0, limit);
}

export function capRushMinimumCompletionPayroll(input: CapRushCompletionInput): number | null {
  if (input.slots.length === 0) return 0;
  if (new Set(input.slots).size !== input.slots.length) {
    throw new Error('cap rush completion slots must be distinct');
  }
  const limit = input.slots.length;
  const options = input.slots.map((slot) => ({
    slot,
    options: capRushSlotSalaryOptions(input.index, slot, input.signedPlayerIds, limit),
  }));
  if (options.some((entry) => entry.options.length === 0)) return null;
  options.sort((left, right) => {
    if (left.options.length !== right.options.length) {
      return left.options.length - right.options.length;
    }
    return POSITIONS.indexOf(left.slot) - POSITIONS.indexOf(right.slot);
  });
  let best = Number.POSITIVE_INFINITY;
  const used = new Set<string>();
  function search(position: number, total: number): void {
    if (total >= best) return;
    if (position === options.length) {
      best = total;
      return;
    }
    const entry = options[position];
    if (entry === undefined) return;
    for (const option of entry.options) {
      if (used.has(option.playerId)) continue;
      used.add(option.playerId);
      search(position + 1, total + option.salaryDollars);
      used.delete(option.playerId);
    }
  }
  search(0, 0);
  return Number.isFinite(best) ? best : null;
}

export type CapRushSigningRejectionReason = 'hard-limit' | 'completion' | 'no-completion';

export interface CapRushSigningAssessment {
  readonly legal: boolean;
  readonly reason: CapRushSigningRejectionReason | null;
  readonly payrollAfterSigning: number;
  readonly minimumCompletionPayroll: number | null;
  readonly projectedPayroll: number | null;
}

export function capRushUnfilledSlots(picks: readonly { readonly slot: Position }[]): Position[] {
  const filled = new Set(picks.map((pick) => pick.slot));
  return POSITIONS.filter((slot) => !filled.has(slot));
}

export function capRushAssessSigning(
  state: { readonly picks: readonly CapRushDraftPick[] },
  index: CapRushCatalogIndex,
  card: CapRushCard,
): CapRushSigningAssessment {
  const payroll = state.picks.reduce((total, pick) => total + pick.card.salaryDollars, 0);
  const payrollAfterSigning = payroll + card.salaryDollars;
  if (payrollAfterSigning > CAP_RUSH_HARD_LIMIT_DOLLARS) {
    return {
      legal: false,
      reason: 'hard-limit',
      payrollAfterSigning,
      minimumCompletionPayroll: null,
      projectedPayroll: null,
    };
  }
  const signed = new Set(state.picks.map((pick) => pick.card.source.playerId));
  signed.add(card.source.playerId);
  const remainingSlots = capRushUnfilledSlots(state.picks).filter((slot) => slot !== card.slot);
  const minimumCompletionPayroll = capRushMinimumCompletionPayroll({
    index,
    signedPlayerIds: signed,
    slots: remainingSlots,
  });
  if (minimumCompletionPayroll === null) {
    return {
      legal: false,
      reason: 'no-completion',
      payrollAfterSigning,
      minimumCompletionPayroll: null,
      projectedPayroll: null,
    };
  }
  const projectedPayroll = payrollAfterSigning + minimumCompletionPayroll;
  if (projectedPayroll > CAP_RUSH_HARD_LIMIT_DOLLARS) {
    return {
      legal: false,
      reason: 'completion',
      payrollAfterSigning,
      minimumCompletionPayroll,
      projectedPayroll,
    };
  }
  return {
    legal: true,
    reason: null,
    payrollAfterSigning,
    minimumCompletionPayroll,
    projectedPayroll,
  };
}

export function capRushOfferLegalCardIds(
  state: { readonly picks: readonly CapRushDraftPick[] },
  index: CapRushCatalogIndex,
  cards: readonly CapRushCard[],
): string[] {
  return cards
    .filter((card) => capRushAssessSigning(state, index, card).legal)
    .map((card) => card.cardId);
}

export interface CapRushCatalogCoverageIssue {
  readonly slot: Position | null;
  readonly message: string;
}

export function capRushCatalogCoverageIssues(
  index: CapRushCatalogIndex,
): readonly CapRushCatalogCoverageIssue[] {
  const issues: CapRushCatalogCoverageIssue[] = [];
  for (const slot of POSITIONS) {
    const players = index.bySlot.get(slot) ?? [];
    const people = new Set(players.map((player) => player.playerId));
    if (people.size < CAP_RUSH_OFFER_SIZE) {
      issues.push({
        slot,
        message: `only ${String(people.size)} distinct eligible people (need ${String(CAP_RUSH_OFFER_SIZE)})`,
      });
      continue;
    }
    for (const rule of CAP_RUSH_OFFER_RECIPE) {
      if (rule.bucket === 'wildcard') continue;
      const covered = new Set(
        players
          .filter(
            (player) =>
              player.originalOverall >= rule.minOverall &&
              player.originalOverall <= rule.maxOverall,
          )
          .map((player) => player.playerId),
      );
      if (covered.size < rule.count) {
        issues.push({
          slot,
          message: `${rule.bucket} band has ${String(covered.size)} distinct people (need ${String(rule.count)})`,
        });
      }
    }
  }
  const initialCompletion = capRushMinimumCompletionPayroll({
    index,
    signedPlayerIds: new Set(),
    slots: POSITIONS,
  });
  if (initialCompletion === null) {
    issues.push({
      slot: null,
      message: 'no distinct five-player lineup can fill all five slots',
    });
  } else if (initialCompletion > CAP_RUSH_HARD_LIMIT_DOLLARS) {
    issues.push({
      slot: null,
      message: `the cheapest legal lineup costs $${String(initialCompletion)} which exceeds the $${String(CAP_RUSH_HARD_LIMIT_DOLLARS)} hard limit`,
    });
  }
  return issues;
}

export function assertCapRushCatalogCoverage(index: CapRushCatalogIndex): void {
  const issue = capRushCatalogCoverageIssues(index)[0];
  if (issue !== undefined) throw new CapRushCatalogCoverageError(issue.slot, issue.message);
}
