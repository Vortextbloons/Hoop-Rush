import Dexie, { type EntityTable, type Table } from 'dexie';
import {
  activeGameRowSchema,
  activeRunCheckpointSchema,
  checkpointFromRun,
  completedRunIndexSchema,
  runFromCheckpoint,
  storedRunRecordSchema,
  type ActiveGameAppend,
  type ActiveRunCheckpoint,
  type ActiveGameRow,
  type ChallengeRepository,
  type CompletedRunIndex,
  type StoredRunRecord,
} from '../schemas/run-record.js';

/**
 * Concrete IndexedDB challenge repository (spec/04, spec/07 reduced reuse).
 * The active run is append-only: one checkpoint row plus one row per accepted
 * game, so per-game persistence never rewrites the growing run. Completed
 * runs keep the full record plus a compact history index. Reads validate
 * every record through the stored schemas; the active-to-completed promotion
 * is one atomic transaction.
 */

const ACTIVE_RECORD_ID = 'active';

class HoopRushDatabase extends Dexie {
  active!: EntityTable<ActiveRunCheckpoint, 'recordId'>;
  activeGames!: Table<ActiveGameRow, [string, number]>;
  completed!: EntityTable<StoredRunRecord, 'recordId'>;
  history!: EntityTable<CompletedRunIndex, 'recordId'>;

  constructor() {
    super('hoop-rush-saves');
    this.version(1).stores({
      active: 'recordId',
      completed: 'recordId',
      history: 'recordId',
    });
    this.version(2)
      .stores({
        active: 'recordId',
        activeGames: '[runId+gameNumber], runId',
        completed: 'recordId',
        history: 'recordId',
      })
      .upgrade(async (tx) => {
        // Legacy v1 active row: the full run record at recordId 'active'.
        // Split it into the checkpoint plus one game row per accepted game.
        const legacy = await tx.table<StoredRunRecord, string>('active').get(ACTIVE_RECORD_ID);
        if (legacy === undefined) return;
        const validated = storedRunRecordSchema.parse(legacy);
        await tx.table('activeGames').bulkPut(
          validated.run.games.map((result) => ({
            runId: validated.run.runId,
            gameNumber: result.gameNumber,
            result,
            updatedAtIso: validated.updatedAtIso,
          })),
        );
        const { games: _games, schemaVersion: _schemaVersion, ...run } = validated.run;
        await tx.table('active').put({
          recordId: ACTIVE_RECORD_ID,
          saveSchemaVersion: 3,
          ...run,
          updatedAtIso: validated.updatedAtIso,
        });
      });
    this.version(3).stores({
      history: 'recordId, completedAtIso',
    });
  }
}

export class DexieChallengeRepository implements ChallengeRepository {
  private readonly db: HoopRushDatabase;

  constructor(db: HoopRushDatabase = new HoopRushDatabase()) {
    this.db = db;
  }

  async saveActiveRun(record: StoredRunRecord): Promise<void> {
    const checkpoint = checkpointFromRun(record);
    await this.db.transaction('rw', this.db.active, this.db.activeGames, async () => {
      await this.db.activeGames.clear();
      await this.db.active.put(checkpoint);
    });
  }

  async appendActiveGame(input: ActiveGameAppend): Promise<void> {
    const row = activeGameRowSchema.parse({
      runId: input.runId,
      gameNumber: input.gameNumber,
      result: input.result,
    });
    const checkpointUpdate = activeRunCheckpointSchema
      .pick({ status: true, firstLossGameNumber: true, gamesPlayed: true, aggregates: true })
      .parse({ ...input, gamesPlayed: input.gameNumber });
    const updatedAtIso = new Date().toISOString();
    await this.db.transaction('rw', this.db.active, this.db.activeGames, async () => {
      const checkpoint = await this.db.active.get(ACTIVE_RECORD_ID);
      if (checkpoint === undefined) {
        throw new Error('appendActiveGame: no active run checkpoint to update');
      }
      if (checkpoint.runId !== row.runId) {
        throw new Error('appendActiveGame: runId does not match the active checkpoint');
      }
      await this.db.activeGames.put({ ...row, updatedAtIso });
      await this.db.active.put({ ...checkpoint, ...checkpointUpdate, updatedAtIso });
    });
  }

  async loadActiveRun(): Promise<StoredRunRecord | null> {
    const checkpoint = await this.db.active.get(ACTIVE_RECORD_ID);
    if (checkpoint === undefined) return null;
    const validatedCheckpoint = activeRunCheckpointSchema.parse(checkpoint);
    // The [runId+gameNumber] index returns rows ascending per runId.
    const rows = await this.db.activeGames
      .where('runId')
      .equals(validatedCheckpoint.runId)
      .toArray();
    const results = rows.map((row) => activeGameRowSchema.parse(row).result);
    return storedRunRecordSchema.parse({
      recordId: ACTIVE_RECORD_ID,
      saveSchemaVersion: 2,
      run: runFromCheckpoint(validatedCheckpoint, results),
      updatedAtIso: validatedCheckpoint.updatedAtIso,
    });
  }

  async clearActiveRun(): Promise<void> {
    await this.db.transaction('rw', this.db.active, this.db.activeGames, async () => {
      await this.db.active.delete(ACTIVE_RECORD_ID);
      await this.db.activeGames.clear();
    });
  }

  async loadActiveRunCheckpoint(): Promise<ActiveRunCheckpoint | null> {
    const checkpoint = await this.db.active.get(ACTIVE_RECORD_ID);
    if (checkpoint === undefined) return null;
    const validated = activeRunCheckpointSchema.parse(checkpoint);
    if (validated.gamesPlayed === undefined) {
      const gamesPlayed = await this.db.activeGames.where('runId').equals(validated.runId).count();
      return { ...validated, gamesPlayed };
    }
    return validated;
  }

  async promoteActiveToCompleted(
    completed: StoredRunRecord,
    index: CompletedRunIndex,
  ): Promise<void> {
    const validatedRun = storedRunRecordSchema.parse(completed);
    const validatedIndex = completedRunIndexSchema.parse(index);
    if (validatedRun.run.runId !== validatedIndex.runId) {
      throw new Error('promotion runId mismatch');
    }
    if (validatedRun.run.status !== 'finished') {
      throw new Error(`cannot promote a run in status ${validatedRun.run.status}`);
    }
    await this.db.transaction(
      'rw',
      this.db.active,
      this.db.activeGames,
      this.db.completed,
      this.db.history,
      async () => {
        await this.db.active.delete(ACTIVE_RECORD_ID);
        await this.db.activeGames.clear();
        await this.db.completed.put({ ...validatedRun, recordId: validatedIndex.runId });
        await this.db.history.put({ ...validatedIndex, recordId: validatedIndex.runId });
      },
    );
  }

  async listCompletedRuns(): Promise<CompletedRunIndex[]> {
    const rows = await this.db.history.orderBy('completedAtIso').reverse().toArray();
    return rows.map((row) => completedRunIndexSchema.parse(row));
  }

  async loadCompletedRun(runId: string): Promise<StoredRunRecord | null> {
    const record = await this.db.completed.get(runId);
    if (record === undefined) return null;
    return storedRunRecordSchema.parse(record);
  }

  async clearHistory(): Promise<void> {
    await this.db.transaction('rw', this.db.completed, this.db.history, async () => {
      await this.db.completed.clear();
      await this.db.history.clear();
    });
  }
}
