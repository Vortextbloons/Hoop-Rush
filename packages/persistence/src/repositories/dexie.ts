import Dexie, { type EntityTable } from 'dexie';
import {
  completedRunIndexSchema,
  storedRunRecordSchema,
  type ChallengeRepository,
  type CompletedRunIndex,
  type StoredRunRecord,
} from '../schemas/run-record.js';

/**
 * Concrete IndexedDB challenge repository (spec/04, spec/07 reduced reuse).
 * One active run, full completed records, and a compact history index. Reads
 * validate every record through the stored schemas; the active-to-completed
 * promotion is one atomic transaction.
 */

const ACTIVE_RECORD_ID = 'active';

class HoopRushDatabase extends Dexie {
  active!: EntityTable<StoredRunRecord, 'recordId'>;
  completed!: EntityTable<StoredRunRecord, 'recordId'>;
  history!: EntityTable<CompletedRunIndex, 'recordId'>;

  constructor() {
    super('hoop-rush-saves');
    this.version(1).stores({
      active: 'recordId',
      completed: 'recordId',
      history: 'recordId',
    });
  }
}

export class DexieChallengeRepository implements ChallengeRepository {
  private readonly db: HoopRushDatabase;

  constructor(db: HoopRushDatabase = new HoopRushDatabase()) {
    this.db = db;
  }

  async saveActiveRun(record: StoredRunRecord): Promise<void> {
    const validated = storedRunRecordSchema.parse(record);
    await this.db.active.put({ ...validated, recordId: ACTIVE_RECORD_ID });
  }

  async loadActiveRun(): Promise<StoredRunRecord | null> {
    const record = await this.db.active.get(ACTIVE_RECORD_ID);
    if (record === undefined) return null;
    return storedRunRecordSchema.parse(record);
  }

  async clearActiveRun(): Promise<void> {
    await this.db.active.delete(ACTIVE_RECORD_ID);
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
      this.db.completed,
      this.db.history,
      async () => {
        await this.db.active.delete(ACTIVE_RECORD_ID);
        await this.db.completed.put({ ...validatedRun, recordId: validatedIndex.runId });
        await this.db.history.put({ ...validatedIndex, recordId: validatedIndex.runId });
      },
    );
  }

  async listCompletedRuns(): Promise<CompletedRunIndex[]> {
    const rows = await this.db.history.toArray();
    const validated = rows.map((row) => completedRunIndexSchema.parse(row));
    return validated.sort((a, b) => b.completedAtIso.localeCompare(a.completedAtIso));
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
