import {
  SEASON_INFLUENCE_CAP,
  SEASON_INFLUENCE_FLOOR,
  SEASON_OBJECTIVE_CATALOG,
  type SeasonHealthState,
  type SeasonInfluenceLedgerEntry,
  type SeasonInfluenceRehabOutcome,
  type SeasonInfluenceState,
  type SeasonObjectiveId,
  type SeasonRun,
  type SeasonTradeWindowState,
} from '@hoop-rush/data-contracts';
import { seasonObjectiveChoicesForBlock } from '@hoop-rush/engine';

/**
 * The frozen engine export lands at integration (lead-owned engine index);
 * the module types the call against the frozen signature until then.
 */
const choicesForBlock = seasonObjectiveChoicesForBlock as unknown as (
  rootSeed: string,
  blockIndex: number,
) => SeasonObjectiveId[];

/**
 * M2.5 Influence + objective presentation (season-influence-v1,
 * season-objective-v1). Pure display derivations: the human balance with
 * cap/floor facts, the recent ledger entries (authoritative reconciliation
 * source), the spend affordances per open trade window and per active
 * injury, and the objective picker view model (the block's deterministic
 * three-choice set, the recorded selection, and its recorded evaluation).
 * Balance and debt never modify gameplay; this module only renders.
 */

export interface InfluenceSpendAffordance {
  /** The spend the user can request. */
  purpose: 'extra-trade-offer' | 'risky-rehab';
  cost: number;
  /** windowIndex for extra-trade-offer spends. */
  windowIndex: number | null;
  /** injuryId for risky-rehab spends. */
  injuryId: string | null;
  /** The injured player for risky-rehab spends (from the health record). */
  playerVersionId: string | null;
  /** True when the spend was already recorded for this window/injury. */
  spent: boolean;
  /** True when the balance allows the spend (floor enforced by validation). */
  affordable: boolean;
  /** The recorded rehab outcome for risky-rehab spends (null when pending). */
  rehabOutcome: SeasonInfluenceRehabOutcome | null;
}

export interface InfluenceViewModel {
  balance: number;
  cap: number;
  floor: number;
  atCap: boolean;
  atFloor: boolean;
  /** The human's most recent ledger entries, newest first. */
  recentEntries: SeasonInfluenceLedgerEntry[];
  /** Spend affordances the UI can offer right now. */
  affordances: InfluenceSpendAffordance[];
}

/**
 * Spend affordances: one `extra-trade-offer` per tracked trade window (once
 * per franchise per window) and one `risky-rehab` per ACTIVE injury of the
 * human franchise (at most once per injury; `state.rehabs` records the spend
 * and its seeded outcome). `health` supplies the active injuries; without it
 * the rehab affordances are limited to already-recorded rehabs. `openWindow`
 * (the run's open trade window) supplies the extra-offer affordance when the
 * engine has not yet recorded the human's window state.
 */
export function influenceViewModel(
  state: SeasonInfluenceState,
  humanFranchiseId: string,
  health: SeasonHealthState | null = null,
  openWindow: SeasonTradeWindowState | null = null,
): InfluenceViewModel {
  const balance = state.balances[humanFranchiseId] ?? 0;
  const recentEntries = state.ledger
    .filter((entry) => entry.franchiseId === humanFranchiseId)
    .slice(-5)
    .reverse();
  const windowSpends = new Map(
    (state.windows[humanFranchiseId] ?? []).map((window) => [
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
      spent,
      affordable: !spent && balance - 1 >= SEASON_INFLUENCE_FLOOR,
      rehabOutcome: null,
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
    affordances.push({
      purpose: 'risky-rehab',
      cost: 2,
      windowIndex: null,
      injuryId,
      playerVersionId: record?.playerVersionId ?? null,
      spent: outcome !== null && outcome !== 'pending',
      affordable:
        (outcome === null || outcome === 'pending') && balance - 2 >= SEASON_INFLUENCE_FLOOR,
      rehabOutcome: outcome,
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

/** True when a spend of `cost` stays at/above the -3 floor. */
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
  /** The next unselected block (0-7); null when none remains or the season is complete. */
  blockIndex: number | null;
  /** The block's deterministic three-choice set (empty when no block remains). */
  choices: ObjectiveChoiceViewModel[];
  /** The recorded selection for the block, when already made. */
  selectedObjectiveId: SeasonObjectiveId | null;
  /** The recorded evaluation for the selection, when the block assembled. */
  success: boolean | null;
  /**
   * The most recent recorded evaluation of a completed block (the picker's
   * own selection evaluates only after the block commits, when the picker
   * has already moved on).
   */
  lastEvaluation: {
    blockIndex: number;
    objectiveId: SeasonObjectiveId;
    name: string;
    success: boolean;
  } | null;
}

/**
 * The objective picker facts for the next unselected block: the three
 * deterministic choices (engine `seasonObjectiveChoicesForBlock`), the
 * recorded selection, and its recorded evaluation once the block committed.
 * Block 8 (the final two-game block) never selects.
 */
export function objectiveChoicesViewModel(run: SeasonRun): ObjectiveChoicesViewModel {
  const blockIndex = nextObjectiveBlock(run);
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
  const offered: SeasonObjectiveId[] = choicesForBlock(run.rootSeed, blockIndex);
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

/** The most recent evaluated selection (success recorded), newest block first. */
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

/** The next block (0-7) without a recorded objective selection. */
export function nextObjectiveBlock(run: SeasonRun): number | null {
  if (run.cursor.completedRounds >= 82) return null;
  for (let blockIndex = 0; blockIndex <= 7; blockIndex += 1) {
    if (run.objectives.selections[blockIndex] === undefined) return blockIndex;
  }
  return null;
}
