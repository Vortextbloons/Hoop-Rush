import { describe, expect, it } from 'vitest';
import { buildChallengeRun } from '@hoop-rush/test-fixtures';
import { completedRunIndexSchema, storedRunRecordSchema } from './run-record.js';

const selections = ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'].map((playerId) => ({
  playerId,
  franchiseId: 'lakers',
  eraId: '1990s',
}));

describe('storedRunRecordSchema', () => {
  it('round-trips an accepted challenge run', () => {
    const record = {
      recordId: 'record-1',
      saveSchemaVersion: 2,
      run: buildChallengeRun(),
      updatedAtIso: '2026-07-31T12:00:00.000Z',
    };
    const parsed = storedRunRecordSchema.parse(record);
    expect(parsed.run.runId).toBe('run-1');
    expect(parsed.saveSchemaVersion).toBe(2);
  });

  it('accepts a record without adapter timestamps', () => {
    const record = {
      recordId: 'record-2',
      saveSchemaVersion: 2,
      run: buildChallengeRun({ runId: 'run-2' }),
    };
    expect(storedRunRecordSchema.safeParse(record).success).toBe(true);
  });

  it('rejects an invalid run inside the record', () => {
    const run = buildChallengeRun();
    const record = {
      recordId: 'record-3',
      saveSchemaVersion: 2,
      run: { ...run, runSeed: 'not-hex' },
    };
    expect(storedRunRecordSchema.safeParse(record).success).toBe(false);
  });

  it('rejects a run with the wrong player count', () => {
    const run = buildChallengeRun({ playerIds: ['p-1', 'p-2'] });
    const record = {
      recordId: 'record-4',
      saveSchemaVersion: 2,
      run,
    };
    expect(storedRunRecordSchema.safeParse(record).success).toBe(false);
  });

  it('rejects a stale save layout version', () => {
    const record = {
      recordId: 'record-5',
      saveSchemaVersion: 1,
      run: buildChallengeRun({ runId: 'run-5' }),
    };
    expect(storedRunRecordSchema.safeParse(record).success).toBe(false);
  });

  it('round-trips a free-form run with a null franchiseId and selections', () => {
    const record = {
      recordId: 'record-6',
      saveSchemaVersion: 2,
      run: buildChallengeRun({ franchiseId: null, selections }),
    };
    const parsed = storedRunRecordSchema.parse(record);
    expect(parsed.run.franchiseId).toBeNull();
    expect(parsed.run.selections).toEqual(selections);
  });

  it('still parses a legacy record without selections', () => {
    const legacy = buildChallengeRun();
    expect(legacy.selections).toBeUndefined();
    const record = {
      recordId: 'record-7',
      saveSchemaVersion: 2,
      run: legacy,
    };
    expect(storedRunRecordSchema.safeParse(record).success).toBe(true);
  });

  it('rejects a free-form run with the wrong selection count', () => {
    const record = {
      recordId: 'record-8',
      saveSchemaVersion: 2,
      run: buildChallengeRun({ franchiseId: null, selections: selections.slice(0, 4) }),
    };
    expect(storedRunRecordSchema.safeParse(record).success).toBe(false);
  });
});

describe('completedRunIndexSchema', () => {
  it('accepts a compact completed-run index row', () => {
    const row = {
      recordId: 'run-1',
      runId: 'run-1',
      mode: 'sandbox',
      franchiseId: 'lakers',
      eraId: '1990s',
      playerIds: ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'],
      runSeed: 'abcd1234abcd1234abcd1234abcd1234',
      wins: 81,
      losses: 1,
      gamesPlayed: 82,
      outcome: 'eliminated',
      completedAtIso: '2026-07-31T12:00:00.000Z',
    };
    expect(completedRunIndexSchema.safeParse(row).success).toBe(true);
  });

  it('accepts a free-form index row with a null franchiseId and selections', () => {
    const row = {
      recordId: 'run-free',
      runId: 'run-free',
      mode: 'sandbox',
      franchiseId: null,
      eraId: '2010s',
      playerIds: ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'],
      selections,
      runSeed: 'abcd1234abcd1234abcd1234abcd1234',
      wins: 82,
      losses: 0,
      gamesPlayed: 82,
      outcome: 'perfect',
      completedAtIso: '2026-07-31T12:00:00.000Z',
    };
    expect(completedRunIndexSchema.safeParse(row).success).toBe(true);
  });

  it('rejects a free-form index row with the wrong selection count', () => {
    const row = {
      recordId: 'run-free-bad',
      runId: 'run-free-bad',
      mode: 'sandbox',
      franchiseId: null,
      eraId: '2010s',
      playerIds: ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'],
      selections: selections.slice(0, 3),
      runSeed: 'abcd1234abcd1234abcd1234abcd1234',
      wins: 82,
      losses: 0,
      gamesPlayed: 82,
      outcome: 'perfect',
      completedAtIso: '2026-07-31T12:00:00.000Z',
    };
    expect(completedRunIndexSchema.safeParse(row).success).toBe(false);
  });

  it('rejects an outcome missing from a completed row', () => {
    const row = {
      recordId: 'run-2',
      runId: 'run-2',
      mode: 'sandbox',
      franchiseId: 'lakers',
      eraId: '1990s',
      playerIds: ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'],
      runSeed: 'abcd1234abcd1234abcd1234abcd1234',
      wins: 82,
      losses: 0,
      gamesPlayed: 82,
      outcome: 'perfect',
      completedAtIso: 'not-a-date',
    };
    expect(completedRunIndexSchema.safeParse(row).success).toBe(false);
  });
});
