import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'bun:test';
import {
  HOOP_RUSH_DATABASE_NAME,
  HOOP_RUSH_DATABASE_V11_STORES,
  HoopRushDatabase,
} from './dexie.ts';
import {
  resetIndexedDb,
  restoreIndexedDb,
  testDatabaseName,
} from '../testing/repo-test-support.ts';

const LEGACY_DATABASE_NAME = 'hoop-rush-saves';

afterEach(restoreIndexedDb);

describe('storage namespace', () => {
  it('opens the new namespace at version 12 with every store', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('namespace-new'));
    await db.open();
    expect(HOOP_RUSH_DATABASE_NAME).toBe('hoop-rush-saves-v2');
    expect(db.name).not.toBe(LEGACY_DATABASE_NAME);
    expect(db.verno).toBe(12);
    const tableNames = db.tables.map((table) => table.name).sort();
    expect(tableNames).toEqual(Object.keys(HOOP_RUSH_DATABASE_V11_STORES).sort());
    db.close();
  });

  it('leaves the legacy database untouched and unread', async () => {
    resetIndexedDb();
    const legacy = new Dexie(LEGACY_DATABASE_NAME);
    legacy.version(21).stores({
      completed: 'recordId',
      history: 'recordId, completedAtIso',
    });
    await legacy.open();
    await legacy.table('completed').put({
      recordId: 'legacy-run',
      saveSchemaVersion: 1,
      run: { runId: 'legacy-run' },
      updatedAtIso: '2026-01-01T00:00:00.000Z',
    });
    await legacy.table('history').put({
      recordId: 'legacy-run',
      runId: 'legacy-run',
      completedAtIso: '2026-01-01T00:00:00.000Z',
    });
    legacy.close();

    const db = new HoopRushDatabase(testDatabaseName('namespace-isolation'));
    await db.open();
    expect(await db.completed.count()).toBe(0);
    expect(await db.history.count()).toBe(0);
    db.close();

    const reopened = new Dexie(LEGACY_DATABASE_NAME);
    reopened.version(21).stores({
      completed: 'recordId',
      history: 'recordId, completedAtIso',
    });
    await reopened.open();
    expect(await reopened.table('completed').count()).toBe(1);
    expect(await reopened.table('history').count()).toBe(1);
    reopened.close();
  });
});
