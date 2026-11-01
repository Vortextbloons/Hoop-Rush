import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'bun:test';
import { HOOP_RUSH_DATABASE_NAME, HOOP_RUSH_DATABASE_STORES, HoopRushDatabase } from './dexie.ts';
import {
  resetIndexedDb,
  restoreIndexedDb,
  testDatabaseName,
} from '../testing/repo-test-support.ts';

const LEGACY_DATABASE_NAME = 'hoop-rush-saves';

afterEach(restoreIndexedDb);

describe('storage namespace', () => {
  it('opens the new namespace at version 14 with every store', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('namespace-new'));
    await db.open();
    expect(HOOP_RUSH_DATABASE_NAME).toBe('hoop-rush-saves-v2');
    expect(db.name).not.toBe(LEGACY_DATABASE_NAME);
    expect(db.verno).toBe(14);
    const tableNames = db.tables.map((table) => table.name).sort();
    expect(tableNames).toEqual(Object.keys(HOOP_RUSH_DATABASE_STORES).sort());
    db.close();
  });

  it('reopens current saves without resetting records', async () => {
    resetIndexedDb();
    const name = testDatabaseName('current-reopen');
    const db = new HoopRushDatabase(name);
    await db.open();
    await db.table('profileSelection').put({ id: 'selection', profileId: 'current' });
    db.close();
    const reopened = new HoopRushDatabase(name);
    await reopened.open();
    expect(await reopened.table('profileSelection').get('selection')).toEqual({
      id: 'selection',
      profileId: 'current',
    });
    reopened.close();
  });

  it('resets every older database version and can save multiplayer checkpoints afterward', async () => {
    for (let version = 1; version < 14; version++) {
      resetIndexedDb();
      const name = testDatabaseName(`unsupported-${String(version)}`);
      const old = new Dexie(name);
      old.version(version).stores({ completed: 'recordId', profileSelection: 'id' });
      await old.table('completed').put({ recordId: 'old-save' });
      await old.table('profileSelection').put({ id: 'selection', profileId: 'old-profile' });
      old.close();
      const current = new HoopRushDatabase(name);
      await current.open();
      expect(current.verno).toBe(14);
      for (const table of current.tables) expect(await table.count()).toBe(0);
      await current.table('capRushMultiplayerActive').put({ roomId: 'new-room' });
      current.close();
      const reopened = new HoopRushDatabase(name);
      await reopened.open();
      expect(await reopened.table('completed').count()).toBe(0);
      expect(await reopened.table('capRushMultiplayerActive').get('new-room')).toEqual({
        roomId: 'new-room',
      });
      reopened.close();
    }
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
