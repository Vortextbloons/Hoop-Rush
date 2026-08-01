import {
  completedRunIndexSchema,
  storedRunRecordSchema,
  type ChallengeRepository,
  type CompletedRunIndex,
  type StoredRunRecord,
} from '../schemas/run-record.js';

/**
 * In-memory challenge repository for tests and non-browser environments. It
 * enforces the same runtime validation on every read as the Dexie
 * implementation, so contract tests run identically against both.
 */

export class InMemoryChallengeRepository implements ChallengeRepository {
  private active: StoredRunRecord | null = null;
  private completed = new Map<string, StoredRunRecord>();
  private history = new Map<string, CompletedRunIndex>();

  async saveActiveRun(record: StoredRunRecord): Promise<void> {
    this.active = storedRunRecordSchema.parse(record);
  }

  async loadActiveRun(): Promise<StoredRunRecord | null> {
    return this.active === null ? null : storedRunRecordSchema.parse(this.active);
  }

  async clearActiveRun(): Promise<void> {
    this.active = null;
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
    this.active = null;
    this.completed.set(validatedIndex.runId, validatedRun);
    this.history.set(validatedIndex.runId, validatedIndex);
  }

  async listCompletedRuns(): Promise<CompletedRunIndex[]> {
    const rows = [...this.history.values()].map((row) => completedRunIndexSchema.parse(row));
    return rows.sort((a, b) => b.completedAtIso.localeCompare(a.completedAtIso));
  }

  async loadCompletedRun(runId: string): Promise<StoredRunRecord | null> {
    const record = this.completed.get(runId);
    if (!record) return null;
    return storedRunRecordSchema.parse(record);
  }

  async clearHistory(): Promise<void> {
    this.completed.clear();
    this.history.clear();
  }
}
