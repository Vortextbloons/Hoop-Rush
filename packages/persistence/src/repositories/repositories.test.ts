import { afterEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import {
  buildChallengeRun,
  buildClassicCompletedDraft,
  buildClassicDraftState,
  buildClassicPick,
  buildCompletedDraftState,
} from '@hoop-rush/test-fixtures';
import type { GameResult, RunAggregates } from '@hoop-rush/data-contracts';
import { DexieChallengeRepository } from './dexie.ts';
import type { StoredClassicDraft } from '../schemas/classic-draft-record.ts';
import type {
  ActiveGameAppend,
  ChallengeRepository,
  CompletedRunIndex,
  StoredRunRecord,
} from '../schemas/run-record.ts';
import {
  TestDatabase,
  resetIndexedDb,
  restoreIndexedDb,
  testDatabaseName,
} from '../testing/repo-test-support.ts';

/**
 * Repository contract tests: both adapters must validate every read, promote
 * active runs atomically, and surface corrupt records instead of silently
 * accepting them. Dexie tests run against fake-indexeddb with one fresh
 * database per test. The active run is append-only: a checkpoint plus one
 * game row per accepted game, reconstructed in order on load. Classic mode
 * adds a single active draft row that promotion clears atomically.
 */

function draftRecord(
  draft: StoredClassicDraft['draft'] = buildClassicDraftState(),
): StoredClassicDraft {
  return {
    recordId: 'classic-draft',
    saveSchemaVersion: 1,
    draft,
  };
}

function finishedRecord(runId = 'run-1'): StoredRunRecord {
  return {
    recordId: runId,
    saveSchemaVersion: 2,
    run: buildChallengeRun({
      runId,
      status: 'finished',
      outcome: 'perfect',
      firstLossGameNumber: null,
    }),
  };
}

function indexFor(runId = 'run-1'): CompletedRunIndex {
  return {
    recordId: runId,
    runId,
    mode: 'sandbox',
    franchiseId: 'lakers',
    eraId: '1990s',
    playerIds: ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'],
    runSeed: 'abcd1234abcd1234abcd1234abcd1234',
    wins: 82,
    losses: 0,
    gamesPlayed: 82,
    outcome: 'perfect',
    completedAtIso: '2026-07-31T12:00:00.000Z',
  };
}

/** Schema-valid game result for append fixtures; game 1 wins, game 2 loses. */
function buildGameResult(gameNumber: number): GameResult {
  const side = (teamId: string, displayName: string): GameResult['home'] => ({
    teamId,
    displayName,
    box: {
      teamId,
      points: 100,
      fieldGoals: { made: 40, attempted: 84 },
      threes: { made: 10, attempted: 24 },
      freeThrows: { made: 20, attempted: 26 },
      rebounds: { total: 42, offensive: 10, defensive: 28, team: 4 },
      assists: 24,
      steals: 8,
      blocks: 5,
      turnovers: 13,
      fouls: 19,
      possessions: 96,
    },
    players: Array.from({ length: 5 }, (_, i) => ({
      playerId: `p-${String(i + 1)}`,
      minutes: 48,
      points: 20,
      fieldGoals: { made: 8, attempted: 17 },
      threes: { made: 2, attempted: 5 },
      freeThrows: { made: 4, attempted: 5 },
      rebounds: { total: 8, offensive: 2, defensive: 6 },
      assists: 5,
      steals: 2,
      blocks: 1,
      turnovers: 3,
      fouls: 4,
    })),
    shotZones: (['rim', 'shortMid', 'longMid', 'cornerThree', 'aboveBreakThree'] as const).map(
      (zone) => ({
        zone,
        attempts: 17,
        makes: 8,
      }),
    ),
  });
  return {
    schemaVersion: 1,
    gameNumber,
    seed: 'a'.repeat(32),
    engineVersion: 'engine-v1',
    dataVersion: 'data-v1',
    profileVersion: 'profile-v1',
    home: side('user', 'Los Angeles Lakers'),
    away: side('lakers', 'Los Angeles Lakers'),
    periodScores: { home: [25, 25, 25, 25], away: [24, 24, 26, 26] },
    winner: gameNumber % 2 === 1 ? ('home' as const) : ('away' as const),
    overtimePeriods: 0,
    facts: [],
  };
}

/** Zeroed aggregates shaped like the checkpoint requires, with a record. */
function aggregatesFor(gamesPlayed: number, wins: number, losses: number): RunAggregates {
  const zero = () => ({ made: 0, attempted: 0 });
  return {
    team: {
      wins,
      losses,
      gamesPlayed,
      points: 0,
      fieldGoals: zero(),
      threes: zero(),
      freeThrows: zero(),
      rebounds: { total: 0, offensive: 0, defensive: 0, team: 0 },
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      fouls: 0,
      possessions: 0,
    },
    players: Array.from({ length: 5 }, (_, i) => ({
      playerId: `p-${String(i + 1)}`,
      gamesPlayed,
      minutes: 0,
      points: 0,
      fieldGoals: zero(),
      threes: zero(),
      freeThrows: zero(),
      rebounds: { total: 0, offensive: 0, defensive: 0 },
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      fouls: 0,
    })),
  };
}

/** Fresh Dexie-backed repository with one isolated database per test. */
function makeAdapter(): { repo: ChallengeRepository; db: TestDatabase } {
  const db = new TestDatabase(testDatabaseName('repositories'));
  return { repo: new DexieChallengeRepository(db), db };
}

describe('challenge repository (dexie)', () => {
  it('saves and reloads the active run', async () => {
    const { repo } = makeAdapter();
    const record = { ...finishedRecord(), run: buildChallengeRun() };
    await repo.saveActiveRun(record);
    const loaded = await repo.loadActiveRun();
    expect(loaded?.run.runId).toBe('run-1');
    expect(loaded?.run.games).toHaveLength(0);
  });

  it('returns null when no active run exists', async () => {
    const { repo } = makeAdapter();
    expect(await repo.loadActiveRun()).toBeNull();
  });

  it('overwrites the previous active run', async () => {
    const { repo } = makeAdapter();
    await repo.saveActiveRun({ ...finishedRecord(), run: buildChallengeRun({ runId: 'run-a' }) });
    await repo.saveActiveRun({ ...finishedRecord(), run: buildChallengeRun({ runId: 'run-b' }) });
    expect((await repo.loadActiveRun())?.run.runId).toBe('run-b');
  });

  it('rejects saving an active run that already has games', async () => {
    const { repo } = makeAdapter();
    const record = {
      ...finishedRecord(),
      run: buildChallengeRun({ games: [buildGameResult(1)] }),
    };
    await expect(repo.saveActiveRun(record)).rejects.toThrow(/no accepted games/);
    expect(await repo.loadActiveRun()).toBeNull();
  });

  it('appends games and reloads them in order with the latest checkpoint', async () => {
    const { repo } = makeAdapter();
    await repo.saveActiveRun(finishedRecord());
    await repo.appendActiveGame({
      runId: 'run-1',
      gameNumber: 1,
      result: buildGameResult(1),
      aggregates: aggregatesFor(1, 1, 0),
      status: 'active',
      firstLossGameNumber: null,
    });
    await repo.appendActiveGame({
      runId: 'run-1',
      gameNumber: 2,
      result: buildGameResult(2),
      aggregates: aggregatesFor(2, 1, 1),
      status: 'finished',
      firstLossGameNumber: 2,
    });
    const loaded = await repo.loadActiveRun();
    expect(loaded).not.toBeNull();
    expect(loaded?.run.games.map((game) => game.gameNumber)).toEqual([1, 2]);
    expect(loaded?.run.aggregates).toEqual(aggregatesFor(2, 1, 1));
    expect(loaded?.run.status).toBe('finished');
    expect(loaded?.run.firstLossGameNumber).toBe(2);
    expect(loaded?.run.runId).toBe('run-1');
  });

  it('rejects appending without an active checkpoint or with a mismatched runId', async () => {
    const { repo } = makeAdapter();
    const append: ActiveGameAppend = {
      runId: 'run-1',
      gameNumber: 1,
      result: buildGameResult(1),
      aggregates: aggregatesFor(1, 1, 0),
      status: 'active',
      firstLossGameNumber: null,
    };
    await expect(repo.appendActiveGame(append)).rejects.toThrow(/no active run checkpoint/);
    await repo.saveActiveRun(finishedRecord());
    await expect(repo.appendActiveGame({ ...append, runId: 'run-other' })).rejects.toThrow(
      /does not match the active checkpoint/,
    );
  });

  it('clearActiveRun removes the checkpoint and game rows', async () => {
    const { repo, db } = makeAdapter();
    await repo.saveActiveRun(finishedRecord());
    await repo.appendActiveGame({
      runId: 'run-1',
      gameNumber: 1,
      result: buildGameResult(1),
      aggregates: aggregatesFor(1, 1, 0),
      status: 'active',
      firstLossGameNumber: null,
    });
    await repo.clearActiveRun();
    expect(await repo.loadActiveRun()).toBeNull();
    expect(await db.active.count()).toBe(0);
    expect(await db.activeGames.count()).toBe(0);
  });

  it('promotes active to completed and history atomically', async () => {
    const { repo } = makeAdapter();
    await repo.saveActiveRun(finishedRecord('run-x'));
    await repo.promoteActiveToCompleted(finishedRecord('run-x'), indexFor('run-x'));
    expect(await repo.loadActiveRun()).toBeNull();
    expect((await repo.loadCompletedRun('run-x'))?.run.runId).toBe('run-x');
    const history = await repo.listCompletedRuns();
    expect(history).toHaveLength(1);
    expect(history[0]?.outcome).toBe('perfect');
  });

  it('promotes and lists a completed run with its selected franchise', async () => {
    const { repo } = makeAdapter();
    const record = {
      ...finishedRecord('run-free'),
      run: buildChallengeRun({
        runId: 'run-free',
        status: 'finished',
        outcome: 'perfect',
        firstLossGameNumber: null,
        franchiseId: 'thunder',
        eraId: '1980s',
      }),
    };
    await repo.saveActiveRun(record);
    await repo.promoteActiveToCompleted(record, {
      ...indexFor('run-free'),
      franchiseId: 'thunder',
      eraId: '1980s',
    });
    const loaded = await repo.loadCompletedRun('run-free');
    expect(loaded?.run.franchiseId).toBe('thunder');
    expect(loaded?.run.eraId).toBe('1980s');
    const history = await repo.listCompletedRuns();
    expect(history).toHaveLength(1);
    expect(history[0]?.franchiseId).toBe('thunder');
    expect(history[0]?.eraId).toBe('1980s');
  });

  it('promotion removes the checkpoint and game rows', async () => {
    const { repo, db } = makeAdapter();
    await repo.saveActiveRun(finishedRecord('run-x'));
    await repo.appendActiveGame({
      runId: 'run-x',
      gameNumber: 1,
      result: buildGameResult(1),
      aggregates: aggregatesFor(1, 1, 0),
      status: 'active',
      firstLossGameNumber: null,
    });
    await repo.promoteActiveToCompleted(finishedRecord('run-x'), indexFor('run-x'));
    expect(await repo.loadActiveRun()).toBeNull();
    expect((await repo.loadCompletedRun('run-x'))?.run.runId).toBe('run-x');
    expect(await db.active.count()).toBe(0);
    expect(await db.activeGames.count()).toBe(0);
  });

  it('rejects promotion of an unfinished run', async () => {
    const { repo } = makeAdapter();
    const record = { ...finishedRecord('run-y'), run: buildChallengeRun({ runId: 'run-y' }) };
    await repo.saveActiveRun(record);
    await expect(repo.promoteActiveToCompleted(record, indexFor('run-y'))).rejects.toThrow(
      /cannot promote/,
    );
    expect((await repo.loadActiveRun())?.run.runId).toBe('run-y');
  });

  it('lists history newest first', async () => {
    const { repo } = makeAdapter();
    await repo.saveActiveRun(finishedRecord('run-1'));
    await repo.promoteActiveToCompleted(finishedRecord('run-1'), {
      ...indexFor('run-1'),
      completedAtIso: '2026-07-01T00:00:00.000Z',
    });
    await repo.saveActiveRun(finishedRecord('run-2'));
    await repo.promoteActiveToCompleted(finishedRecord('run-2'), {
      ...indexFor('run-2'),
      completedAtIso: '2026-07-02T00:00:00.000Z',
    });
    const history = await repo.listCompletedRuns();
    expect(history.map((h) => h.runId)).toEqual(['run-2', 'run-1']);
  });

  it('loads a missing completed run as null', async () => {
    const { repo } = makeAdapter();
    expect(await repo.loadCompletedRun('missing')).toBeNull();
  });

  it('clears history without touching the active run', async () => {
    const { repo } = makeAdapter();
    await repo.saveActiveRun(finishedRecord('run-a'));
    await repo.promoteActiveToCompleted(finishedRecord('run-a'), indexFor('run-a'));
    await repo.clearHistory();
    expect(await repo.listCompletedRuns()).toHaveLength(0);
    expect(await repo.loadCompletedRun('run-a')).toBeNull();
  });

  it('surfaces corrupt completed records instead of returning them', async () => {
    const { repo, db } = makeAdapter();
    await repo.saveActiveRun(finishedRecord('run-c'));
    await repo.promoteActiveToCompleted(finishedRecord('run-c'), indexFor('run-c'));
    await db.completed.put({ recordId: 'run-c', run: { corrupted: true } } as never);
    await expect(repo.loadCompletedRun('run-c')).rejects.toThrow();
  });

  it('saves and reloads a partial drafting classic draft state', async () => {
    const { repo } = makeAdapter();
    const draft = buildClassicDraftState({
      draftId: 'draft-partial',
      round: 2,
      picks: [buildClassicPick({ round: 1, playerId: 'p-lal-g' })],
      rerolls: { franchiseSpent: true, franchiseRound: 1, eraSpent: false },
    });
    await repo.saveClassicDraft(draftRecord(draft));
    const loaded = await repo.loadClassicDraft();
    expect(loaded?.recordId).toBe('classic-draft');
    expect(loaded?.draft).toEqual(draft);
  });

  it('saves and reloads a completed classic draft state', async () => {
    const { repo } = makeAdapter();
    const draft = buildCompletedDraftState();
    await repo.saveClassicDraft(draftRecord(draft));
    expect((await repo.loadClassicDraft())?.draft).toEqual(draft);
  });

  it('returns null when no classic draft exists', async () => {
    const { repo } = makeAdapter();
    expect(await repo.loadClassicDraft()).toBeNull();
  });

  it('saving a second classic draft replaces the first', async () => {
    const { repo } = makeAdapter();
    await repo.saveClassicDraft(draftRecord(buildClassicDraftState({ draftId: 'draft-a' })));
    await repo.saveClassicDraft(draftRecord(buildClassicDraftState({ draftId: 'draft-b' })));
    expect((await repo.loadClassicDraft())?.draft.draftId).toBe('draft-b');
  });

  it('clears the classic draft without touching the active run', async () => {
    const { repo } = makeAdapter();
    await repo.saveClassicDraft(draftRecord());
    await repo.saveActiveRun(finishedRecord());
    await repo.clearClassicDraft();
    expect(await repo.loadClassicDraft()).toBeNull();
    expect((await repo.loadActiveRun())?.run.runId).toBe('run-1');
  });

  it('surfaces a corrupt classic draft record instead of returning it', async () => {
    const { repo, db } = makeAdapter();
    await repo.saveClassicDraft(draftRecord());
    await db.classicDrafts.put({
      recordId: 'classic-draft',
      saveSchemaVersion: 1,
      draft: { corrupted: true },
    } as never);
    await expect(repo.loadClassicDraft()).rejects.toThrow();
  });

  it('promotes a classic draft into the active run and clears the draft', async () => {
    const { repo } = makeAdapter();
    await repo.saveClassicDraft(draftRecord(buildClassicDraftState({ draftId: 'draft-go' })));
    const record: StoredRunRecord = {
      recordId: 'active',
      saveSchemaVersion: 2,
      run: buildChallengeRun({
        runId: 'run-classic',
        mode: 'classic',
        variant: 'ball-knowledge',
        classicDraft: buildClassicCompletedDraft({ draftId: 'draft-go' }),
      }),
    };
    await repo.promoteClassicDraftToRun(record, 'draft-go');
    expect(await repo.loadClassicDraft()).toBeNull();
    const loaded = await repo.loadActiveRun();
    expect(loaded?.run.runId).toBe('run-classic');
    expect(loaded?.run.variant).toBe('ball-knowledge');
    expect(loaded?.run.classicDraft?.draftId).toBe('draft-go');
  });

  it('rejects promotion on draftId mismatch and leaves state unchanged', async () => {
    const { repo } = makeAdapter();
    await repo.saveClassicDraft(draftRecord(buildClassicDraftState({ draftId: 'draft-current' })));
    await repo.saveActiveRun(finishedRecord('run-kept'));
    const record: StoredRunRecord = {
      recordId: 'active',
      saveSchemaVersion: 2,
      run: buildChallengeRun({ runId: 'run-old', mode: 'classic' }),
    };
    await expect(repo.promoteClassicDraftToRun(record, 'draft-stale')).rejects.toThrow(
      'draftId mismatch',
    );
    expect((await repo.loadClassicDraft())?.draft.draftId).toBe('draft-current');
    expect((await repo.loadActiveRun())?.run.runId).toBe('run-kept');
  });

  it('promotes a finished classic run with variant metadata in history', async () => {
    const { repo } = makeAdapter();
    const record: StoredRunRecord = {
      recordId: 'active',
      saveSchemaVersion: 2,
      run: buildChallengeRun({
        runId: 'run-classic-fin',
        mode: 'classic',
        variant: 'ratings',
        classicDraft: buildClassicCompletedDraft({ draftId: 'draft-fin' }),
        status: 'finished',
        outcome: 'perfect',
        firstLossGameNumber: null,
      }),
    };
    await repo.saveActiveRun(record);
    await repo.promoteActiveToCompleted(record, {
      ...indexFor('run-classic-fin'),
      mode: 'classic',
      variant: 'ratings',
    });
    const history = await repo.listCompletedRuns();
    expect(history[0]?.variant).toBe('ratings');
    const loaded = await repo.loadCompletedRun('run-classic-fin');
    expect(loaded?.run.mode).toBe('classic');
    expect(loaded?.run.classicDraft?.draftId).toBe('draft-fin');
  });
});

describe('dexie active-run migration', () => {
  afterEach(restoreIndexedDb);

  it('splits a legacy v1 full-run row into a checkpoint plus game rows', async () => {
    resetIndexedDb();
    const legacyRecord: StoredRunRecord = {
      recordId: 'active',
      saveSchemaVersion: 2,
      run: buildChallengeRun({
        status: 'active',
        games: [buildGameResult(1), buildGameResult(2)],
        aggregates: aggregatesFor(2, 1, 1),
        firstLossGameNumber: 2,
      }),
    };
    const legacyDb = new Dexie('hoop-rush-saves');
    legacyDb.version(1).stores({ active: 'recordId', completed: 'recordId', history: 'recordId' });
    await legacyDb.open();
    await legacyDb.table('active').put(legacyRecord);
    legacyDb.close();

    const repo = new DexieChallengeRepository();
    const loaded = await repo.loadActiveRun();
    expect(loaded?.run.runId).toBe('run-1');
    expect(loaded?.run.games.map((game) => game.gameNumber)).toEqual([1, 2]);
    expect(loaded?.run.aggregates.team.gamesPlayed).toBe(2);
    expect(loaded?.run.status).toBe('active');
    expect(loaded?.run.firstLossGameNumber).toBe(2);
  });

  it('opens a v3-era save at schema version 4 and keeps the active run intact', async () => {
    resetIndexedDb();
    const run = buildChallengeRun({
      status: 'active',
      games: [buildGameResult(1), buildGameResult(2)],
      aggregates: aggregatesFor(2, 1, 1),
      firstLossGameNumber: 2,
    });
    const legacyDb = new Dexie('hoop-rush-saves');
    legacyDb.version(1).stores({ active: 'recordId', completed: 'recordId', history: 'recordId' });
    legacyDb.version(2).stores({
      active: 'recordId',
      activeGames: '[runId+gameNumber], runId',
      completed: 'recordId',
      history: 'recordId',
    });
    legacyDb.version(3).stores({
      history: 'recordId, completedAtIso',
    });
    await legacyDb.open();
    await legacyDb.table('active').put({
      recordId: 'active',
      saveSchemaVersion: 3,
      runId: run.runId,
      mode: run.mode,
      franchiseId: run.franchiseId,
      eraId: run.eraId,
      homeDisplayName: run.homeDisplayName,
      playerIds: run.playerIds,
      lineup: run.lineup,
      players: run.players,
      runSeed: run.runSeed,
      versions: run.versions,
      eraProfileVersion: run.eraProfileVersion,
      difficulty: run.difficulty,
      bracket: run.bracket,
      status: run.status,
      firstLossGameNumber: run.firstLossGameNumber,
      gamesPlayed: 2,
      aggregates: run.aggregates,
    });
    await legacyDb.table('activeGames').bulkPut(
      run.games.map((result) => ({
        runId: run.runId,
        gameNumber: result.gameNumber,
        result,
        updatedAtIso: '2026-07-31T12:00:00.000Z',
      })),
    );
    legacyDb.close();

    const repo = new DexieChallengeRepository();
    const loaded = await repo.loadActiveRun();
    expect(loaded?.run.runId).toBe('run-1');
    expect(loaded?.run.games.map((game) => game.gameNumber)).toEqual([1, 2]);
    expect(loaded?.run.aggregates.team.gamesPlayed).toBe(2);
    expect(loaded?.run.status).toBe('active');
    await repo.saveClassicDraft(draftRecord(buildClassicDraftState({ draftId: 'draft-v4' })));
    expect((await repo.loadClassicDraft())?.draft.draftId).toBe('draft-v4');
  });
});
