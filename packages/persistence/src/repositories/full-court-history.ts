import {
  FULL_COURT_HISTORY_SCHEMA_VERSION,
  fullCourtHistoryRecordSchema,
  type FullCourtHistoryRecord,
} from '@hoop-rush/data-contracts';
import {
  fullCourtHistoryStoredRecordSchema,
  type StoredFullCourtHistory,
} from '../schemas/full-court-history-record.ts';
import type { HoopRushDatabase } from './dexie.ts';
import {
  assertSaveSchemaVersion,
  canonicalEquals,
  getParsedRecord,
  listCompletedHistory,
  parseRecord,
} from './support.ts';

function invalidSave(message: string): Error {
  return new Error(`Invalid Full Court history save: ${message}`);
}

export class DexieFullCourtHistoryRepository {
  private readonly db: HoopRushDatabase;

  constructor(db: HoopRushDatabase) {
    this.db = db;
  }

  private parseRow(row: unknown, expectedRunId?: string): StoredFullCourtHistory {
    assertSaveSchemaVersion(row, FULL_COURT_HISTORY_SCHEMA_VERSION, invalidSave);
    const parsed = parseRecord(fullCourtHistoryStoredRecordSchema, row, 'history', invalidSave);
    if (expectedRunId !== undefined && parsed.runId !== expectedRunId) {
      throw invalidSave('history key mismatch');
    }
    return parsed;
  }

  private getRecord(runId: string): Promise<StoredFullCourtHistory | null> {
    return getParsedRecord(this.db.fullCourtHistory, runId, (row) => this.parseRow(row, runId));
  }

  async load(runId: string): Promise<FullCourtHistoryRecord | null> {
    const row = await this.getRecord(runId);
    return row?.record ?? null;
  }

  async list(limit?: number): Promise<FullCourtHistoryRecord[]> {
    const rows = await listCompletedHistory(this.db.fullCourtHistory, 'completedAtIso', limit);
    return rows.map((row) => this.parseRow(row).record);
  }

  async save(record: FullCourtHistoryRecord): Promise<'saved' | 'existing'> {
    const validated = fullCourtHistoryRecordSchema.parse(record);
    const outcome = await this.db.transaction('rw', this.db.fullCourtHistory, async () => {
      const existing = await this.getRecord(validated.runId);
      if (existing !== null) {
        if (
          canonicalEquals(
            { ...existing.record, completedAtIso: '' },
            { ...validated, completedAtIso: '' },
          )
        ) {
          return 'existing' as const;
        }
        return 'conflict' as const;
      }
      const row = fullCourtHistoryStoredRecordSchema.parse({
        saveSchemaVersion: FULL_COURT_HISTORY_SCHEMA_VERSION,
        runId: validated.runId,
        completedAtIso: validated.completedAtIso,
        record: validated,
      });
      await this.db.fullCourtHistory.put(row);
      return 'saved' as const;
    });
    if (outcome === 'conflict') {
      throw invalidSave(`history for ${validated.runId} was already recorded with different data`);
    }
    return outcome;
  }
}

export function createFullCourtHistoryRepository(
  db: HoopRushDatabase,
): DexieFullCourtHistoryRepository {
  return new DexieFullCourtHistoryRepository(db);
}
