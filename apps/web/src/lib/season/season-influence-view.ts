import {
  SEASON_INFLUENCE_CAP,
  SEASON_INFLUENCE_FLOOR,
  franchiseIdSchema,
  type SeasonHealthState,
  type SeasonInfluenceLedgerEntry,
  type SeasonInfluenceRehabOutcome,
  type SeasonInfluenceState,
  type SeasonObjectiveId,
  type SeasonTradeWindowState,
} from '@hoop-rush/data-contracts';
import { rehabPriceOf } from '@hoop-rush/engine';
export interface InfluenceSpendAffordance {
  purpose: 'extra-trade-offer' | 'risky-rehab';
  cost: number;
  windowIndex: number | null;
  injuryId: string | null;
  playerVersionId: string | null;
  spent: boolean;
  affordable: boolean;
  rehabOutcome: SeasonInfluenceRehabOutcome | null;
  priceNote: string | null;
}
export interface InfluenceViewModel {
  balance: number;
  cap: number;
  floor: number;
  atCap: boolean;
  atFloor: boolean;
  recentEntries: SeasonInfluenceLedgerEntry[];
  affordances: InfluenceSpendAffordance[];
}
export function influenceViewModel(
  state: SeasonInfluenceState,
  humanFranchiseId: string,
  health: SeasonHealthState | null = null,
  openWindow: SeasonTradeWindowState | null = null,
  executiveId: import('@hoop-rush/data-contracts').SeasonFrontOfficeId | null = null,
): InfluenceViewModel {
  const fid = franchiseIdSchema.parse(humanFranchiseId);
  const balance = state.balances[fid] ?? 0;
  const recentEntries = state.ledger
    .filter((entry) => entry.franchiseId === humanFranchiseId)
    .slice(-5)
    .reverse();
  const windowSpends = new Map(
    (state.windows[fid] ?? []).map((window: { windowIndex: number; extraOfferSpent?: boolean }) => [
      window.windowIndex,
      window.extraOfferSpent,
    ]),
  );
  if (openWindow !== null && !windowSpends.has(openWindow.windowIndex)) {
    windowSpends.set(openWindow.windowIndex, false);
  }
  const affordances: InfluenceSpendAffordance[] = [];
  for (const [windowIndex, spent] of windowSpends) {
    affordances.push({
      purpose: 'extra-trade-offer',
      cost: 1,
      windowIndex,
      injuryId: null,
      playerVersionId: null,
      spent: spent ?? false,
      affordable: !spent && balance - 1 >= SEASON_INFLUENCE_FLOOR,
      rehabOutcome: null,
      priceNote: null,
    });
  }
  const rehabSpent = new Map<string, SeasonInfluenceRehabOutcome>();
  for (const [injuryId, rehab] of Object.entries(state.rehabs)) {
    rehabSpent.set(injuryId, rehab.outcome);
  }
  const activeInjuries =
    health === null
      ? []
      : health.injuries.filter(
          (record) =>
            record.franchiseId === humanFranchiseId &&
            record.missedGamesRemaining > 0 &&
            record.sameGameReturned !== true,
        );
  const injuryIds = new Set<string>();
  for (const record of activeInjuries) {
    injuryIds.add(record.injuryId);
  }
  for (const injuryId of rehabSpent.keys()) {
    injuryIds.add(injuryId);
  }
  for (const injuryId of injuryIds) {
    const record = activeInjuries.find((active) => active.injuryId === injuryId) ?? null;
    const outcome = rehabSpent.get(injuryId) ?? null;
    const rehabCost = rehabPriceOf(executiveId);
    affordances.push({
      purpose: 'risky-rehab',
      cost: rehabCost,
      windowIndex: null,
      injuryId,
      playerVersionId: record?.playerVersionId ?? null,
      spent: outcome !== null && outcome !== 'pending',
      affordable:
        (outcome === null || outcome === 'pending') &&
        balance - rehabCost >= SEASON_INFLUENCE_FLOOR,
      rehabOutcome: outcome,
      priceNote:
        executiveId === 'alex-chen'
          ? 'Recovery Director discount (minimum 1).'
          : executiveId === null
            ? null
            : 'Executive drawback (+1).',
    });
  }
  return {
    balance,
    cap: SEASON_INFLUENCE_CAP,
    floor: SEASON_INFLUENCE_FLOOR,
    atCap: balance >= SEASON_INFLUENCE_CAP,
    atFloor: balance <= SEASON_INFLUENCE_FLOOR,
    recentEntries,
    affordances,
  };
}
export interface ObjectiveChoiceViewModel {
  objectiveId: SeasonObjectiveId;
  name: string;
  description: string;
  measure: string;
  selected: boolean;
}
export interface ObjectiveChoicesViewModel {
  blockIndex: number | null;
  choices: ObjectiveChoiceViewModel[];
  selectedObjectiveId: SeasonObjectiveId | null;
  success: boolean | null;
  lastEvaluation: {
    blockIndex: number;
    objectiveId: SeasonObjectiveId;
    name: string;
    success: boolean;
  } | null;
}
