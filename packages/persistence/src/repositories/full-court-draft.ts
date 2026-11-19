import {
  FULL_COURT_DRAFT_SCHEMA_VERSION,
  type FullCourtCommand,
  type FullCourtCommandResult,
  type FullCourtDraftState,
} from '@hoop-rush/data-contracts';
import { fullCourtSalaryDollarsOf, fullCourtStateDigest } from '@hoop-rush/engine';
import {
  fullCourtDraftCommandRecordSchema,
  fullCourtDraftRecordSchema,
  type StoredFullCourtDraft,
} from '../schemas/full-court-draft-record.ts';
import type { HoopRushDatabase } from './dexie.ts';
import {
  assertSaveSchemaVersion,
  commandReceiptMatches,
  getParsedRecord,
  parseRecord,
  revisionMatches,
  type ParseableSchema,
} from './support.ts';

function parseDraftRecord<T>(schema: ParseableSchema<T>, row: unknown): T {
  assertSaveSchemaVersion(row, FULL_COURT_DRAFT_SCHEMA_VERSION, (message) => new Error(message));
  return parseRecord(schema, row, 'Invalid Full Court save', (message) => new Error(message));
}

function validateDraftState(row: StoredFullCourtDraft): StoredFullCourtDraft {
  for (const pick of row.state.picks) {
    if (pick.salaryDollars !== fullCourtSalaryDollarsOf(pick.player)) {
      throw new Error('Invalid Full Court save: roster salary differs from the salary curve');
    }
  }
  if (row.stateDigest !== fullCourtStateDigest(row.state)) {
    throw new Error('Invalid Full Court save: draft digest differs from its state');
  }
  return row;
}

export class DexieFullCourtDraftRepository {
  private readonly db: HoopRushDatabase;

  constructor(db: HoopRushDatabase) {
    this.db = db;
  }

  private getDraftRecord(runId: string): Promise<StoredFullCourtDraft | null> {
    return getParsedRecord(this.db.fullCourtDrafts, runId, (value) =>
      validateDraftState(parseDraftRecord(fullCourtDraftRecordSchema, value)),
    );
  }

  async load(runId: string): Promise<FullCourtDraftState | null> {
    const row = await this.getDraftRecord(runId);
    return row?.state ?? null;
  }

  async getReceipt(command: FullCourtCommand): Promise<FullCourtCommandResult | null> {
    const row = await getParsedRecord(
      this.db.fullCourtDraftCommands,
      [command.runId, command.commandId],
      (value) => parseDraftRecord(fullCourtDraftCommandRecordSchema, value),
    );
    if (row === null) return null;
    if (!commandReceiptMatches(row.command, command)) {
      throw new Error(
        `Full Court command ${command.commandId} was reused with a different payload`,
      );
    }
    return row.result;
  }

  async commit(
    command: FullCourtCommand,
    state: FullCourtDraftState,
    result: FullCourtCommandResult,
  ): Promise<FullCourtCommandResult> {
    const { fullCourtDrafts, fullCourtDraftCommands } = this.db;
    return this.db.transaction('rw', fullCourtDrafts, fullCourtDraftCommands, async () => {
      const receipt = await this.getReceipt(command);
      if (receipt !== null) return receipt;
      const next = validateDraftState(
        fullCourtDraftRecordSchema.parse({
          saveSchemaVersion: FULL_COURT_DRAFT_SCHEMA_VERSION,
          runId: command.runId,
          state,
          stateDigest: result.stateDigest,
        }),
      );
      const row = fullCourtDraftCommandRecordSchema.parse({
        saveSchemaVersion: FULL_COURT_DRAFT_SCHEMA_VERSION,
        runId: command.runId,
        commandId: command.commandId,
        command,
        result,
      });
      if (result.revisionAfter !== next.state.revision) {
        throw new Error('Full Court receipt does not match the committed draft');
      }
      const previous = await this.getDraftRecord(command.runId);
      const revisionMatchesCommand =
        command.command === 'create-full-court-draft' && result.status === 'accepted'
          ? previous === null
          : revisionMatches(previous?.state ?? null, result.revisionBefore);
      if (!revisionMatchesCommand) {
        throw new Error('Full Court draft changed before the command could be saved');
      }
      if (result.status === 'accepted') {
        await fullCourtDrafts.put(next);
      } else if (previous?.stateDigest !== next.stateDigest) {
        throw new Error('Full Court rejection must leave the draft unchanged');
      }
      await fullCourtDraftCommands.add(row);
      return row.result;
    });
  }
}
