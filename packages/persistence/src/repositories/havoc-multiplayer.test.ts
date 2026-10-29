import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import {
  HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
  HAVOC_MULTIPLAYER_SERIES_WINS,
  defaultHavocMultiplayerVersionLocks,
  havocMultiplayerCommandSchema,
  havocMultiplayerRoomSnapshotSchema,
  havocMultiplayerSeriesSnapshotSchema,
  havocMultiplayerVerificationReceiptSchema,
  seedSchema,
  type HavocMultiplayerCommand,
  type HavocMultiplayerRoomSnapshot,
  type HavocMultiplayerSeriesSnapshot,
  type HavocMultiplayerVerificationReceipt,
} from '@hoop-rush/data-contracts';
import {
  buildHavocGameInput,
  createEngineContext,
  havocBattleGameInputDigest,
  havocBattleGameResultDigest,
  havocBattleGameTapeDigest,
  simulateHavocGame,
  soloToBattleInput,
  soloToBattleResult,
  soloToBattleTape,
} from '@hoop-rush/engine';
import { buildHavocLockedInputs, seedFromString } from '@hoop-rush/test-fixtures';
import {
  havocMultiplayerCompletionRecapSchema,
  havocMultiplayerGameOutputSchema,
  type HavocMultiplayerActiveState,
  type HavocMultiplayerCommandEntry,
  type HavocMultiplayerCompletionRecap,
  type HavocMultiplayerGameOutput,
  type StoredHavocMultiplayerActive,
  type StoredHavocMultiplayerCommandRow,
} from '../schemas/havoc-multiplayer-record.ts';
import { DexieHavocMultiplayerRepository } from './havoc-multiplayer.ts';
import { HOOP_RUSH_DATABASE_STORES, HOOP_RUSH_DATABASE_V9_STORES } from './dexie.ts';
import {
  resetIndexedDb,
  restoreIndexedDb,
  testDatabaseName,
  TestDatabase,
} from '../testing/repo-test-support.ts';

const ROOM_ID = 'hvm-fixture-room';
const ROOM_ID_2 = 'hvm-other-room';
const context = createEngineContext();

function buildSnapshot(roomId: string): HavocMultiplayerRoomSnapshot {
  return havocMultiplayerRoomSnapshotSchema.parse({
    roomId,
    code: '1234',
    phase: 'lobby',
    revision: 0,
    settings: {
      schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
      versions: defaultHavocMultiplayerVersionLocks({
        catalogHash: 'a'.repeat(64),
        profileHash: 'b'.repeat(64),
      }),
    },
    members: [
      { participantId: 'p1', displayName: 'Host', online: true, ready: false, nextGameReady: null },
      {
        participantId: 'p2',
        displayName: 'Guest',
        online: true,
        ready: false,
        nextGameReady: null,
      },
    ],
    draft: null,
    series: null,
    broadcast: null,
    deadline: null,
    successorRoomId: null,
  });
}

function buildActiveState(
  roomId = ROOM_ID,
  overrides: Partial<HavocMultiplayerActiveState> = {},
): HavocMultiplayerActiveState {
  return {
    roomId,
    snapshot: buildSnapshot(roomId),
    verification: [],
    ...overrides,
  };
}

function buildCommandEntry(
  roomId: string,
  ordinal: number,
  commandId = `cmd-${String(ordinal)}`,
  payload: HavocMultiplayerCommand['payload'] = { kind: 'ready' },
): HavocMultiplayerCommandEntry {
  return {
    ordinal,
    command: havocMultiplayerCommandSchema.parse({
      schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
      commandId,
      roomId,
      actorParticipantId: 'p1',
      payload,
    }),
  };
}

function buildGameOutput(roomId: string, gameNumber: number): HavocMultiplayerGameOutput {
  const locked = buildHavocLockedInputs();
  const soloInput = buildHavocGameInput({ locked, gameNumber, variant: 'havoc' });
  const battleInput = soloToBattleInput(soloInput);
  const solo = simulateHavocGame(soloInput, context);
  const inputDigest = havocBattleGameInputDigest(battleInput);
  const result = soloToBattleResult(solo.result, soloInput.humanSide, inputDigest);
  const tape = soloToBattleTape(solo.tape, soloInput.humanSide);
  const homeParticipantId = soloInput.humanSide === 'home' ? 'p1' : 'p2';
  const awayParticipantId = homeParticipantId === 'p1' ? 'p2' : 'p1';
  return havocMultiplayerGameOutputSchema.parse({
    roomId,
    gameNumber,
    winner: result.winner === 'home' ? homeParticipantId : awayParticipantId,
    result,
    tape,
    inputDigest,
    resultDigest: havocBattleGameResultDigest(result),
    tapeDigest: havocBattleGameTapeDigest(tape),
  });
}

function buildSeries(): HavocMultiplayerSeriesSnapshot {
  const digests = {
    inputDigest: 'a'.repeat(32),
    resultDigest: 'b'.repeat(32),
    tapeDigest: 'c'.repeat(32),
  };
  return havocMultiplayerSeriesSnapshotSchema.parse({
    wins: { p1: HAVOC_MULTIPLAYER_SERIES_WINS, p2: 0 },
    games: [1, 2, 3, 4].map((gameNumber) => ({
      gameNumber,
      homeParticipantId: gameNumber <= 2 ? 'p1' : 'p2',
      awayParticipantId: gameNumber <= 2 ? 'p2' : 'p1',
      status: 'verified',
      winner: 'p1',
      ...digests,
    })),
    champion: 'p1',
  });
}

function buildRecap(roomId = ROOM_ID): HavocMultiplayerCompletionRecap {
  const series = buildSeries();
  return havocMultiplayerCompletionRecapSchema.parse({
    roomId,
    champion: 'p1',
    series,
    mvp: { participantId: 'p1', slot: 'PG', index: 12 },
    games: series.games,
  });
}

function buildVerification(resultDigest: string): HavocMultiplayerVerificationReceipt {
  return havocMultiplayerVerificationReceiptSchema.parse({
    receiptId: 'receipt-1',
    challenge: 'a'.repeat(64),
    receiptDigest: 'b'.repeat(64),
    resultDigest,
    commandIds: ['cmd-0'],
    gameSeeds: [seedSchema.parse(seedFromString('hvm-verification-seed'))],
  });
}

function createRepository(name: string): {
  db: TestDatabase;
  repo: DexieHavocMultiplayerRepository;
} {
  resetIndexedDb();
  const db = new TestDatabase(testDatabaseName(name));
  return { db, repo: new DexieHavocMultiplayerRepository(db) };
}

afterEach(restoreIndexedDb);

describe('DexieHavocMultiplayerRepository', () => {
  it('round-trips the active room state', async () => {
    const { db, repo } = createRepository('havoc-multiplayer-active');
    const state = buildActiveState(ROOM_ID, { verification: [buildVerification('b'.repeat(32))] });
    await repo.saveActive(state);
    const loaded = await repo.loadActive(ROOM_ID);
    expect(loaded).not.toBeNull();
    expect(loaded?.saveSchemaVersion).toBe(HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION);
    expect(loaded?.roomId).toBe(ROOM_ID);
    expect(loaded?.snapshot.phase).toBe('lobby');
    expect(loaded?.snapshot.members).toHaveLength(2);
    expect(loaded?.verification).toEqual(state.verification);
    expect(loaded?.updatedAtIso).toBeTruthy();
    await repo.deleteActive(ROOM_ID);
    expect(await repo.loadActive(ROOM_ID)).toBeNull();
    db.close();
  });

  it('appends commands idempotently and rejects conflicting ordinals and duplicate ids', async () => {
    const { db, repo } = createRepository('havoc-multiplayer-commands');
    const first = buildCommandEntry(ROOM_ID, 0);
    const second = buildCommandEntry(ROOM_ID, 1, 'cmd-1', { kind: 'start' });
    await repo.appendCommands(ROOM_ID, [second, first]);
    await repo.appendCommands(ROOM_ID, [first, second]);
    const commands = await repo.loadCommands(ROOM_ID);
    expect(commands.map((command) => command.commandId as string)).toEqual(['cmd-0', 'cmd-1']);
    expect(commands.map((command) => command.payload.kind)).toEqual(['ready', 'start']);
    const rows = await db.havocMultiplayerCommands
      .where('roomId')
      .equals(ROOM_ID)
      .sortBy('ordinal');
    expect(rows.map((row) => row.ordinal)).toEqual([0, 1]);
    const conflictingOrdinal = buildCommandEntry(ROOM_ID, 1, 'cmd-other', { kind: 'leave' });
    await expect(repo.appendCommands(ROOM_ID, [conflictingOrdinal])).rejects.toThrow(
      /conflicting command at ordinal 1/,
    );
    const conflictingDuplicate = buildCommandEntry(ROOM_ID, 2, 'cmd-0', { kind: 'leave' });
    await expect(repo.appendCommands(ROOM_ID, [conflictingDuplicate])).rejects.toThrow(
      /conflicting command cmd-0/,
    );
    expect(await repo.loadCommands(ROOM_ID)).toHaveLength(2);
    await expect(repo.appendCommands(ROOM_ID, [buildCommandEntry(ROOM_ID_2, 2)])).rejects.toThrow(
      /does not belong to room/,
    );
    db.close();
  });

  it('upserts local results by room and game number', async () => {
    const { db, repo } = createRepository('havoc-multiplayer-results');
    const output = buildGameOutput(ROOM_ID, 1);
    await repo.saveResult(output);
    await repo.saveResult(output);
    const rows = await repo.loadResults(ROOM_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.gameNumber).toBe(1);
    expect(rows[0]?.verified).toBe(false);
    expect(rows[0]?.winner).toBe(output.winner);
    expect(rows[0]?.resultDigest).toBe(output.resultDigest);
    expect(rows[0]?.result).toEqual(output.result);
    expect(rows[0]?.tape).toEqual(output.tape);
    db.close();
  });

  it('persists verification receipts and marks matching results verified', async () => {
    const { db, repo } = createRepository('havoc-multiplayer-verification');
    await repo.saveActive(buildActiveState());
    const output = buildGameOutput(ROOM_ID, 1);
    await repo.saveResult(output);
    const receipt = buildVerification(output.resultDigest);
    await repo.saveVerification(ROOM_ID, [receipt]);
    const active = await repo.loadActive(ROOM_ID);
    expect(active?.verification).toEqual([receipt]);
    expect((await repo.loadResults(ROOM_ID))[0]?.verified).toBe(true);
    const mismatch = buildVerification('d'.repeat(32));
    await repo.saveVerification(ROOM_ID, [mismatch]);
    expect((await repo.loadResults(ROOM_ID))[0]?.verified).toBe(false);
    expect((await repo.loadActive(ROOM_ID))?.verification).toEqual([mismatch]);
    db.close();
  });

  it('completes atomically: recap persisted and results kept for the recap screen', async () => {
    const { db, repo } = createRepository('havoc-multiplayer-complete');
    await repo.saveActive(buildActiveState());
    await repo.appendCommands(ROOM_ID, [
      buildCommandEntry(ROOM_ID, 0),
      buildCommandEntry(ROOM_ID, 1),
    ]);
    const output = buildGameOutput(ROOM_ID, 1);
    await repo.saveResult(output);
    await repo.complete(buildRecap());
    expect(await repo.loadActive(ROOM_ID)).toBeNull();
    expect(await repo.loadCommands(ROOM_ID)).toEqual([]);
    const results = await repo.loadResults(ROOM_ID);
    expect(results).toHaveLength(1);
    expect(results[0]?.resultDigest).toBe(output.resultDigest);
    const completed = await repo.loadCompleted(ROOM_ID);
    expect(completed?.champion).toBe('p1');
    expect(completed?.series.champion).toBe('p1');
    expect(completed?.mvp?.slot).toBe('PG');
    expect(completed?.games).toHaveLength(4);
    const history = await repo.listHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.recordId).toBe(`hvm-${ROOM_ID}`);
    expect(history[0]?.roomId).toBe(ROOM_ID);
    expect(history[0]?.championParticipantId).toBe('p1');
    expect(history[0]?.wins).toBe(HAVOC_MULTIPLAYER_SERIES_WINS);
    await repo.deleteCompleted(ROOM_ID);
    expect(await repo.loadCompleted(ROOM_ID)).toBeNull();
    expect(await repo.listHistory()).toEqual([]);
    expect(await repo.loadResults(ROOM_ID)).toEqual([]);
    db.close();
  });

  it('rolls back the completion transaction when a write fails', async () => {
    const { db, repo } = createRepository('havoc-multiplayer-rollback');
    await repo.saveActive(buildActiveState());
    await repo.appendCommands(ROOM_ID, [buildCommandEntry(ROOM_ID, 0)]);
    const spy = vi.spyOn(db.havocMultiplayerHistory, 'put').mockImplementation(() => {
      throw new Error('injected-havoc-multiplayer-write-failure');
    });
    await expect(repo.complete(buildRecap())).rejects.toThrow(
      'injected-havoc-multiplayer-write-failure',
    );
    spy.mockRestore();
    expect(await repo.loadActive(ROOM_ID)).not.toBeNull();
    expect(await repo.loadCommands(ROOM_ID)).toHaveLength(1);
    expect(await repo.loadCompleted(ROOM_ID)).toBeNull();
    expect(await repo.listHistory()).toEqual([]);
    db.close();
  });

  it('keeps two rooms isolated across every store', async () => {
    const { db, repo } = createRepository('havoc-multiplayer-isolation');
    await repo.saveActive(buildActiveState(ROOM_ID));
    await repo.saveActive(buildActiveState(ROOM_ID_2));
    await repo.appendCommands(ROOM_ID, [buildCommandEntry(ROOM_ID, 0)]);
    await repo.appendCommands(ROOM_ID_2, [
      buildCommandEntry(ROOM_ID_2, 0),
      buildCommandEntry(ROOM_ID_2, 1),
    ]);
    await repo.saveResult(buildGameOutput(ROOM_ID, 1));
    await repo.saveResult(buildGameOutput(ROOM_ID_2, 1));
    await repo.saveResult(buildGameOutput(ROOM_ID_2, 2));
    await repo.complete(buildRecap(ROOM_ID));
    expect(await repo.loadActive(ROOM_ID)).toBeNull();
    expect((await repo.loadActive(ROOM_ID_2))?.snapshot.roomId as string).toBe(ROOM_ID_2);
    expect(await repo.loadCommands(ROOM_ID)).toEqual([]);
    expect(await repo.loadCommands(ROOM_ID_2)).toHaveLength(2);
    expect(await repo.loadResults(ROOM_ID)).toHaveLength(1);
    expect(await repo.loadResults(ROOM_ID_2)).toHaveLength(2);
    expect((await repo.listHistory()).map((entry) => entry.roomId)).toEqual([ROOM_ID]);
    expect(await repo.loadCompleted(ROOM_ID_2)).toBeNull();
    db.close();
  });

  it('lists history newest first', async () => {
    const { db, repo } = createRepository('havoc-multiplayer-history');
    await db.havocMultiplayerHistory.bulkPut([
      {
        saveSchemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
        recordId: 'hvm-older-room',
        roomId: 'older-room',
        championParticipantId: 'p1',
        wins: 4,
        completedAtIso: '2026-01-01T00:00:00.000Z',
      },
      {
        saveSchemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
        recordId: 'hvm-newer-room',
        roomId: 'newer-room',
        championParticipantId: 'p2',
        wins: 4,
        completedAtIso: '2026-02-01T00:00:00.000Z',
      },
    ]);
    const history = await repo.listHistory();
    expect(history.map((entry) => entry.recordId)).toEqual(['hvm-newer-room', 'hvm-older-room']);
    db.close();
  });

  it('throws on corrupt stored records', async () => {
    const { db, repo } = createRepository('havoc-multiplayer-corrupt');
    await repo.saveActive(buildActiveState());
    const corruptActive = {
      ...buildActiveState(),
      saveSchemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
      updatedAtIso: '2026-01-01T00:00:00.000Z',
      snapshot: { ...buildSnapshot(ROOM_ID), phase: 'not-a-phase' },
    };
    await db.havocMultiplayerActive.put(corruptActive as unknown as StoredHavocMultiplayerActive);
    await expect(repo.loadActive(ROOM_ID)).rejects.toThrow();
    const corruptRow = {
      saveSchemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
      roomId: ROOM_ID,
      ordinal: 0,
      commandId: 'cmd-0',
      actorParticipantId: 'p3',
      payload: { kind: 'ready' },
      storedAtIso: '2026-01-01T00:00:00.000Z',
    };
    await db.havocMultiplayerCommands.put(
      corruptRow as unknown as StoredHavocMultiplayerCommandRow,
    );
    await expect(repo.loadCommands(ROOM_ID)).rejects.toThrow();
    db.close();
  });

  it('preserves version 1 solo saves when the database upgrades to version 5', async () => {
    resetIndexedDb();
    const name = testDatabaseName('havoc-multiplayer-upgrade');
    const legacy = new Dexie(name);
    legacy.version(1).stores(HOOP_RUSH_DATABASE_STORES);
    await legacy.open();
    expect(legacy.verno).toBe(1);
    const completedRecord = {
      recordId: 'legacy-run',
      saveSchemaVersion: 1,
      run: { runId: 'legacy-run' },
      updatedAtIso: '2026-01-01T00:00:00.000Z',
    };
    const historyRecord = {
      recordId: 'legacy-run',
      runId: 'legacy-run',
      completedAtIso: '2026-01-01T00:00:00.000Z',
    };
    await legacy.table('completed').put(completedRecord);
    await legacy.table('history').put(historyRecord);
    legacy.close();

    const db = new TestDatabase(name);
    const repo = new DexieHavocMultiplayerRepository(db);
    await db.open();
    expect(db.verno).toBe(9);
    const tableNames = db.tables.map((table) => table.name).sort();
    expect(tableNames).toEqual(Object.keys(HOOP_RUSH_DATABASE_V9_STORES).sort());
    expect((await db.completed.get('legacy-run')) as unknown).toEqual(completedRecord);
    expect((await db.history.get('legacy-run')) as unknown).toEqual(historyRecord);
    await repo.saveActive(buildActiveState());
    await repo.appendCommands(ROOM_ID, [buildCommandEntry(ROOM_ID, 0)]);
    expect((await repo.loadActive(ROOM_ID))?.snapshot.roomId as string).toBe(ROOM_ID);
    expect(await repo.loadCommands(ROOM_ID)).toHaveLength(1);
    db.close();
  });
});
