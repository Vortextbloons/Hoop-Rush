import {
  SEASON_INFLUENCE_CAP,
  SEASON_INFLUENCE_FLOOR,
  SEASON_OBJECTIVE_CATALOG,
  franchiseIdSchema,
  type SeasonHealthState,
  type SeasonInfluenceLedgerEntry,
  type SeasonInfluenceRehabOutcome,
  type SeasonInfluenceState,
  type SeasonObjectiveId,
  type SeasonRun,
  type SeasonTradeWindowState,
} from '@hoop-rush/data-contracts';
import { seasonObjectiveChoicesForBlock } from '@hoop-rush/engine';
import { rehabPriceOf } from '@hoop-rush/engine';
import { SEASON_ROUND_COUNT } from '@hoop-rush/data-contracts';
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
export function canAffordSpend(balance: number, cost: number): boolean {
  return balance - cost >= SEASON_INFLUENCE_FLOOR;
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
export function objectiveChoicesViewModel(
  run: SeasonRun,
  acceptedBlockCount: number | null = null,
): ObjectiveChoicesViewModel {
  const blockIndex = currentObjectiveBlock(run, acceptedBlockCount);
  const definitions = new Map(SEASON_OBJECTIVE_CATALOG.map((entry) => [entry.objectiveId, entry]));
  if (blockIndex === null) {
    return {
      blockIndex: null,
      choices: [],
      selectedObjectiveId: null,
      success: null,
      lastEvaluation: lastEvaluatedSelection(run, definitions),
    };
  }
  const offered: SeasonObjectiveId[] = seasonObjectiveChoicesForBlock(run.rootSeed, blockIndex);
  const selection = run.objectives.selections[blockIndex] ?? null;
  const choices = offered.map((objectiveId) => {
    const definition = definitions.get(objectiveId);
    return {
      objectiveId,
      name: definition?.name ?? objectiveId,
      description: definition?.description ?? '',
      measure: definition?.measure ?? '',
      selected: selection?.objectiveId === objectiveId,
    };
  });
  return {
    blockIndex,
    choices,
    selectedObjectiveId: selection?.objectiveId ?? null,
    success: selection?.success ?? null,
    lastEvaluation: lastEvaluatedSelection(run, definitions),
  };
}
function lastEvaluatedSelection(
  run: SeasonRun,
  definitions: Map<SeasonObjectiveId, (typeof SEASON_OBJECTIVE_CATALOG)[number]>,
): ObjectiveChoicesViewModel['lastEvaluation'] {
  for (let blockIndex = 7; blockIndex >= 0; blockIndex -= 1) {
    const selection = run.objectives.selections[blockIndex];
    if (selection !== undefined && selection.success !== null) {
      return {
        blockIndex,
        objectiveId: selection.objectiveId,
        name: definitions.get(selection.objectiveId)?.name ?? selection.objectiveId,
        success: selection.success,
      };
    }
  }
  return null;
}
function acceptedBlockCountOf(completedRounds: number): number {
  if (completedRounds <= 0) return 0;
  return Math.ceil(completedRounds / 10);
}
export function currentObjectiveBlock(
  run: SeasonRun,
  acceptedBlockCount: number | null = null,
): number | null {
  if (run.cursor.completedRounds >= SEASON_ROUND_COUNT) return null;
  const fromCursor = acceptedBlockCountOf(run.cursor.completedRounds);
  // acceptedBlocks.length (shell.nextBlockIndex) is the commit boundary the block
  // runner and submit gate use. If it disagrees with ceil(completedRounds/10) the
  // snapshot is stale (e.g. a select bumped stateRevision without moving the cursor,
  // or a block commit landed without a refresh) — prefer acceptedBlocks and let the
  // caller force a refresh so the picker and the submit gate agree.
  const blockIndex = acceptedBlockCount ?? fromCursor;
  if (acceptedBlockCount !== null && acceptedBlockCount !== fromCursor) {
    if (acceptedBlockCount >= 8) return null;
    return acceptedBlockCount;
  }
  if (blockIndex >= 8) return null;
  return blockIndex;
}
