import type { GameResult } from '@hoop-rush/data-contracts';
import {
  activeGameRowSchema,
  activeRunCheckpointSchema,
  checkpointFromRun,
  completedRunIndexSchema,
  runFromCheckpoint,
  storedRunRecordSchema,
  type ActiveGameAppend,
  type ActiveRunCheckpoint,
  type ChallengeRepository,
  type CompletedRunIndex,
  type StoredRunRecord,
} from '../schemas/run-record.js';

/**
 * In-memory challenge repository for tests and non-browser environments. It
 * mirrors the Dexie layout: one active checkpoint plus one game row per
 * accepted game, reconstructed on load. It enforces the same runtime
 * validation on every read as the Dexie implementation, so contract tests run
 * identically against both.
 */

export class InMemoryChallengeRepository implements ChallengeRepository {
  private active: ActiveRunCheckpoint | null = null;
  private activeGames = new Map<number, GameResult>();
  private completed = new Map<string, StoredRunRecord>();
  private history = new Map<string, CompletedRunIndex>();

  async saveActiveRun(record: StoredRunRecord): Promise<void> {
    this.active = checkpointFromRun(record);
    this.activeGames.clear();
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
    if (this.active === null) {
      throw new Error('appendActiveGame: no active run checkpoint to update');
    }
    if (this.active.runId !== row.runId) {
      throw new Error('appendActiveGame: runId does not match the active checkpoint');
    }
    this.activeGames.set(row.gameNumber, row.result);
    this.active = { ...this.active, ...checkpointUpdate, updatedAtIso: new Date().toISOString() };
  }

  async loadActiveRunCheckpoint(): Promise<ActiveRunCheckpoint | null> {
    if (this.active === null) return null;
    if (this.active.gamesPlayed === undefined) {
      return { ...this.active, gamesPlayed: this.activeGames.size };
    }
    return this.active;
  }

  async loadActiveRun(): Promise<StoredRunRecord | null> {
    if (this.active === null) return null;
    const results = [...this.activeGames.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, result]) => result);
    return storedRunRecordSchema.parse({
      recordId: 'active',
      saveSchemaVersion: 2,
      run: runFromCheckpoint(this.active, results),
      updatedAtIso: this.active.updatedAtIso,
    });
  }

  async clearActiveRun(): Promise<void> {
    this.active = null;
    this.activeGames.clear();
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
    this.activeGames.clear();
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
