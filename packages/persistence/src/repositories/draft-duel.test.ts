import { afterEach, describe, expect, it } from 'vitest';
import {
  DRAFT_DUEL_AUTOPICK_VERSION,
  DRAFT_DUEL_TAPE_VERSION,
  contentHashSchema,
  defaultDraftDuelVersionLocks,
  draftDuelCommandSchema,
  draftDuelDraftSchema,
  draftDuelGameOutputSchema,
  draftDuelPartiallyVerifiedSchema,
  playerIdSchema,
  seedSchema,
  type DraftDuelCommand,
  type DraftDuelDraft,
  type DraftDuelGameOutput,
  type DraftDuelPartiallyVerified,
  type DraftDuelSeriesMvp,
  type DraftDuelSeriesSnapshot,
  type DraftDuelStandout,
  type DraftDuelTapeEvent,
  type GameSimulationInput,
} from '@hoop-rush/data-contracts';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildLegalSimulationTeam,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { createEngineContext, simulateRecordedGame } from '@hoop-rush/engine';
import {
  DRAFT_DUEL_SAVE_SCHEMA_VERSION,
  type DraftDuelActiveState,
  type StoredDraftDuelActive,
  type StoredDraftDuelCommandRow,
} from '../schemas/draft-duel-record.ts';
import { DexieDraftDuelRepository } from './draft-duel.ts';
import {
  resetIndexedDb,
  restoreIndexedDb,
  testDatabaseName,
  TestDatabase,
} from '../testing/repo-test-support.ts';

const ROOM_ID = 'dd-fixture-room';
const context = createEngineContext();

function buildActiveState(overrides: Partial<DraftDuelActiveState> = {}): DraftDuelActiveState {
  return {
    roomId: ROOM_ID,
    localParticipantId: 'p1',
    settings: {
      schemaVersion: 1,
      fairness: 'fair',
      presentation: 'ratings',
      timerPolicyVersion: DRAFT_DUEL_AUTOPICK_VERSION,
      versions: defaultDraftDuelVersionLocks({
        catalogHash: contentHashSchema.parse('a'.repeat(64)),
      }),
    },
    rootSeed: seedSchema.parse(seedFromString('dd-root-seed')),
    phase: 'lobby',
    draft: null,
    series: null,
    broadcast: null,
    verification: [],
    ...overrides,
  };
}

function buildCard(index: number): Record<string, unknown> {
  return {
    cardId: `card-${index.toString(16).padStart(32, '0')}`,
    playerId: `p-duel-${String(index).padStart(3, '0')}`,
    playerVersionId: `pv-${(index + 1).toString(16).padStart(32, '0')}`,
    displayName: `Duel Player ${String(index)}`,
    seasonKey: '1990-91',
    franchiseId: 'lakers',
    eraId: '1990s',
    positions: ['PG'],
    overall: 70 + (index % 20),
    bandIndex: index % 10,
  };
}

function buildDraft(): DraftDuelDraft {
  return draftDuelDraftSchema.parse({
    schemaVersion: 1,
    rootSeed: seedFromString('dd-draft-seed'),
    fairness: 'fair',
    firstPicker: 'p1',
    pickOrdinal: 0,
    rounds: Array.from({ length: 5 }, (_, roundIndex) => ({
      round: roundIndex + 1,
      offers: {
        p1: Array.from({ length: 8 }, (_, index) => buildCard(roundIndex * 16 + index)),
        p2: Array.from({ length: 8 }, (_, index) => buildCard(roundIndex * 16 + 8 + index)),
      },
      picks: [],
    })),
    status: 'drafting',
  });
}

function buildSeries(): DraftDuelSeriesSnapshot {
  return {
    homeWinner: 'p1',
    games: [],
    p1Wins: 0,
    p2Wins: 0,
    currentGameNumber: null,
    champion: null,
  };
}

function buildMvp(): DraftDuelSeriesMvp {
  return {
    participantId: 'p1',
    playerId: playerIdSchema.parse('p-duel-000'),
    playerVersionId: 'pv-00000000000000000000000000000001',
    displayName: 'Duel Player 0',
    games: 6,
    points: 160,
    rebounds: 40,
    assists: 32,
    gameScoreSum: 188.5,
  };
}

function buildStandout(): DraftDuelStandout {
  return {
    participantId: 'p1',
    playerId: playerIdSchema.parse('p-duel-001'),
    displayName: 'Duel Player 1',
    gameNumber: 1,
    points: 31,
    rebounds: 9,
    assists: 7,
  };
}

function integerSecondsTape(tape: readonly DraftDuelTapeEvent[]): DraftDuelTapeEvent[] {
  return tape.map((event) =>
    event.kind === 'trip'
      ? {
          ...event,
          clockSeconds: Math.round(event.clockSeconds),
          secondsElapsed: Math.round(event.secondsElapsed),
        }
      : event,
  );
}

function buildGameOutput(gameNumber: number, seed: string): DraftDuelGameOutput {
  const seedValue = seedSchema.parse(seedFromString(seed));
  const input: GameSimulationInput = {
    schemaVersion: 2,
    seed: seedValue,
    gameNumber,
    dataVersion: 'fixture-data-v1',
    profile: DEFAULT_ERA_SIM_PROFILE,
    home: buildLegalSimulationTeam({ teamId: 'p1', displayName: 'P1' }),
    away: buildLegalSimulationTeam({ teamId: 'p2', displayName: 'P2' }),
  };
  const recorded = simulateRecordedGame(input, context);
  return draftDuelGameOutputSchema.parse({
    schemaVersion: DRAFT_DUEL_TAPE_VERSION,
    roomId: ROOM_ID,
    gameNumber,
    homeParticipantId: 'p1',
    awayParticipantId: 'p2',
    seed: seedValue,
    result: recorded.result,
    tape: integerSecondsTape(recorded.tape),
    inputDigest: 'a'.repeat(64),
    resultDigest: 'b'.repeat(64),
    tapeDigest: 'c'.repeat(64),
  });
}

function buildCommand(ordinal: number, commandId = `cmd-${String(ordinal)}`): DraftDuelCommand {
  return draftDuelCommandSchema.parse({
    schemaVersion: 1,
    roomId: ROOM_ID,
    commandId,
    ordinal,
    actorParticipantId: 'p1',
    payload: { kind: 'ready', ready: ordinal % 2 === 0 },
  });
}

function buildVerification(
  gameNumber: number,
  status: DraftDuelPartiallyVerified['status'],
): DraftDuelPartiallyVerified {
  return draftDuelPartiallyVerifiedSchema.parse({
    gameNumber,
    localResultDigest: 'b'.repeat(64),
    peerResultDigest: status === 'pending' ? null : 'b'.repeat(64),
    status,
  });
}

function createRepository(name: string): { db: TestDatabase; repo: DexieDraftDuelRepository } {
  resetIndexedDb();
  const db = new TestDatabase(testDatabaseName(name));
  return { db, repo: new DexieDraftDuelRepository(db) };
}

afterEach(restoreIndexedDb);

describe('DexieDraftDuelRepository', () => {
  it('round-trips the active room state', async () => {
    const { db, repo } = createRepository('draft-duel-active');
    const state = buildActiveState({
      phase: 'drafting',
      rootSeed: seedSchema.parse(seedFromString('dd-active-seed')),
      draft: buildDraft(),
      series: buildSeries(),
    });
    await repo.saveActive(state);
    const loaded = await repo.loadActive(ROOM_ID);
    expect(loaded).not.toBeNull();
    expect(loaded?.saveSchemaVersion).toBe(DRAFT_DUEL_SAVE_SCHEMA_VERSION);
    expect(loaded?.roomId).toBe(ROOM_ID);
    expect(loaded?.localParticipantId).toBe('p1');
    expect(loaded?.phase).toBe('drafting');
    expect(loaded?.draft?.rounds).toHaveLength(5);
    expect(loaded?.draft).toEqual(state.draft);
    expect(loaded?.series).toEqual(state.series);
    expect(loaded?.updatedAtIso).toBeTruthy();
    await repo.deleteActive(ROOM_ID);
    expect(await repo.loadActive(ROOM_ID)).toBeNull();
    db.close();
  });

  it('appends commands idempotently and rejects conflicting ordinals', async () => {
    const { db, repo } = createRepository('draft-duel-commands');
    const first = buildCommand(0);
    const second = buildCommand(1);
    await repo.appendCommands(ROOM_ID, [second, first]);
    await repo.appendCommands(ROOM_ID, [first, second]);
    const commands = await repo.loadCommands(ROOM_ID);
    expect(commands.map((command) => command.ordinal)).toEqual([0, 1]);
    expect(commands.map((command) => command.commandId)).toEqual(['cmd-0', 'cmd-1']);
    const conflicting = buildCommand(1, 'cmd-other');
    await expect(repo.appendCommands(ROOM_ID, [conflicting])).rejects.toThrow(
      /conflicting command at ordinal 1/,
    );
    const afterConflict = await repo.loadCommands(ROOM_ID);
    expect(afterConflict).toHaveLength(2);
    expect(afterConflict[1]?.commandId).toBe('cmd-1');
    await expect(repo.appendCommands('dd-other-room', [buildCommand(2)])).rejects.toThrow(
      /does not belong to room/,
    );
    db.close();
  });

  it('upserts local results by room and game number', async () => {
    const { db, repo } = createRepository('draft-duel-results');
    const output = buildGameOutput(1, 'dd-game-upsert');
    await repo.saveResult(output);
    await repo.saveResult(output);
    const rows = await repo.loadResults(ROOM_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.gameNumber).toBe(1);
    expect(rows[0]?.verified).toBe(false);
    expect(rows[0]?.output.resultDigest).toBe(output.resultDigest);
    expect(rows[0]?.output.tape).toEqual(output.tape);
    db.close();
  });

  it('persists verification entries and marks matching results verified', async () => {
    const { db, repo } = createRepository('draft-duel-verification');
    await repo.saveActive(buildActiveState());
    await repo.saveResult(buildGameOutput(1, 'dd-game-verified'));
    const entry = buildVerification(1, 'verified');
    await repo.saveVerification(ROOM_ID, [entry]);
    const active = await repo.loadActive(ROOM_ID);
    expect(active?.verification).toEqual([entry]);
    const rows = await repo.loadResults(ROOM_ID);
    expect(rows[0]?.verified).toBe(true);
    const mismatch = buildVerification(1, 'mismatch');
    await repo.saveVerification(ROOM_ID, [mismatch]);
    expect((await repo.loadResults(ROOM_ID))[0]?.verified).toBe(false);
    db.close();
  });

  it('completes atomically: recap persisted and results kept for the recap screen', async () => {
    const { db, repo } = createRepository('draft-duel-complete');
    await repo.saveActive(buildActiveState());
    await repo.appendCommands(ROOM_ID, [buildCommand(0), buildCommand(1)]);
    await repo.saveResult(buildGameOutput(1, 'dd-game-complete'));
    await repo.complete({
      roomId: ROOM_ID,
      champion: 'p1',
      series: { ...buildSeries(), p1Wins: 4, champion: 'p1' },
      mvp: buildMvp(),
      standouts: [buildStandout()],
      games: 6,
    });
    expect(await repo.loadActive(ROOM_ID)).toBeNull();
    expect(await repo.loadCommands(ROOM_ID)).toEqual([]);
    const results = await repo.loadResults(ROOM_ID);
    expect(results).toHaveLength(1);
    expect(results[0]?.gameNumber).toBe(1);
    expect(results[0]?.output.resultDigest).toBe('b'.repeat(64));
    const completed = await repo.loadCompleted(ROOM_ID);
    expect(completed?.champion).toBe('p1');
    expect(completed?.games).toBe(6);
    expect(completed?.mvp?.displayName).toBe('Duel Player 0');
    expect(completed?.standouts).toHaveLength(1);
    const history = await repo.listHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.recordId).toBe(`dd-${ROOM_ID}`);
    expect(history[0]?.roomId).toBe(ROOM_ID);
    expect(history[0]?.champion).toBe('p1');
    expect(history[0]?.gameCount).toBe(6);
    await repo.deleteCompleted(ROOM_ID);
    expect(await repo.loadCompleted(ROOM_ID)).toBeNull();
    expect(await repo.listHistory()).toEqual([]);
    expect(await repo.loadResults(ROOM_ID)).toEqual([]);
    db.close();
  });

  it('lists history newest first', async () => {
    const { db, repo } = createRepository('draft-duel-history');
    await db.draftDuelHistory.bulkPut([
      {
        saveSchemaVersion: DRAFT_DUEL_SAVE_SCHEMA_VERSION,
        recordId: 'dd-older-room',
        roomId: 'older-room',
        champion: 'p1',
        gameCount: 5,
        completedAtIso: '2026-01-01T00:00:00.000Z',
      },
      {
        saveSchemaVersion: DRAFT_DUEL_SAVE_SCHEMA_VERSION,
        recordId: 'dd-newer-room',
        roomId: 'newer-room',
        champion: 'p2',
        gameCount: 6,
        completedAtIso: '2026-02-01T00:00:00.000Z',
      },
    ]);
    const history = await repo.listHistory();
    expect(history.map((entry) => entry.recordId)).toEqual(['dd-newer-room', 'dd-older-room']);
    db.close();
  });

  it('throws on corrupt stored records', async () => {
    const { db, repo } = createRepository('draft-duel-corrupt');
    await repo.saveActive(buildActiveState());
    const corruptActive = {
      ...buildActiveState(),
      saveSchemaVersion: DRAFT_DUEL_SAVE_SCHEMA_VERSION,
      updatedAtIso: '2026-01-01T00:00:00.000Z',
      phase: 'not-a-phase',
    };
    await db.draftDuelActive.put(corruptActive as unknown as StoredDraftDuelActive);
    await expect(repo.loadActive(ROOM_ID)).rejects.toThrow();
    const corruptRow = {
      saveSchemaVersion: DRAFT_DUEL_SAVE_SCHEMA_VERSION,
      roomId: ROOM_ID,
      ordinal: 0,
      command: { schemaVersion: 1, roomId: ROOM_ID, commandId: 'cmd-0', ordinal: 0 },
      updatedAtIso: '2026-01-01T00:00:00.000Z',
    };
    await db.draftDuelCommands.put(corruptRow as unknown as StoredDraftDuelCommandRow);
    await expect(repo.loadCommands(ROOM_ID)).rejects.toThrow();
    db.close();
  });
});
