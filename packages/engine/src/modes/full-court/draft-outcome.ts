import type {
  CommandOutcome,
  FullCourtCommand,
  FullCourtCommandRejectionCode,
  FullCourtCommandResult,
  FullCourtDraftState,
} from '@hoop-rush/data-contracts';
import {
  FULL_COURT_DRAFT_SCHEMA_VERSION,
  fullCourtCommandResultSchema,
} from '@hoop-rush/data-contracts';
import type { CapRushCatalogIndex } from '../cap-rush/catalog.ts';
import { assertCapRushCatalogSourceMatches } from '../cap-rush/catalog.ts';
import type { Rng } from '../../sim/rng.ts';
import { fullCourtStateDigest } from './state-digest.ts';

export interface FullCourtCommandEnvironment {
  readonly index: CapRushCatalogIndex;
  readonly rngFactory?: (seed: string) => Rng;
}

export type FullCourtCommandOutcome = CommandOutcome<FullCourtDraftState, FullCourtCommandResult>;

export function rejectFullCourtCommand(
  state: FullCourtDraftState,
  command: { readonly commandId: string; readonly runId: string },
  code: FullCourtCommandRejectionCode,
  message: string,
): FullCourtCommandOutcome {
  const result = fullCourtCommandResultSchema.parse({
    schemaVersion: FULL_COURT_DRAFT_SCHEMA_VERSION,
    commandId: command.commandId,
    runId: command.runId,
    status: 'rejected',
    revisionBefore: state.revision,
    revisionAfter: state.revision,
    stateDigest: fullCourtStateDigest(state),
    rejection: { code, message },
  });
  return { state, result };
}

export function acceptFullCourtCommand(
  state: FullCourtDraftState,
  command: { readonly commandId: string; readonly runId: string },
  nextState: FullCourtDraftState,
): FullCourtCommandOutcome {
  const result = fullCourtCommandResultSchema.parse({
    schemaVersion: FULL_COURT_DRAFT_SCHEMA_VERSION,
    commandId: command.commandId,
    runId: command.runId,
    status: 'accepted',
    revisionBefore: state.revision,
    revisionAfter: nextState.revision,
    stateDigest: fullCourtStateDigest(nextState),
    rejection: null,
  });
  return { state: nextState, result };
}

export function validateFullCourtRunAndRevision(
  state: FullCourtDraftState,
  command: FullCourtCommand,
  environment: FullCourtCommandEnvironment,
): FullCourtCommandOutcome | null {
  if (command.runId !== state.runId) {
    return rejectFullCourtCommand(
      state,
      command,
      'run-mismatch',
      `command targets run ${command.runId}, active state is ${state.runId}`,
    );
  }
  if (command.command === 'create-full-court-draft') {
    return rejectFullCourtCommand(
      state,
      command,
      'phase-mismatch',
      'a full court draft already exists for this run',
    );
  }
  if (command.expectedRevision !== state.revision) {
    return rejectFullCourtCommand(
      state,
      command,
      'stale-revision',
      `expected revision ${String(command.expectedRevision)}, current revision ${String(state.revision)}`,
    );
  }
  try {
    assertCapRushCatalogSourceMatches(environment.index.catalog.source, state.catalog);
  } catch (error) {
    return rejectFullCourtCommand(
      state,
      command,
      'catalog-mismatch',
      error instanceof Error ? error.message : 'the loaded catalog does not match this draft',
    );
  }
  if (state.pool !== undefined) {
    for (const playerVersionId of state.pool.playerVersionIds) {
      if (!environment.index.byVersionId.has(playerVersionId)) {
        return rejectFullCourtCommand(
          state,
          command,
          'catalog-mismatch',
          `draft pool player ${playerVersionId} is missing from the loaded catalog`,
        );
      }
    }
  }
  return null;
}
