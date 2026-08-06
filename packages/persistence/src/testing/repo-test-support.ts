import Dexie, { type EntityTable, type Table } from 'dexie';
import { IDBFactory } from 'fake-indexeddb';
import type { StoredClassicDraft } from '../schemas/classic-draft-record.ts';
import type { StoredSeasonDraft } from '../schemas/season-draft-record.ts';
import type {
  StoredSeasonAcceptedBlockRow,
  StoredSeasonActiveRunIndex,
  StoredSeasonDetailRow,
  StoredSeasonPendingBlockRow,
  StoredSeasonRunRecord,
  StoredSeasonSummaryRow,
} from '../schemas/season-run-record.ts';
import type {
  ActiveGameRow,
  ActiveRunCheckpoint,
  CompletedRunIndex,
  StoredRunRecord,
} from '../schemas/run-record.ts';

/**
 * Shared repository test support: the 7-version Dexie store chain, the
 * fake-indexeddb factory swap, and deterministic database names. Every
 * repository contract suite runs against fake-indexeddb with one fresh
 * database per test; migration suites additionally swap in a fresh factory
 * to isolate Dexie versioning, and `restoreIndexedDb` (wired to `afterEach`)
 * puts the original factory back so the last migration test does not leak
 * its fresh factory into the worker process.
 */

export class TestDatabase extends Dexie {
  active!: EntityTable<ActiveRunCheckpoint, 'recordId'>;
  activeGames!: Table<ActiveGameRow, [string, number]>;
  completed!: EntityTable<StoredRunRecord, 'recordId'>;
  history!: EntityTable<CompletedRunIndex, 'recordId'>;
  classicDrafts!: EntityTable<StoredClassicDraft, 'recordId'>;
  seasonDrafts!: EntityTable<StoredSeasonDraft, 'recordId'>;
  seasonRuns!: EntityTable<StoredSeasonRunRecord, 'recordId'>;
  seasonRunSummaries!: Table<StoredSeasonSummaryRow, [string, string]>;
  seasonRunDetails!: Table<StoredSeasonDetailRow, [string, string]>;
  seasonRunBlocks!: Table<StoredSeasonAcceptedBlockRow, [string, number]>;
  seasonRunIndex!: EntityTable<StoredSeasonActiveRunIndex, 'recordId'>;
  seasonPendingBlocks!: EntityTable<StoredSeasonPendingBlockRow, 'runId'>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ active: 'recordId', completed: 'recordId', history: 'recordId' });
    this.version(2).stores({
      active: 'recordId',
      activeGames: '[runId+gameNumber], runId',
      completed: 'recordId',
      history: 'recordId',
    });
    this.version(3).stores({ history: 'recordId, completedAtIso' });
    this.version(4).stores({ classicDrafts: 'recordId' });
    this.version(5).stores({ seasonDrafts: 'recordId' });
    this.version(6).stores({
      seasonRuns: 'recordId',
      seasonRunSummaries: '[runId+gameId], runId, blockIndex',
      seasonRunDetails: '[runId+gameId], runId',
      seasonRunBlocks: '[runId+blockIndex], runId',
      seasonRunIndex: 'recordId',
    });
    this.version(7).stores({ seasonPendingBlocks: 'runId' });
  }
}

let previousFactory: IDBFactory | null = null;

/**
 * Replaces the shared fake-indexeddb factory, isolating Dexie versioning.
 * The first swap in a file remembers the original factory so
 * `restoreIndexedDb` can put it back after the migration tests finish.
 */
export function resetIndexedDb(): void {
  if (previousFactory === null) {
    previousFactory = globalThis.indexedDB;
  }
  const factory = new IDBFactory();
  globalThis.indexedDB = factory;
  Dexie.dependencies.indexedDB = factory;
}

/** Restores the factory captured by the first `resetIndexedDb` call. */
export function restoreIndexedDb(): void {
  if (previousFactory !== null) {
    globalThis.indexedDB = previousFactory;
    Dexie.dependencies.indexedDB = previousFactory;
    previousFactory = null;
  }
}

let databaseNameCounter = 0;

/**
 * Deterministic per-test database names derived from the calling file's
 * prefix plus a per-file counter (replaces Math.random-based names). The
 * prefix keeps names unique across files and the counter keeps them unique
 * within a file, so runs are reproducible with no collision risk.
 */
export function testDatabaseName(filePrefix: string): string {
  databaseNameCounter += 1;
  return `test-${filePrefix}-${String(databaseNameCounter)}`;
}
