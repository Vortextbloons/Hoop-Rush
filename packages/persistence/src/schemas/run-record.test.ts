import { describe, expect, it } from 'vitest';
import { buildChallengeRun } from '@hoop-rush/test-fixtures';
import { storedRunRecordSchema } from './run-record.js';

describe('storedRunRecordSchema', () => {
  it('round-trips an accepted challenge run', () => {
    const record = {
      recordId: 'record-1',
      saveSchemaVersion: 1,
      run: buildChallengeRun(),
      updatedAtIso: '2026-07-31T12:00:00.000Z',
    };
    const parsed = storedRunRecordSchema.parse(record);
    expect(parsed.run.runId).toBe('run-1');
    expect(parsed.saveSchemaVersion).toBe(1);
  });

  it('accepts a record without adapter timestamps', () => {
    const record = {
      recordId: 'record-2',
      saveSchemaVersion: 1,
      run: buildChallengeRun({ runId: 'run-2' }),
    };
    expect(storedRunRecordSchema.safeParse(record).success).toBe(true);
  });

  it('rejects an invalid run inside the record', () => {
    const run = buildChallengeRun();
    const record = {
      recordId: 'record-3',
      saveSchemaVersion: 1,
      run: { ...run, runSeed: 'not-hex' },
    };
    expect(storedRunRecordSchema.safeParse(record).success).toBe(false);
  });

  it('rejects a run with the wrong player count', () => {
    const run = buildChallengeRun({ playerIds: ['p-1', 'p-2'] });
    const record = {
      recordId: 'record-4',
      saveSchemaVersion: 1,
      run,
    };
    expect(storedRunRecordSchema.safeParse(record).success).toBe(false);
  });
});
