import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'bun:test';
import {
  HOOP_RUSH_DATABASE_NAME,
  HOOP_RUSH_DATABASE_STORES,
  HOOP_RUSH_DATABASE_STORES_V15,
  HOOP_RUSH_DATABASE_STORES_V16,
  HOOP_RUSH_DATABASE_STORES_V17,
  HOOP_RUSH_DATABASE_STORES_V18,
  HOOP_RUSH_DATABASE_STORES_V19,
  HOOP_RUSH_DATABASE_STORES_V20,
  HOOP_RUSH_DATABASE_STORES_V21,
  HOOP_RUSH_DATABASE_STORES_V22,
  HOOP_RUSH_DATABASE_STORES_V23,
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
  it('opens the new namespace at version 24 with every store', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('namespace-new'));
    await db.open();
    expect(HOOP_RUSH_DATABASE_NAME).toBe('hoop-rush-saves-v2');
    expect(db.name).not.toBe(LEGACY_DATABASE_NAME);
    expect(db.verno).toBe(24);
    const tableNames = db.tables.map((table) => table.name).sort();
    expect(tableNames).toEqual(Object.keys(HOOP_RUSH_DATABASE_STORES).sort());
    db.close();
  });

  it('upgrades a version-15 database without clearing its records', async () => {
    resetIndexedDb();
    const name = testDatabaseName('v15-upgrade');
    const old = new Dexie(name);
    old.version(15).stores(HOOP_RUSH_DATABASE_STORES_V15);
    await old.open();
    await old.table('profileSelection').put({ id: 'selection', profileId: 'v15-profile' });
    await old.table('capRushActive').put({ recordId: 'cap-rush-draft', saveSchemaVersion: 3 });
    old.close();

    const current = new HoopRushDatabase(name);
    await current.open();
    expect(current.verno).toBe(24);
    expect(await current.table('profileSelection').get('selection')).toEqual({
      id: 'selection',
      profileId: 'v15-profile',
    });
    expect(await current.table('capRushActive').get('cap-rush-draft')).toEqual({
      recordId: 'cap-rush-draft',
      saveSchemaVersion: 3,
    });
    expect(await current.capRushLockedInputs.count()).toBe(0);
    expect(await current.capRushLeagueResults.count()).toBe(0);
    expect(await current.fullCourtSeasonCheckpoints.count()).toBe(0);
    expect(await current.fullCourtSeasonScores.count()).toBe(0);
    expect(await current.fullCourtCoaching.count()).toBe(0);
    expect(await current.fullCourtBlueprints.count()).toBe(0);
    expect(await current.fullCourtHistory.count()).toBe(0);
    expect(await current.fullCourtWatchedReplays.count()).toBe(0);
    current.close();
  });

  it('adds Full Court draft and season storage without clearing version-16 saves', async () => {
    resetIndexedDb();
    const name = testDatabaseName('v16-upgrade');
    const old = new Dexie(name);
    old.version(16).stores(HOOP_RUSH_DATABASE_STORES_V16);
    await old.open();
    await old.table('capRushLockedInputs').put({ runId: 'saved-run', digest: 'saved' });
    old.close();

    const current = new HoopRushDatabase(name);
    await current.open();
    expect(current.verno).toBe(24);
    expect(await current.table('capRushLockedInputs').get('saved-run')).toEqual({
      runId: 'saved-run',
      digest: 'saved',
    });
    expect(await current.fullCourtDrafts.count()).toBe(0);
    expect(await current.fullCourtDraftCommands.count()).toBe(0);
    expect(await current.fullCourtSeasonCheckpoints.count()).toBe(0);
    expect(await current.fullCourtSeasonScores.count()).toBe(0);
    current.close();
  });

  it('upgrades a version-17 database and keeps its Full Court draft', async () => {
    resetIndexedDb();
    const name = testDatabaseName('v17-upgrade');
    const old = new Dexie(name);
    old.version(17).stores(HOOP_RUSH_DATABASE_STORES_V17);
    await old.open();
    await old.table('fullCourtDrafts').put({
      saveSchemaVersion: 1,
      runId: 'saved-draft',
      state: { runId: 'saved-draft' },
      stateDigest: 'saved',
    });
    await old.table('fullCourtDraftCommands').put({
      saveSchemaVersion: 1,
      runId: 'saved-draft',
      commandId: 'create',
    });
    old.close();

    const current = new HoopRushDatabase(name);
    await current.open();
    expect(current.verno).toBe(24);
    expect(await current.table('fullCourtDrafts').get('saved-draft')).toEqual({
      saveSchemaVersion: 1,
      runId: 'saved-draft',
      state: { runId: 'saved-draft' },
      stateDigest: 'saved',
    });
    expect(await current.table('fullCourtDraftCommands').get(['saved-draft', 'create'])).toEqual({
      saveSchemaVersion: 1,
      runId: 'saved-draft',
      commandId: 'create',
    });
    expect(await current.fullCourtSeasonCheckpoints.count()).toBe(0);
    expect(await current.fullCourtSeasonScores.count()).toBe(0);
    current.close();
  });

  it('upgrades version 18 and keeps the regular-season checkpoint', async () => {
    resetIndexedDb();
    const name = testDatabaseName('v18-upgrade');
    const old = new Dexie(name);
    old.version(18).stores(HOOP_RUSH_DATABASE_STORES_V18);
    const checkpoint = { runId: 'saved-season', saveSchemaVersion: 1 };
    await old.table('fullCourtSeasonCheckpoints').put(checkpoint);
    old.close();

    const current = new HoopRushDatabase(name);
    await current.open();
    expect(current.verno).toBe(24);
    expect(await current.table('fullCourtSeasonCheckpoints').get('saved-season')).toEqual(
      checkpoint,
    );
    expect(await current.fullCourtPlayoffs.count()).toBe(0);
    expect(await current.fullCourtCoaching.count()).toBe(0);
    expect(await current.fullCourtBlueprints.count()).toBe(0);
    expect(await current.fullCourtHistory.count()).toBe(0);
    expect(await current.fullCourtWatchedReplays.count()).toBe(0);
    current.close();
  });

  it('upgrades version 19 and keeps the playoff checkpoint', async () => {
    resetIndexedDb();
    const name = testDatabaseName('v19-upgrade');
    const old = new Dexie(name);
    old.version(19).stores(HOOP_RUSH_DATABASE_STORES_V19);
    const checkpoint = { runId: 'saved-playoffs', saveSchemaVersion: 1 };
    await old.table('fullCourtPlayoffs').put(checkpoint);
    old.close();

    const current = new HoopRushDatabase(name);
    await current.open();
    expect(current.verno).toBe(24);
    expect(await current.table('fullCourtPlayoffs').get('saved-playoffs')).toEqual(checkpoint);
    expect(await current.fullCourtCoaching.count()).toBe(0);
    expect(await current.fullCourtBlueprints.count()).toBe(0);
    expect(await current.fullCourtHistory.count()).toBe(0);
    expect(await current.fullCourtWatchedReplays.count()).toBe(0);
    current.close();
  });

  it('upgrades version 20 and keeps the coaching plan', async () => {
    resetIndexedDb();
    const name = testDatabaseName('v20-upgrade');
    const old = new Dexie(name);
    old.version(20).stores(HOOP_RUSH_DATABASE_STORES_V20);
    const coaching = {
      runId: 'saved-coaching',
      saveSchemaVersion: 1,
      plan: {
        schemaVersion: 1,
        tactics: { pace: 'fast', offense: 'perimeter', defense: 'pressure' },
      },
    };
    await old.table('fullCourtCoaching').put(coaching);
    old.close();

    const current = new HoopRushDatabase(name);
    await current.open();
    expect(current.verno).toBe(24);
    expect(await current.table('fullCourtCoaching').get('saved-coaching')).toEqual(coaching);
    expect(await current.fullCourtBlueprints.count()).toBe(0);
    expect(await current.fullCourtHistory.count()).toBe(0);
    expect(await current.fullCourtWatchedReplays.count()).toBe(0);
    current.close();
  });

  it('upgrades version 21 and keeps saved tactics blueprints', async () => {
    resetIndexedDb();
    const name = testDatabaseName('v21-upgrade');
    const old = new Dexie(name);
    old.version(21).stores(HOOP_RUSH_DATABASE_STORES_V21);
    const blueprint = {
      saveSchemaVersion: 1,
      key: 'fast break',
      blueprint: {
        schemaVersion: 1,
        name: 'Fast Break',
        tactics: { pace: 'fast', offense: 'perimeter', defense: 'pressure' },
      },
    };
    await old.table('fullCourtBlueprints').put(blueprint);
    old.close();

    const current = new HoopRushDatabase(name);
    await current.open();
    expect(current.verno).toBe(24);
    expect(await current.table('fullCourtBlueprints').get('fast break')).toEqual(blueprint);
    expect(await current.fullCourtHistory.count()).toBe(0);
    expect(await current.fullCourtWatchedReplays.count()).toBe(0);
    current.close();
  });

  it('upgrades version 22 and keeps Full Court history and blueprints', async () => {
    resetIndexedDb();
    const name = testDatabaseName('v22-upgrade');
    const old = new Dexie(name);
    old.version(22).stores(HOOP_RUSH_DATABASE_STORES_V22);
    const historyRow = {
      saveSchemaVersion: 1,
      runId: 'saved-history',
      completedAtIso: '2026-10-01T00:00:00.000Z',
      record: { runId: 'saved-history' },
    };
    const blueprintRow = {
      saveSchemaVersion: 1,
      key: 'motion',
      blueprint: { schemaVersion: 1, name: 'Motion' },
    };
    await old.table('fullCourtHistory').put(historyRow);
    await old.table('fullCourtBlueprints').put(blueprintRow);
    old.close();

    const current = new HoopRushDatabase(name);
    await current.open();
    expect(current.verno).toBe(24);
    expect(await current.table('fullCourtHistory').get('saved-history')).toEqual(historyRow);
    expect(await current.table('fullCourtBlueprints').get('motion')).toEqual(blueprintRow);
    expect(await current.fullCourtWatchedReplays.count()).toBe(0);
    expect(await current.fullCourtNextGamePlans.count()).toBe(0);
    current.close();
  });

  it('upgrades version 23 and keeps the watched replay while adding next-game plans', async () => {
    resetIndexedDb();
    const name = testDatabaseName('v23-upgrade');
    const old = new Dexie(name);
    old.version(23).stores(HOOP_RUSH_DATABASE_STORES_V23);
    const replayRow = {
      saveSchemaVersion: 1,
      runId: 'saved-replay',
      replay: { identity: { runId: 'saved-replay', gameId: 'crl-01-bos-nyk' } },
    };
    await old.table('fullCourtWatchedReplays').put(replayRow);
    old.close();

    const current = new HoopRushDatabase(name);
    await current.open();
    expect(current.verno).toBe(24);
    expect(await current.table('fullCourtWatchedReplays').get('saved-replay')).toEqual(replayRow);
    expect(await current.fullCourtNextGamePlans.count()).toBe(0);
    current.close();
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
    for (let version = 1; version < 15; version++) {
      resetIndexedDb();
      const name = testDatabaseName(`unsupported-${String(version)}`);
      const old = new Dexie(name);
      old.version(version).stores({ completed: 'recordId', profileSelection: 'id' });
      await old.table('completed').put({ recordId: 'old-save' });
      await old.table('profileSelection').put({ id: 'selection', profileId: 'old-profile' });
      old.close();
      const current = new HoopRushDatabase(name);
      await current.open();
      expect(current.verno).toBe(24);
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
