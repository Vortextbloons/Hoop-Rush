import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  assertSaveSchemaVersion,
  commandReceiptMatches,
  deleteScopedRows,
  hasSaveSchemaVersion,
  listCompletedHistory,
  parseRecord,
  revisionMatches,
  saveSchemaVersionOf,
  scopedNumericRows,
  scopedRows,
  stateMatches,
} from './support.ts';
import {
  resetIndexedDb,
  restoreIndexedDb,
  testDatabaseName,
  TestDatabase,
} from '../testing/repo-test-support.ts';

afterEach(restoreIndexedDb);

const rowSchema = z.object({ id: z.string(), value: z.number() });

interface OwnershipProbe {
  collectionId: string;
  cardId: string;
}

interface PullProbe {
  collectionId: string;
  pullSequence: number;
}

interface HistoryRow {
  recordId: string;
  completedAtIso: string;
}

describe('repository support helpers', () => {
  it('parses records and reports diagnostics through the caller error factory', () => {
    expect(
      parseRecord(rowSchema, { id: 'a', value: 1 }, 'row', (message) => new Error(message)),
    ).toEqual({ id: 'a', value: 1 });
    expect(() =>
      parseRecord(rowSchema, { id: 'a' }, 'row', (message) => new Error(message)),
    ).toThrow(/^row: /);
  });

  it('reads and asserts save schema versions', () => {
    expect(saveSchemaVersionOf({ saveSchemaVersion: 3 })).toBe(3);
    expect(saveSchemaVersionOf({})).toBeNull();
    expect(saveSchemaVersionOf(null)).toBeNull();
    expect(saveSchemaVersionOf({ saveSchemaVersion: '3' })).toBeNull();
    expect(hasSaveSchemaVersion({ saveSchemaVersion: 3 }, 3)).toBe(true);
    expect(hasSaveSchemaVersion({ saveSchemaVersion: 2 }, 3)).toBe(false);
    expect(() => {
      assertSaveSchemaVersion({ saveSchemaVersion: 2 }, 3, (message) => new Error(message));
    }).toThrow('stored save schema 2 does not match current 3');
    expect(() => {
      assertSaveSchemaVersion({}, 3, (message) => new Error(message));
    }).toThrow('stored save schema unknown does not match current 3');
  });

  it('scans and deletes compound-index scope rows', async () => {
    resetIndexedDb();
    const db = new TestDatabase(testDatabaseName('support-scope'));
    const ownershipProbe = db.table<OwnershipProbe>('collectionOwnership');
    const pullProbe = db.table<PullProbe>('collectionPulls');
    await ownershipProbe.bulkPut([
      { collectionId: 'c1', cardId: 'a' },
      { collectionId: 'c1', cardId: 'b' },
      { collectionId: 'c2', cardId: 'a' },
    ]);
    await pullProbe.bulkPut([
      { collectionId: 'c1', pullSequence: 1 },
      { collectionId: 'c1', pullSequence: 2 },
      { collectionId: 'c2', pullSequence: 1 },
    ]);

    const stringRows = await scopedRows(db.collectionOwnership, '[collectionId+cardId]', 'c1');
    expect(stringRows.map((row) => row.cardId).sort()).toEqual(['a', 'b']);
    const numericRows = await scopedNumericRows(
      db.collectionPulls,
      '[collectionId+pullSequence]',
      'c1',
    );
    expect(numericRows.map((row) => row.pullSequence)).toEqual([1, 2]);

    const deleted = await deleteScopedRows(db.collectionOwnership, '[collectionId+cardId]', 'c1');
    expect(deleted).toBe(2);
    expect(await db.collectionOwnership.count()).toBe(1);
  });

  it('compares command receipts canonically', () => {
    expect(commandReceiptMatches({ b: 1, a: [2] }, { a: [2], b: 1 })).toBe(true);
    expect(commandReceiptMatches({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('matches revisions and digests', () => {
    expect(stateMatches({ revision: 4, digest: 'abc' }, { revision: 4, digest: 'abc' })).toBe(true);
    expect(stateMatches({ revision: 4, digest: 'abc' }, { revision: 5, digest: 'abc' })).toBe(
      false,
    );
    expect(stateMatches({ revision: 4, digest: 'abc' }, { revision: 4, digest: 'def' })).toBe(
      false,
    );
    expect(stateMatches(null, { revision: 4, digest: 'abc' })).toBe(false);
    expect(revisionMatches({ revision: 4 }, 4)).toBe(true);
    expect(revisionMatches({ revision: 4 }, 5)).toBe(false);
    expect(revisionMatches(null, 4)).toBe(false);
  });

  it('lists completed history newest first', async () => {
    resetIndexedDb();
    const db = new TestDatabase(testDatabaseName('support-history'));
    const historyTable = db.table<HistoryRow>('history');
    await historyTable.bulkPut([
      { recordId: 'old', completedAtIso: '2026-01-01T00:00:00.000Z' },
      { recordId: 'new', completedAtIso: '2026-02-01T00:00:00.000Z' },
    ]);
    const listed = await listCompletedHistory(historyTable);
    expect(listed.map((row) => row.recordId)).toEqual(['new', 'old']);
  });
});
