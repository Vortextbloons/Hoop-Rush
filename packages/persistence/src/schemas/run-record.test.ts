import { describe, expect, it } from 'vitest';
import { buildChallengeRun, buildClassicCompletedDraft } from '@hoop-rush/test-fixtures';
import { playerIdSchema } from '@hoop-rush/data-contracts';
import {
  activeRunCheckpointSchema,
  checkpointFromRun,
  completedRunIndexSchema,
  runFromCheckpoint,
  storedRunRecordSchema,
  type StoredRunRecord,
} from './run-record.ts';
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
    const run = buildChallengeRun();
    const record = {
      recordId: 'record-4',
      saveSchemaVersion: 2,
      run: {
        ...run,
        playerIds: [playerIdSchema.parse('p-1'), playerIdSchema.parse('p-2')],
      },
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
  it('accepts a free-form run with a null franchiseId and selections', () => {
    const run = buildChallengeRun({ franchiseId: null });
    const record = {
      recordId: 'record-6',
      saveSchemaVersion: 2,
      run,
    };
    expect(storedRunRecordSchema.safeParse(record).success).toBe(true);
  });
  it('still parses a legacy single-pool record without selections', () => {
    const legacy = buildChallengeRun();
    const record = {
      recordId: 'record-7',
      saveSchemaVersion: 2,
      run: legacy,
    };
    expect(storedRunRecordSchema.safeParse(record).success).toBe(true);
  });
  it('rejects a run without the required franchiseId', () => {
    const run = buildChallengeRun();
    const { franchiseId: _franchiseId, ...withoutFranchise } = run;
    const record = {
      recordId: 'record-8',
      saveSchemaVersion: 2,
      run: withoutFranchise,
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
  it('accepts an index row with a null franchiseId', () => {
    const row = {
      recordId: 'run-free',
      runId: 'run-free',
      mode: 'sandbox',
      franchiseId: null,
      eraId: '2010s',
      playerIds: ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'],
      runSeed: 'abcd1234abcd1234abcd1234abcd1234',
      wins: 82,
      losses: 0,
      gamesPlayed: 82,
      outcome: 'perfect',
      completedAtIso: '2026-07-31T12:00:00.000Z',
    };
    expect(completedRunIndexSchema.safeParse(row).success).toBe(true);
  });
  it('rejects a completed row with an invalid completedAtIso', () => {
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
  it('rejects a completed row missing the outcome', () => {
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
      completedAtIso: '2026-07-31T12:00:00.000Z',
    };
    expect(completedRunIndexSchema.safeParse(row).success).toBe(false);
  });
  it('accepts an index row with classic variant metadata', () => {
    const row = {
      recordId: 'run-classic',
      runId: 'run-classic',
      mode: 'classic',
      variant: 'ball-knowledge',
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
    expect(completedRunIndexSchema.safeParse(row).success).toBe(true);
  });
});
describe('classic checkpoint round-trip', () => {
  it('carries variant and classicDraft through checkpoint and back', () => {
    const record: StoredRunRecord = {
      recordId: 'active',
      saveSchemaVersion: 2,
      run: buildChallengeRun({
        mode: 'classic',
        variant: 'ball-knowledge',
        classicDraft: buildClassicCompletedDraft({ draftId: 'draft-9' }),
      }),
    };
    const checkpoint = checkpointFromRun(record);
    expect(checkpoint.variant).toBe('ball-knowledge');
    expect(checkpoint.classicDraft?.draftId).toBe('draft-9');
    expect(activeRunCheckpointSchema.safeParse(checkpoint).success).toBe(true);
    const reconstructed = runFromCheckpoint(checkpoint, []);
    expect(reconstructed.variant).toBe('ball-knowledge');
    expect(reconstructed.classicDraft).toEqual(record.run.classicDraft);
    expect(reconstructed).toEqual(record.run);
  });
  it('round-trips a legacy sandbox run without variant fields', () => {
    const record: StoredRunRecord = {
      recordId: 'active',
      saveSchemaVersion: 2,
      run: buildChallengeRun(),
    };
    const checkpoint = checkpointFromRun(record);
    expect(checkpoint.variant).toBeUndefined();
    expect(checkpoint.classicDraft).toBeUndefined();
    expect(activeRunCheckpointSchema.safeParse(checkpoint).success).toBe(true);
    const reconstructed = runFromCheckpoint(checkpoint, []);
    expect(reconstructed.variant).toBeUndefined();
    expect(reconstructed.classicDraft).toBeUndefined();
    expect(reconstructed).toEqual(record.run);
  });
});
