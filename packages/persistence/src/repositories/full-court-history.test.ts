import { afterEach, expect, test } from 'bun:test';
import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_PLAYOFF_ROUNDS,
  FULL_COURT_COACHING_SCHEMA_VERSION,
  FULL_COURT_DEFAULT_TACTICS,
  FULL_COURT_HISTORY_SCHEMA_VERSION,
  commandIdSchema,
  fullCourtCreateDraftCommandSchema,
  fullCourtHistoryRecordSchema,
  idSchema,
  seedSchema,
  type FullCourtHistoryRecord,
} from '@hoop-rush/data-contracts';
import {
  applyFullCourtCommand,
  createFullCourtDraftState,
  fullCourtDraftIndexOf,
} from '@hoop-rush/engine';
import { buildCapRushTestCatalog, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import {
  openTestDatabasePair,
  resetIndexedDb,
  restoreIndexedDb,
} from '../testing/repo-test-support.ts';
import { createFullCourtHistoryRepository } from './full-court-history.ts';

afterEach(restoreIndexedDb);

const TEST_CATALOG = buildCapRushTestCatalog({ overalls: [70, 71, 72, 73, 74, 75] });
const TEST_CATALOG_SOURCE = capRushTestCatalogSource(TEST_CATALOG);
const TEST_INDEX = fullCourtDraftIndexOf(TEST_CATALOG, TEST_CATALOG_SOURCE);

function completedDraft(runId: string) {
  let draft = createFullCourtDraftState(
    fullCourtCreateDraftCommandSchema.parse({
      command: 'create-full-court-draft',
      commandId: commandIdSchema.parse(`create-${runId}`),
      runId: idSchema.parse(runId),
      runSeed: seedSchema.parse('a'.repeat(32)),
      variant: 'standard',
      catalog: TEST_CATALOG_SOURCE,
    }),
    TEST_INDEX,
  );
  for (const candidate of TEST_CATALOG.candidates.filter(
    (player) => player.positions.primary === 'PG',
  )) {
    draft = applyFullCourtCommand(
      draft,
      {
        command: 'pick-full-court-player',
        commandId: commandIdSchema.parse(`pick-${runId}-${String(draft.revision)}`),
        runId: draft.runId,
        expectedRevision: draft.revision,
        playerVersionId: candidate.playerVersionId,
      },
      { index: TEST_INDEX },
    ).state;
  }
  return applyFullCourtCommand(
    draft,
    {
      command: 'finish-full-court-draft',
      commandId: commandIdSchema.parse(`finish-${runId}`),
      runId: draft.runId,
      expectedRevision: draft.revision,
    },
    { index: TEST_INDEX },
  ).state;
}

function historyRecord(runId: string, completedAtIso: string, wins = 58): FullCourtHistoryRecord {
  const draft = completedDraft(runId);
  return fullCourtHistoryRecordSchema.parse({
    schemaVersion: FULL_COURT_HISTORY_SCHEMA_VERSION,
    runId: draft.runId,
    completedAtIso,
    draft,
    teamId: 'atl',
    teamName: 'Atlanta Hawks',
    coaching: {
      schemaVersion: FULL_COURT_COACHING_SCHEMA_VERSION,
      tactics: FULL_COURT_DEFAULT_TACTICS,
    },
    regularSeason: {
      wins,
      losses: CAP_RUSH_CONFERENCE_GAMES_PER_TEAM - wins,
      pointDifferential: 410,
    },
    playoffs: {
      status: 'champion',
      championTeamId: 'atl',
      championName: 'Atlanta Hawks',
      seriesWon: CAP_RUSH_PLAYOFF_ROUNDS,
      eliminatedRound: null,
    },
    achievements: ['bench-mob'],
  });
}

test('saves idempotently, lists newest first, and persists across connections', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-history');
  try {
    const repo = createFullCourtHistoryRepository(first);
    const older = historyRecord('fc-run-1', '2026-10-01T10:00:00.000Z', 52);
    const newer = historyRecord('fc-run-2', '2026-10-02T12:00:00.000Z', 60);

    expect(await repo.save(older)).toBe('saved');
    expect(await repo.save(newer)).toBe('saved');
    // Re-saving the same run on resume with a newer clock timestamp is idempotent
    // and preserves the original archived completion timestamp.
    expect(await repo.save({ ...older, completedAtIso: '2026-10-05T15:00:00.000Z' })).toBe(
      'existing',
    );
    expect(await repo.load('fc-run-1')).toEqual(older);

    expect((await repo.list()).map((entry) => String(entry.runId))).toEqual([
      'fc-run-2',
      'fc-run-1',
    ]);
    expect((await repo.list(1)).map((entry) => String(entry.runId))).toEqual(['fc-run-2']);

    let conflict: unknown = null;
    try {
      await repo.save(historyRecord('fc-run-1', older.completedAtIso, 40));
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(Error);
    expect((conflict as Error).message).toContain('different data');

    first.close();
    const reopened = createFullCourtHistoryRepository(second);
    expect(await reopened.load('fc-run-2')).toEqual(newer);
  } finally {
    first.close();
    second.close();
  }
});

test('rejects unsupported save versions and mismatched keys on read', async () => {
  resetIndexedDb();
  const { first } = openTestDatabasePair('full-court-history-read');
  try {
    const repo = createFullCourtHistoryRepository(first);
    const record = historyRecord('fc-run-bad', '2026-10-01T10:00:00.000Z');
    await repo.save(record);

    const row = await first.fullCourtHistory.get(idSchema.parse('fc-run-bad'));
    if (row === undefined) throw new Error('Expected stored history row');

    await first.table('fullCourtHistory').put({ ...row, saveSchemaVersion: 99 });
    await expect(repo.load('fc-run-bad')).rejects.toThrow('stored save schema 99');

    await first.table('fullCourtHistory').put({
      ...row,
      completedAtIso: '2026-10-09T00:00:00.000Z',
    });
    await expect(repo.load('fc-run-bad')).rejects.toThrow('must match its index');
  } finally {
    first.close();
  }
});
