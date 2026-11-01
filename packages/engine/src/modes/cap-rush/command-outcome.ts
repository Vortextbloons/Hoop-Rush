import type {
  CapRushAbandonCommand,
  CapRushCommand,
  CapRushCommandRejectionCode,
  CapRushCommandResult,
  CommandOutcome,
  CapRushDraftState,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_SCHEMA_VERSION,
  capRushCommandResultSchema,
  capRushDraftStateSchema,
} from '@hoop-rush/data-contracts';
import type { Rng } from '../../sim/rng.ts';
import type { CapRushCatalogIndex } from './catalog.ts';
import { assertCapRushCatalogSourceMatches } from './catalog.ts';
import { type CapRushLockSources } from './lock.ts';
import { capRushStateDigest } from './state-digest.ts';
export interface CapRushCommandEnvironment {
  readonly index: CapRushCatalogIndex;
  readonly rngFactory?: (seed: string) => Rng;
  readonly lockSources?: CapRushLockSources;
  readonly nowIso?: () => string;
}

export type CapRushCommandOutcome = CommandOutcome<CapRushDraftState, CapRushCommandResult>;

export function rejectCapRushCommand(
  state: CapRushDraftState,
  command: { readonly commandId: string; readonly runId: string },
  code: CapRushCommandRejectionCode,
  message: string,
): CapRushCommandOutcome {
  const result = capRushCommandResultSchema.parse({
    schemaVersion: CAP_RUSH_SCHEMA_VERSION,
    commandId: command.commandId,
    runId: command.runId,
    status: 'rejected',
    revisionBefore: state.revision,
    revisionAfter: state.revision,
    stateDigest: capRushStateDigest(state),
    rejection: { code, message },
  });
  return { state, result };
}

export function acceptCapRushCommand(
  state: CapRushDraftState,
  command: { readonly commandId: string; readonly runId: string },
  nextState: CapRushDraftState,
): CapRushCommandOutcome {
  const result = capRushCommandResultSchema.parse({
    schemaVersion: CAP_RUSH_SCHEMA_VERSION,
    commandId: command.commandId,
    runId: command.runId,
    status: 'accepted',
    revisionBefore: state.revision,
    revisionAfter: nextState.revision,
    stateDigest: capRushStateDigest(nextState),
    rejection: null,
  });
  return { state: nextState, result };
}

export function validateRunAndRevision(
  state: CapRushDraftState,
  command: CapRushCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome | null {
  if (command.runId !== state.runId) {
    return rejectCapRushCommand(
      state,
      command,
      'run-mismatch',
      `command targets run ${command.runId}, active state is ${state.runId}`,
    );
  }
  if (command.command === 'create-cap-rush-draft') {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'a cap rush draft already exists for this run',
    );
  }
  if (command.expectedRevision !== state.revision) {
    return rejectCapRushCommand(
      state,
      command,
      'stale-revision',
      `expected revision ${String(command.expectedRevision)}, current revision ${String(state.revision)}`,
    );
  }
  assertCapRushCatalogSourceMatches(environment.index.catalog.source, state.catalog);
  return null;
}

export function applyAbandon(
  state: CapRushDraftState,
  command: CapRushAbandonCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.stage === 'abandoned' || state.stage === 'completed') {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      `the run is already ${state.stage}`,
    );
  }
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    stage: 'abandoned',
  });
  return acceptCapRushCommand(state, command, nextState);
}
