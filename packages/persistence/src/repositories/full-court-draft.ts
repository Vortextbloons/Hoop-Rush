import {
  FULL_COURT_DRAFT_SCHEMA_VERSION,
  FULL_COURT_PLAYOFFS_VERSION,
  FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
  type FullCourtCommand,
  type FullCourtCommandResult,
  type FullCourtDraftState,
  type Id,
} from '@hoop-rush/data-contracts';
import {
  assertFullCourtSpinReceiptDigests,
  fullCourtSalaryDollarsOf,
  fullCourtStateDigest,
  type FullCourtPurchasePhase,
} from '@hoop-rush/engine';
import {
  fullCourtDraftCommandRecordSchema,
  fullCourtDraftRecordSchema,
  type StoredFullCourtDraft,
} from '../schemas/full-court-draft-record.ts';
import {
  fullCourtPlayoffRecordSchema,
  type StoredFullCourtPlayoffs,
} from '../schemas/full-court-playoff-record.ts';
import {
  fullCourtSeasonCheckpointRecordSchema,
  type StoredFullCourtSeasonCheckpoint,
} from '../schemas/full-court-season-record.ts';
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
  assertFullCourtSpinReceiptDigests(row.state);
  return row;
}

function parseSeasonCheckpointRecord(row: unknown): StoredFullCourtSeasonCheckpoint {
  const invalid = (message: string) => new Error(`Invalid Full Court season save: ${message}`);
  assertSaveSchemaVersion(row, FULL_COURT_SEASON_SAVE_SCHEMA_VERSION, invalid);
  return parseRecord(fullCourtSeasonCheckpointRecordSchema, row, 'checkpoint', invalid);
}

function parsePlayoffRecord(row: unknown): StoredFullCourtPlayoffs {
  const invalid = (message: string) => new Error(`Invalid Full Court playoff save: ${message}`);
  assertSaveSchemaVersion(row, FULL_COURT_PLAYOFFS_VERSION, invalid);
  return parseRecord(fullCourtPlayoffRecordSchema, row, 'checkpoint', invalid);
}

/**
 * Optional durable checks the repository runs inside its own write transaction,
 * so a purchase cannot slip past a phase change committed by another tab.
 */
export interface FullCourtDraftCommitOptions {
  /**
   * Re-checks a purchase against the durable phase. Returning a rejection keeps
   * the draft, War Chest, and command log untouched.
   */
  readonly guard?: (phase: FullCourtPurchasePhase) => FullCourtCommandResult | null;
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

  /**
   * Reads the durable season phase inside the purchase transaction. The season
   * checkpoint, its score rows, and the playoff checkpoint are locked by that
   * transaction, so a concurrent opener commit is either fully visible here or
   * waits until the purchase commits.
   */
  private async purchasePhase(runId: Id): Promise<FullCourtPurchasePhase> {
    const [checkpointRow, playoffRow, scoreKeys] = await Promise.all([
      this.db.fullCourtSeasonCheckpoints.get(runId),
      this.db.fullCourtPlayoffs.get(runId),
      this.db.fullCourtSeasonScores.where('runId').equals(runId).primaryKeys(),
    ]);
    const checkpoint =
      checkpointRow === undefined ? null : parseSeasonCheckpointRecord(checkpointRow);
    const playoffs = playoffRow === undefined ? null : parsePlayoffRecord(playoffRow);
    const playedGameIds = new Set(scoreKeys.map(([, gameId]) => gameId));
    for (const game of playoffs?.checkpoint.games ?? []) playedGameIds.add(game.gameId);
    return {
      completedThroughSlot: checkpoint?.checkpoint.completedThroughSlot ?? null,
      postseasonStarted: playoffs !== null,
      playedGameIds,
    };
  }

  async commit(
    command: FullCourtCommand,
    state: FullCourtDraftState,
    result: FullCourtCommandResult,
    options?: FullCourtDraftCommitOptions,
  ): Promise<FullCourtCommandResult> {
    const { fullCourtDrafts, fullCourtDraftCommands } = this.db;
    const guard = options?.guard;
    return this.db.transaction(
      'rw',
      guard === undefined
        ? [fullCourtDrafts, fullCourtDraftCommands]
        : [
            fullCourtDrafts,
            fullCourtDraftCommands,
            this.db.fullCourtSeasonCheckpoints,
            this.db.fullCourtSeasonScores,
            this.db.fullCourtPlayoffs,
          ],
      async () => {
        const receipt = await this.getReceipt(command);
        if (receipt !== null) return receipt;
        if (guard !== undefined && result.status === 'accepted') {
          const blocked = guard(await this.purchasePhase(command.runId));
          if (blocked !== null) return blocked;
        }
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
      },
    );
  }
}
