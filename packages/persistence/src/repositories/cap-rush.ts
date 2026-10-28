import type {
  CapRushCommand,
  CapRushCommandResult,
  CapRushDraftState,
  CommandId,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_SAVE_SCHEMA_VERSION,
  capRushCommandResultSchema,
  capRushCommandSchema,
} from '@hoop-rush/data-contracts';
import { capRushStateDigest } from '@hoop-rush/engine';
import {
  CAP_RUSH_ACTIVE_DRAFT_RECORD_ID,
  storedCapRushCommandRowSchema,
  storedCapRushDraftRowSchema,
} from '../schemas/cap-rush-record.ts';
import { HoopRushDatabase } from './dexie.ts';
import { assertSaveSchemaVersion, commandReceiptMatches, parseRecord } from './support.ts';

export interface CapRushApplyOutcomeInput {
  readonly outcome: {
    readonly state: CapRushDraftState;
    readonly result: CapRushCommandResult;
  };
  readonly command: CapRushCommand;
}

export interface CapRushRepository {
  loadActiveDraft(): Promise<CapRushDraftState | null>;
  loadCommandResult(commandId: string): Promise<CapRushCommandResult | null>;
  applyOutcome(input: CapRushApplyOutcomeInput): Promise<CapRushCommandResult>;
  clearActiveDraft(): Promise<void>;
}

export class CapRushLoadError extends Error {
  readonly code: 'unsupported' | 'malformed';
  readonly diagnostics: readonly string[];
  constructor(code: 'unsupported' | 'malformed', diagnostics: readonly string[]) {
    super(`cap rush draft could not be loaded: ${diagnostics.join('; ')}`);
    this.name = 'CapRushLoadError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

export class CapRushCommandConflictError extends Error {
  readonly commandId: string;
  constructor(commandId: string) {
    super(`cap rush command ${commandId} was reused with a different payload`);
    this.name = 'CapRushCommandConflictError';
    this.commandId = commandId;
  }
}

export class CapRushStaleRevisionError extends Error {
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;
  constructor(commandId: string, expectedRevision: number, actualRevision: number) {
    super(
      `cap rush command ${commandId} expected revision ${String(expectedRevision)} but the stored draft is at ${String(actualRevision)}`,
    );
    this.name = 'CapRushStaleRevisionError';
    this.commandId = commandId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class CapRushActiveDraftExistsError extends Error {
  readonly activeRunId: string;
  readonly requestedRunId: string;
  constructor(activeRunId: string, requestedRunId: string) {
    super(`cap rush run ${requestedRunId} cannot start while ${activeRunId} is active`);
    this.name = 'CapRushActiveDraftExistsError';
    this.activeRunId = activeRunId;
    this.requestedRunId = requestedRunId;
  }
}

function malformed(message: string): CapRushLoadError {
  return new CapRushLoadError('malformed', [message]);
}

function unsupported(message: string): CapRushLoadError {
  return new CapRushLoadError('unsupported', [message]);
}

export class DexieCapRushRepository implements CapRushRepository {
  private readonly db: HoopRushDatabase;
  constructor(db: HoopRushDatabase) {
    this.db = db;
  }

  async loadActiveDraft(): Promise<CapRushDraftState | null> {
    const row: unknown = await this.db.capRushActive.get(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID);
    if (row === undefined) return null;
    assertSaveSchemaVersion(row, CAP_RUSH_SAVE_SCHEMA_VERSION, unsupported);
    const parsed = parseRecord(
      storedCapRushDraftRowSchema,
      row,
      'active cap rush draft',
      malformed,
    );
    if (capRushStateDigest(parsed.draft) !== parsed.stateDigest) {
      throw malformed('active cap rush draft digest does not match its state');
    }
    return parsed.draft;
  }

  async loadCommandResult(commandId: string): Promise<CapRushCommandResult | null> {
    const row: unknown = await this.db.capRushCommands.get(commandId as CommandId);
    if (row === undefined) return null;
    assertSaveSchemaVersion(row, CAP_RUSH_SAVE_SCHEMA_VERSION, unsupported);
    return parseRecord(
      storedCapRushCommandRowSchema,
      row,
      `cap rush command ${commandId}`,
      malformed,
    ).result;
  }

  async applyOutcome(input: CapRushApplyOutcomeInput): Promise<CapRushCommandResult> {
    const result = capRushCommandResultSchema.parse(input.outcome.result);
    const command = capRushCommandSchema.parse(input.command);
    const state = input.outcome.state;
    if (command.commandId !== result.commandId || command.runId !== result.runId) {
      throw malformed('cap rush command envelope does not match the outcome receipt');
    }
    if (state.runId !== result.runId) {
      throw malformed('cap rush outcome state belongs to another run');
    }
    if (capRushStateDigest(state) !== result.stateDigest) {
      throw malformed('cap rush outcome state digest does not match the receipt');
    }
    const accepted = result.status === 'accepted';
    if (accepted) {
      if (result.revisionAfter <= result.revisionBefore) {
        throw malformed('accepted cap rush commands must advance the draft revision');
      }
      if (state.revision !== result.revisionAfter) {
        throw malformed('accepted cap rush state revision does not match the receipt');
      }
    } else if (
      result.revisionAfter !== result.revisionBefore ||
      state.revision !== result.revisionBefore
    ) {
      throw malformed('rejected cap rush commands must not change the draft revision');
    }

    return this.db.transaction('rw', [this.db.capRushActive, this.db.capRushCommands], async () => {
      const existingCommandRow: unknown = await this.db.capRushCommands.get(result.commandId);
      if (existingCommandRow !== undefined) {
        assertSaveSchemaVersion(existingCommandRow, CAP_RUSH_SAVE_SCHEMA_VERSION, unsupported);
        const existing = parseRecord(
          storedCapRushCommandRowSchema,
          existingCommandRow,
          `cap rush command ${result.commandId}`,
          malformed,
        );
        if (
          commandReceiptMatches(command, existing.command) &&
          existing.result.status === result.status
        ) {
          return existing.result;
        }
        throw new CapRushCommandConflictError(result.commandId);
      }

      const now = new Date().toISOString();
      const activeRow: unknown = await this.db.capRushActive.get(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID);
      let createdAtIso = now;
      if (activeRow !== undefined) {
        assertSaveSchemaVersion(activeRow, CAP_RUSH_SAVE_SCHEMA_VERSION, unsupported);
        const active = parseRecord(
          storedCapRushDraftRowSchema,
          activeRow,
          'active cap rush draft',
          malformed,
        );
        if (active.draft.revision !== result.revisionBefore) {
          throw new CapRushStaleRevisionError(
            result.commandId,
            result.revisionBefore,
            active.draft.revision,
          );
        }
        if (active.runId !== result.runId) {
          throw new CapRushActiveDraftExistsError(active.runId, result.runId);
        }
        createdAtIso = active.createdAtIso;
      }

      if (accepted) {
        if (activeRow === undefined && result.revisionBefore !== 0) {
          throw new CapRushStaleRevisionError(result.commandId, result.revisionBefore, 0);
        }
        await this.db.capRushActive.put(
          storedCapRushDraftRowSchema.parse({
            saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
            recordId: CAP_RUSH_ACTIVE_DRAFT_RECORD_ID,
            runId: state.runId,
            revision: state.revision,
            stateDigest: capRushStateDigest(state),
            draft: state,
            createdAtIso,
            updatedAtIso: now,
          }),
        );
      }

      await this.db.capRushCommands.put(
        storedCapRushCommandRowSchema.parse({
          saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
          commandId: result.commandId,
          runId: result.runId,
          command,
          result,
          updatedAtIso: now,
        }),
      );
      return result;
    });
  }

  async clearActiveDraft(): Promise<void> {
    await this.db.transaction('rw', [this.db.capRushActive, this.db.capRushCommands], async () => {
      const row: unknown = await this.db.capRushActive.get(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID);
      await this.db.capRushActive.delete(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID);
      if (row === undefined) return;
      const runId =
        typeof row === 'object' && row !== null && 'runId' in row
          ? (row as { runId?: unknown }).runId
          : undefined;
      if (typeof runId === 'string') {
        await this.db.capRushCommands.where('runId').equals(runId).delete();
      }
    });
  }
}
