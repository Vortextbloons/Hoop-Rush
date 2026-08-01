import { describe, expect, it } from 'vitest';
import Dexie, { type EntityTable } from 'dexie';
import { buildChallengeRun } from '@hoop-rush/test-fixtures';
import { DexieChallengeRepository } from './dexie.js';
import { InMemoryChallengeRepository } from './memory.js';
import type {
  ChallengeRepository,
  CompletedRunIndex,
  StoredRunRecord,
} from '../schemas/run-record.js';

/**
 * Repository contract tests: both adapters must validate every read, promote
 * active runs atomically, and surface corrupt records instead of silently
 * accepting them. Dexie tests run against fake-indexeddb with one fresh
 * database per test.
 */

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

class TestDatabase extends Dexie {
  active!: EntityTable<StoredRunRecord, 'recordId'>;
  completed!: EntityTable<StoredRunRecord, 'recordId'>;
  history!: EntityTable<CompletedRunIndex, 'recordId'>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ active: 'recordId', completed: 'recordId', history: 'recordId' });
  }
}

const adapters: Array<() => { repo: ChallengeRepository; db?: TestDatabase }> = [
  () => ({ repo: new InMemoryChallengeRepository() }),
  () => {
    const db = new TestDatabase(`test-${Math.random()}`);
    return { repo: new DexieChallengeRepository(db), db };
  },
];

describe.each([
  ['in-memory', adapters[0]!],
  ['dexie', adapters[1]!],
] as const)('challenge repository (%s)', (_name, makeAdapter) => {
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
    if (db) {
      await db.completed.put({ recordId: 'run-c', run: { corrupted: true } } as never);
      await expect(repo.loadCompletedRun('run-c')).rejects.toThrow();
    } else {
      const memory = repo as unknown as {
        completed: Map<string, unknown>;
      };
      memory.completed.set('run-c', {
        recordId: 'run-c',
        saveSchemaVersion: 2,
        run: { corrupted: true },
      });
      await expect(repo.loadCompletedRun('run-c')).rejects.toThrow();
    }
  });
});
