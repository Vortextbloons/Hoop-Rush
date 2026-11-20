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
  fullCourtStateDigest,
  type FullCourtCatalogIndex,
} from '@hoop-rush/engine';

export {
  advanceFullCourtSeasonSlot,
  startFullCourtSeason,
  type FullCourtSeasonRepository,
} from './season.ts';
export {
  advanceFullCourtPlayoffs,
  startFullCourtPlayoffs,
  type FullCourtPlayoffRepository,
} from './playoffs.ts';

export interface FullCourtDraftRepository {
  load(runId: string): Promise<FullCourtDraftState | null>;
  getReceipt(command: FullCourtCommand): Promise<FullCourtCommandResult | null>;
  commit(
    command: FullCourtCommand,
    state: FullCourtDraftState,
    result: FullCourtCommandResult,
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
