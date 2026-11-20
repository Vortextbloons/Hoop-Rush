import {
  FULL_COURT_COACHING_SCHEMA_VERSION,
  fullCourtCoachingPlanSchema,
  type FullCourtCoachingPlan,
} from '@hoop-rush/data-contracts';
import {
  fullCourtCoachingRecordSchema,
  type StoredFullCourtCoaching,
} from '../schemas/full-court-coaching-record.ts';
import type { HoopRushDatabase } from './dexie.ts';
import { assertSaveSchemaVersion, getParsedRecord, parseRecord } from './support.ts';

function invalidSave(message: string): Error {
  return new Error(`Invalid Full Court coaching save: ${message}`);
}

export class DexieFullCourtCoachingRepository {
  private readonly db: HoopRushDatabase;

  constructor(db: HoopRushDatabase) {
    this.db = db;
  }

  private parseRecord(row: unknown): StoredFullCourtCoaching {
    assertSaveSchemaVersion(row, FULL_COURT_COACHING_SCHEMA_VERSION, invalidSave);
    return parseRecord(fullCourtCoachingRecordSchema, row, 'coaching plan', invalidSave);
  }

  async load(runId: string): Promise<FullCourtCoachingPlan | null> {
    const record = await getParsedRecord(this.db.fullCourtCoaching, runId, (row) =>
      this.parseRecord(row),
    );
    return record?.plan ?? null;
  }

  async save(runId: string, plan: FullCourtCoachingPlan): Promise<void> {
    const validated = fullCourtCoachingPlanSchema.parse(plan);
    await this.db.fullCourtCoaching.put(
      fullCourtCoachingRecordSchema.parse({
        saveSchemaVersion: FULL_COURT_COACHING_SCHEMA_VERSION,
        runId,
        plan: validated,
      }),
    );
  }
}

export function createFullCourtCoachingRepository(
  db: HoopRushDatabase,
): DexieFullCourtCoachingRepository {
  return new DexieFullCourtCoachingRepository(db);
}
