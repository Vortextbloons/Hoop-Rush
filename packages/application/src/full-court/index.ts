import {
  FULL_COURT_DRAFT_SCHEMA_VERSION,
  fullCourtCommandSchema,
  type FullCourtCommand,
  type FullCourtCommandResult,
  type FullCourtDraftState,
} from '@hoop-rush/data-contracts';
import {
  applyFullCourtCommand,
  createFullCourtDraftState,
  fullCourtPurchasePhaseRejection,
  fullCourtStateDigest,
  type FullCourtCatalogIndex,
  type FullCourtPurchasePhase,
} from '@hoop-rush/engine';

export {
  advanceFullCourtSeasonSlot,
  startFullCourtSeason,
  type FullCourtSeasonAdvanceResult,
  type FullCourtSeasonRepository,
} from './season.ts';
export {
  advanceFullCourtPlayoffs,
  startFullCourtPlayoffs,
  type FullCourtPlayoffAdvanceResult,
  type FullCourtPlayoffRepository,
} from './playoffs.ts';
export {
  FullCourtAdvanceSession,
  type FullCourtAdvanceObserver,
  type FullCourtAdvanceOutcome,
  type FullCourtAdvancePlayoffCommandInput,
  type FullCourtAdvanceRequest,
  type FullCourtAdvanceSeasonCommandInput,
  type FullCourtAdvanceSessionDependencies,
  type FullCourtGamePlanClear,
  type FullCourtPlayoffProgressionResult,
  type FullCourtSeasonCommit,
} from './advance-session.ts';
export {
  FULL_COURT_REVIEW_SLOTS,
  fullCourtNextReviewSlot,
  fullCourtNextUserFixture,
  fullCourtPlayoffAdjustmentChanged,
  fullCourtRegularSeasonInjuryStop,
  fullCourtSlotOptions,
  fullCourtUserSeries,
  type FullCourtAdvanceOptions,
  type FullCourtAdvancePlayoffState,
  type FullCourtAdvanceSeasonState,
  type FullCourtPinnedGamePlan,
  type FullCourtPlayedGame,
  type FullCourtPlayoffView,
  type FullCourtSimulationStop,
  type FullCourtUserFixture,
} from './progression.ts';
export {
  applyFullCourtBlueprintToPlan,
  fullCourtRotationInputForPlan,
  saveFullCourtBlueprint,
  saveFullCourtCoaching,
  type ApplyFullCourtBlueprintResult,
  type SaveFullCourtBlueprintOptions,
} from './coaching.ts';
export { FULL_COURT_HISTORICAL_PRESETS } from './coaching-presets.ts';
export {
  archiveFullCourtRun,
  fullCourtHistoryFromSeason,
  type FullCourtHistoryRepository,
} from './history.ts';
export {
  buildFullCourtWatchedReplay,
  type BuildFullCourtWatchedReplayInput,
  type FullCourtPlayedGameOutcome,
  type FullCourtWatchedReplayRepository,
} from './replay.ts';

export interface FullCourtDraftCommitOptions {
  /**
   * The repository runs this inside its write transaction with the durable
   * season phase, so a purchase cannot slip past a phase change in another tab.
   */
  readonly guard?: (phase: FullCourtPurchasePhase) => FullCourtCommandResult | null;
}

export interface FullCourtDraftRepository {
  load(runId: string): Promise<FullCourtDraftState | null>;
  getReceipt(command: FullCourtCommand): Promise<FullCourtCommandResult | null>;
  commit(
    command: FullCourtCommand,
    state: FullCourtDraftState,
    result: FullCourtCommandResult,
    options?: FullCourtDraftCommitOptions,
  ): Promise<FullCourtCommandResult>;
}

export async function submitFullCourtDraftCommand(
  commandInput: FullCourtCommand,
  dependencies: { repository: FullCourtDraftRepository; index: FullCourtCatalogIndex },
): Promise<FullCourtCommandResult> {
  const command = fullCourtCommandSchema.parse(commandInput);
  const { repository, index } = dependencies;
  const receipt = await repository.getReceipt(command);
  if (receipt !== null) return receipt;
  const existing = await repository.load(command.runId);
  if (existing !== null) {
    const { state, result } = applyFullCourtCommand(existing, command, { index });
    if (command.command === 'purchase-full-court-report' && result.status === 'accepted') {
      return repository.commit(command, state, result, {
        guard: (phase) => fullCourtPurchasePhaseRejection(existing, command, phase),
      });
    }
    return repository.commit(command, state, result);
  }
  if (command.command !== 'create-full-court-draft') {
    throw new Error(`Full Court draft ${command.runId} was not found`);
  }
  const state = createFullCourtDraftState(command, index);
  return repository.commit(command, state, {
    schemaVersion: FULL_COURT_DRAFT_SCHEMA_VERSION,
    commandId: command.commandId,
    runId: command.runId,
    status: 'accepted',
    revisionBefore: 0,
    revisionAfter: state.revision,
    stateDigest: fullCourtStateDigest(state),
    rejection: null,
  });
}
