import {
  FULL_COURT_WATCHED_REPLAY_SCHEMA_VERSION,
  fullCourtWatchedReplaySchema,
  type FullCourtWatchedReplay,
} from '@hoop-rush/data-contracts';
import type { EntityTable } from 'dexie';
import {
  fullCourtWatchedReplayRecordSchema,
  type StoredFullCourtWatchedReplay,
} from '../schemas/full-court-replay-record.ts';
import type { HoopRushDatabase } from './dexie.ts';
import {
  assertSaveSchemaVersion,
  canonicalEquals,
  getParsedRecord,
  parseRecord,
} from './support.ts';

function invalidSave(message: string): Error {
  return new Error(`Invalid Full Court watched replay save: ${message}`);
}

export function parseWatchedReplayRecord(
  row: unknown,
  expectedRunId?: string,
): StoredFullCourtWatchedReplay {
  assertSaveSchemaVersion(row, FULL_COURT_WATCHED_REPLAY_SCHEMA_VERSION, invalidSave);
  const parsed = parseRecord(
    fullCourtWatchedReplayRecordSchema,
    row,
    'watched replay',
    invalidSave,
  );
  if (expectedRunId !== undefined && parsed.runId !== expectedRunId) {
    throw invalidSave('watched replay key mismatch');
  }
  return parsed;
}

export async function verifyWatchedReplayRetry(
  table: EntityTable<StoredFullCourtWatchedReplay, 'runId'>,
  replay: FullCourtWatchedReplay,
): Promise<string | null> {
  const existing = await getParsedRecord(table, replay.identity.runId, (row) =>
    parseWatchedReplayRecord(row, replay.identity.runId),
  );
  if (existing === null || existing.replay.identity.gameId !== replay.identity.gameId) {
    return `Full Court game ${replay.identity.gameId} was already committed without matching watched replay`;
  }
  if (!canonicalEquals(existing.replay, replay)) {
    return `Full Court watched replay for ${replay.identity.gameId} conflicts with stored replay`;
  }
  return null;
}

export async function putWatchedReplayRecord(
  table: EntityTable<StoredFullCourtWatchedReplay, 'runId'>,
  replay: FullCourtWatchedReplay,
): Promise<void> {
  const validated = fullCourtWatchedReplaySchema.parse(replay);
  await table.put(
    fullCourtWatchedReplayRecordSchema.parse({
      saveSchemaVersion: FULL_COURT_WATCHED_REPLAY_SCHEMA_VERSION,
      runId: validated.identity.runId,
      replay: validated,
      updatedAtIso: new Date().toISOString(),
    }),
  );
}

export class DexieFullCourtWatchedReplayRepository {
  private readonly db: HoopRushDatabase;

  constructor(db: HoopRushDatabase) {
    this.db = db;
  }

  async load(runId: string): Promise<FullCourtWatchedReplay | null> {
    const row = await getParsedRecord(this.db.fullCourtWatchedReplays, runId, (record) =>
      parseWatchedReplayRecord(record, runId),
    );
    return row?.replay ?? null;
  }
}

export function createFullCourtWatchedReplayRepository(
  db: HoopRushDatabase,
): DexieFullCourtWatchedReplayRepository {
  return new DexieFullCourtWatchedReplayRepository(db);
}
