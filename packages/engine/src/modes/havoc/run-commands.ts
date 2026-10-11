import type {
  HavocAbandonRunCommand,
  HavocAcceptGameCommand,
  HavocAcceptNormalGameCommand,
  HavocCommand,
  HavocCompleteComparisonCommand,
  HavocRunState,
} from '@hoop-rush/data-contracts';
import { HAVOC_GAME_COUNT } from '@hoop-rush/data-contracts';
import type { HavocCommandOutcome, HavocLockSources } from './api.ts';
import { FoldHavocAggregate } from './aggregate.ts';
import {
  acceptHavocCommand,
  applyHavocDraftCommand,
  rejectHavocCommand,
  type HavocCommandEnvironment,
} from './draft-commands.ts';

function validateRunAndRevision(
  state: HavocRunState,
  command:
    | HavocAcceptGameCommand
    | HavocAcceptNormalGameCommand
    | HavocCompleteComparisonCommand
    | HavocAbandonRunCommand,
): HavocCommandOutcome | null {
  if (command.runId !== state.runId) {
    return rejectHavocCommand(
      state,
      command,
      'run-mismatch',
      `command targets run ${command.runId}, active state is ${state.runId}`,
    );
  }
  if (command.expectedRevision !== state.revision) {
    return rejectHavocCommand(
      state,
      command,
      'stale-revision',
      `expected revision ${String(command.expectedRevision)}, current revision ${String(state.revision)}`,
    );
  }
  return null;
}

function isFinished(state: HavocRunState): boolean {
  return state.completionState === 'complete' || state.completionState === 'abandoned';
}

function applyAcceptHavocGame(
  state: HavocRunState,
  command: HavocAcceptGameCommand,
): HavocCommandOutcome {
  const mismatch = validateRunAndRevision(state, command);
  if (mismatch !== null) return mismatch;
  if (state.phase !== 'run' || state.locked === null) {
    return rejectHavocCommand(
      state,
      command,
      'phase-mismatch',
      'accept-havoc-game requires a locked run',
    );
  }
  if (isFinished(state)) {
    return rejectHavocCommand(state, command, 'already-complete', 'the run is no longer active');
  }
  if (state.havocCursor >= HAVOC_GAME_COUNT) {
    return rejectHavocCommand(
      state,
      command,
      'already-complete',
      'all 82 havoc games are already accepted',
    );
  }
  if (command.summary.variant !== 'havoc') {
    return rejectHavocCommand(
      state,
      command,
      'phase-mismatch',
      'accept-havoc-game requires a havoc variant summary',
    );
  }
  if (command.cursor !== state.havocCursor + 1) {
    return rejectHavocCommand(
      state,
      command,
      'cursor-mismatch',
      `expected havoc cursor ${String(state.havocCursor + 1)}, got ${String(command.cursor)}`,
    );
  }
  if (command.summary.gameNumber !== command.cursor) {
    return rejectHavocCommand(
      state,
      command,
      'cursor-mismatch',
      `summary game ${String(command.summary.gameNumber)} does not match cursor ${String(command.cursor)}`,
    );
  }
  const havocAggregate = FoldHavocAggregate(state.havocAggregate, command.summary);
  const havocCursor = state.havocCursor + 1;
  return acceptHavocCommand(state, command, {
    ...state,
    revision: state.revision + 1,
    havocCursor,
    havocAggregate,
    perfectSeason: havocCursor === HAVOC_GAME_COUNT && havocAggregate.losses === 0,
  });
}

function applyAcceptHavocNormalGame(
  state: HavocRunState,
  command: HavocAcceptNormalGameCommand,
): HavocCommandOutcome {
  const mismatch = validateRunAndRevision(state, command);
  if (mismatch !== null) return mismatch;
  if (state.phase !== 'run' || state.locked === null) {
    return rejectHavocCommand(
      state,
      command,
      'phase-mismatch',
      'accept-havoc-normal-game requires a locked run',
    );
  }
  if (isFinished(state)) {
    return rejectHavocCommand(state, command, 'already-complete', 'the run is no longer active');
  }
  if (state.comparisonStatus === 'unsupported') {
    return rejectHavocCommand(
      state,
      command,
      'version-mismatch',
      'the normal comparison is unsupported for these versions',
    );
  }
  if (state.havocCursor < HAVOC_GAME_COUNT) {
    return rejectHavocCommand(
      state,
      command,
      'cursor-mismatch',
      'the normal season starts only after all 82 havoc games are accepted',
    );
  }
  if (state.normalCursor >= HAVOC_GAME_COUNT) {
    return rejectHavocCommand(
      state,
      command,
      'already-complete',
      'all 82 normal games are already accepted',
    );
  }
  if (command.summary.variant !== 'normal') {
    return rejectHavocCommand(
      state,
      command,
      'phase-mismatch',
      'accept-havoc-normal-game requires a normal variant summary',
    );
  }
  if (command.cursor !== state.normalCursor + 1) {
    return rejectHavocCommand(
      state,
      command,
      'cursor-mismatch',
      `expected normal cursor ${String(state.normalCursor + 1)}, got ${String(command.cursor)}`,
    );
  }
  if (command.summary.gameNumber !== command.cursor) {
    return rejectHavocCommand(
      state,
      command,
      'cursor-mismatch',
      `summary game ${String(command.summary.gameNumber)} does not match cursor ${String(command.cursor)}`,
    );
  }
  const normalAggregate = FoldHavocAggregate(state.normalAggregate, command.summary);
  const normalCursor = state.normalCursor + 1;
  return acceptHavocCommand(state, command, {
    ...state,
    revision: state.revision + 1,
    normalCursor,
    normalAggregate,
    comparisonStatus: state.comparisonStatus === 'not-started' ? 'running' : state.comparisonStatus,
    completionState: normalCursor === HAVOC_GAME_COUNT ? 'comparison' : state.completionState,
  });
}

function applyCompleteHavocComparison(
  state: HavocRunState,
  command: HavocCompleteComparisonCommand,
): HavocCommandOutcome {
  const mismatch = validateRunAndRevision(state, command);
  if (mismatch !== null) return mismatch;
  if (state.phase !== 'run' || state.locked === null) {
    return rejectHavocCommand(
      state,
      command,
      'phase-mismatch',
      'complete-havoc-comparison requires a locked run',
    );
  }
  if (isFinished(state) || state.comparisonStatus === 'complete') {
    return rejectHavocCommand(
      state,
      command,
      'already-complete',
      'the comparison is already final',
    );
  }
  if (state.comparisonStatus === 'unsupported') {
    return rejectHavocCommand(
      state,
      command,
      'version-mismatch',
      'the normal comparison is unsupported for these versions',
    );
  }
  if (state.havocCursor < HAVOC_GAME_COUNT || state.normalCursor < HAVOC_GAME_COUNT) {
    return rejectHavocCommand(
      state,
      command,
      'cursor-mismatch',
      'both 82-game seasons must be accepted before the comparison completes',
    );
  }
  const mvpPick = state.locked.picks.find((pick) => pick.slot === command.mvp.slot);
  if (
    mvpPick === undefined ||
    mvpPick.card.source.playerId !== command.mvp.playerId ||
    mvpPick.card.source.playerVersionId !== command.mvp.playerVersionId
  ) {
    return rejectHavocCommand(
      state,
      command,
      'digest-mismatch',
      'the MVP does not match the locked lineup',
    );
  }
  return acceptHavocCommand(state, command, {
    ...state,
    revision: state.revision + 1,
    comparisonStatus: 'complete',
    completionState: 'complete',
  });
}

function applyAbandonHavocRun(
  state: HavocRunState,
  command: HavocAbandonRunCommand,
): HavocCommandOutcome {
  const mismatch = validateRunAndRevision(state, command);
  if (mismatch !== null) return mismatch;
  if (state.phase === 'draft') {
    return rejectHavocCommand(
      state,
      command,
      'phase-mismatch',
      'draft-phase abandonment is handled by discarding the active draft at the persistence boundary',
    );
  }
  if (isFinished(state)) {
    return rejectHavocCommand(state, command, 'already-complete', 'the run is no longer active');
  }
  return acceptHavocCommand(state, command, {
    ...state,
    revision: state.revision + 1,
    completionState: 'abandoned',
  });
}

export function ApplyHavocCommand(
  state: HavocRunState,
  command: HavocCommand,
  environment: HavocCommandEnvironment,
  lockSources: HavocLockSources,
): HavocCommandOutcome {
  switch (command.command) {
    case 'create-havoc-draft':
      return rejectHavocCommand(
        state,
        command,
        'phase-mismatch',
        'create-havoc-draft starts a new run through CreateHavocRunState',
      );
    case 'reroll-havoc-offer':
    case 'pick-havoc-card':
    case 'lock-havoc-lineup':
      return applyHavocDraftCommand(state, command, environment, lockSources);
    case 'accept-havoc-game':
      return applyAcceptHavocGame(state, command);
    case 'accept-havoc-normal-game':
      return applyAcceptHavocNormalGame(state, command);
    case 'complete-havoc-comparison':
      return applyCompleteHavocComparison(state, command);
    case 'abandon-havoc-run':
      return applyAbandonHavocRun(state, command);
  }
}
