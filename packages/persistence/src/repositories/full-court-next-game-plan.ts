import {
  FULL_COURT_NEXT_GAME_PLAN_SCHEMA_VERSION,
  fullCourtNextGamePlanSchema,
  idSchema,
  type FullCourtNextGamePlan,
} from '@hoop-rush/data-contracts';
import {
  fullCourtNextGamePlanRecordSchema,
  type StoredFullCourtNextGamePlan,
} from '../schemas/full-court-next-game-plan-record.ts';
import type { HoopRushDatabase } from './dexie.ts';
import { assertSaveSchemaVersion, getParsedRecord, parseRecord } from './support.ts';

function invalidSave(message: string): Error {
  return new Error(`Invalid Full Court next-game plan save: ${message}`);
}

export class DexieFullCourtNextGamePlanRepository {
  private readonly db: HoopRushDatabase;

  constructor(db: HoopRushDatabase) {
    this.db = db;
  }

  private parseRecord(row: unknown, expectedRunId?: string): StoredFullCourtNextGamePlan {
    assertSaveSchemaVersion(row, FULL_COURT_NEXT_GAME_PLAN_SCHEMA_VERSION, invalidSave);
    const parsed = parseRecord(
      fullCourtNextGamePlanRecordSchema,
      row,
      'next-game plan',
      invalidSave,
    );
    if (expectedRunId !== undefined && parsed.runId !== expectedRunId) {
      throw invalidSave('next-game plan key mismatch');
    }
    return parsed;
  }

  async load(runId: string): Promise<FullCourtNextGamePlan | null> {
    const record = await getParsedRecord(this.db.fullCourtNextGamePlans, runId, (row) =>
      this.parseRecord(row, runId),
    );
    return record?.plan ?? null;
  }

  async save(runId: string, plan: FullCourtNextGamePlan): Promise<void> {
    const validated = fullCourtNextGamePlanSchema.parse(plan);
    await this.db.fullCourtNextGamePlans.put(
      fullCourtNextGamePlanRecordSchema.parse({
        saveSchemaVersion: FULL_COURT_NEXT_GAME_PLAN_SCHEMA_VERSION,
        runId,
        plan: validated,
      }),
    );
  }

  /**
   * Clears the run's plan. When `gameId` is supplied the stored fixture must
   * still match it at delete time, so a stale game's cleanup cannot remove a
   * newer fixture's plan saved by another tab.
   */
  async clear(runId: string, gameId?: string): Promise<void> {
    const key = idSchema.parse(runId);
    if (gameId === undefined) {
      await this.db.fullCourtNextGamePlans.delete(key);
      return;
    }
    await this.db.transaction('rw', this.db.fullCourtNextGamePlans, async () => {
      const row = await this.db.fullCourtNextGamePlans.get(key);
      if (row === undefined) return;
      const stored = this.parseRecord(row, runId);
      if (stored.plan.gameId !== gameId) return;
      await this.db.fullCourtNextGamePlans.delete(key);
    });
  }
}

export function createFullCourtNextGamePlanRepository(
  db: HoopRushDatabase,
): DexieFullCourtNextGamePlanRepository {
  return new DexieFullCourtNextGamePlanRepository(db);
}
