import { describe, expect, it } from 'vitest';
import Dexie, { type EntityTable, type Table } from 'dexie';
import { IDBFactory } from 'fake-indexeddb';
import type {
  ActiveGameRow,
  ActiveRunCheckpoint,
  CompletedRunIndex,
  StoredRunRecord,
} from '../schemas/run-record.ts';
import type { StoredClassicDraft } from '../schemas/classic-draft-record.ts';
import type { StoredSeasonDraft } from '../schemas/season-draft-record.ts';
import type {
  StoredSeasonAcceptedBlockRow,
  StoredSeasonActiveRunIndex,
  StoredSeasonDetailRow,
  StoredSeasonRunRecord,
  StoredSeasonSummaryRow,
} from '../schemas/season-run-record.ts';
import { SEASON_RUN_RECORD_ID } from '../schemas/season-run-record.ts';
import { DexieChallengeRepository, HoopRushDatabase } from './dexie.ts';
import { DexieSeasonDraftRepository } from './season-draft.ts';
import {
  DexieSeasonRunRepository,
  SeasonRunLoadError,
  loadActiveRunWithSchedule,
} from './season-run-dexie.ts';
import {
  buildFixtureRun,
  buildFixtureSchedule,
  buildFixtureStoredDraft,
  buildStubSeasonEngineSeam,
} from '../testing/season-run-fixture.ts';
import { buildFullSeasonDataset } from '../benchmark/season-run.ts';
import type { CommitSeasonBlockInput } from './season-run.ts';

/**
 * Season Run repository contract tests (spec/2.0/07 persistence, spec/2.0/10
 * M2.3). The dedicated v6 tables isolate the active run from the Challenge
 * and Classic stores. `commitSeasonBlock` is one atomic transaction: a
 * failure before or inside the transaction writes nothing and the accepted
 * checkpoint never advances; a failed promotion leaves the draft intact.
 * Every load validates stored rows and audits aggregate reconciliation, so
 * corrupt rows throw a typed `SeasonRunLoadError` instead of entering app
 * state. The engine math comes through the stub seam (documented pure
 * semantics), keeping these tests independent of the engine agent's parallel
 * block-pipeline work.
 */

/** Replaces the shared fake-indexeddb factory, isolating Dexie versioning. */
function resetIndexedDb(): void {
  const factory = new IDBFactory();
  globalThis.indexedDB = factory;
  Dexie.dependencies.indexedDB = factory;
}

class TestDatabase extends Dexie {
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
  }
}

interface Adapters {
  db: TestDatabase;
  repo: DexieSeasonRunRepository;
  challenge: DexieChallengeRepository;
  seasonDraft: DexieSeasonDraftRepository;
  schedule: ReturnType<typeof buildFullSeasonDataset>['schedule'];
  run: ReturnType<typeof buildFullSeasonDataset>['run'];
  blocks: ReturnType<typeof buildFullSeasonDataset>['blocks'];
  seam: ReturnType<typeof buildStubSeasonEngineSeam>;
}

/** Fresh repositories with one isolated database and the stub engine seam. */
function makeAdapters(): Adapters {
  const db = new TestDatabase(`season-run-test-${String(Math.random())}`);
  const seam = buildStubSeasonEngineSeam();
  const dataset = buildFullSeasonDataset({
    seam,
    runId: `run-${String(Math.random()).slice(2, 8)}`,
  });
  const repo = new DexieSeasonRunRepository(db, { schedule: dataset.schedule, seam });
  return {
    db,
    repo,
    challenge: new DexieChallengeRepository(db),
    seasonDraft: new DexieSeasonDraftRepository(db),
    schedule: dataset.schedule,
    run: dataset.run,
    blocks: dataset.blocks,
    seam,
  };
}

function commitInputFor(
  dataset: Pick<Adapters, 'run' | 'blocks'>,
  blockIndex: number,
): CommitSeasonBlockInput {
  const block = dataset.blocks[blockIndex];
  if (block === undefined) throw new Error(`no fixture block ${String(blockIndex)}`);
  return {
    runId: dataset.run.runId,
    revision: blockIndex + 1,
    commandId: `command-${String(blockIndex)}`,
    rotationDigest: block.rotationDigest,
    checkpointDigest: block.checkpointDigest,
    completedRounds: block.completedRounds,
    standings: block.standings,
    teamAggregates: block.teamAggregates,
    playerAggregates: block.playerAggregates,
    summaries: block.summaries,
    retainedDetails: block.retainedDetails,
    recap: block.recap,
    rotations: block.rotations,
  };
}

async function promote(adapters: Adapters): Promise<void> {
  await adapters.repo.promoteSeasonDraftToRun(buildFixtureStoredDraft(adapters.run), adapters.run);
}

async function loadOrThrow(adapters: Adapters) {
  const snapshot = await adapters.repo.loadActiveRun();
  if (snapshot === null) throw new Error('expected an active run');
  return snapshot;
}

describe('season run repository (dexie)', () => {
  it('opens the v6 database with the season tables and keeps the other stores', async () => {
    const { db, seasonDraft, challenge, run } = makeAdapters();
    const names = db.tables.map((table) => table.name);
    for (const expected of [
      'active',
      'activeGames',
      'completed',
      'history',
      'classicDrafts',
      'seasonDrafts',
      'seasonRuns',
      'seasonRunSummaries',
      'seasonRunDetails',
      'seasonRunBlocks',
      'seasonRunIndex',
    ]) {
      expect(names).toContain(expected);
    }
    await seasonDraft.saveSeasonDraft(buildFixtureStoredDraft(run));
    expect(await db.seasonDrafts.count()).toBe(1);
    expect(await challenge.loadClassicDraft()).toBeNull();
    expect(await challenge.loadActiveRun()).toBeNull();
  });

  it('returns null for the index and the snapshot when no run exists', async () => {
    const adapters = makeAdapters();
    expect(await adapters.repo.loadActiveRunIndex()).toBeNull();
    expect(await adapters.repo.loadActiveRunWithSchedule(adapters.schedule)).toBeNull();
  });

  it('loadActiveRun without a configured schedule throws a typed error', async () => {
    const { db, seam } = makeAdapters();
    const bare = new DexieSeasonRunRepository(db, { seam });
    await expect(bare.loadActiveRun()).rejects.toThrow(SeasonRunLoadError);
  });

  it('promotes a draft into an all-zero checkpoint and removes the draft', async () => {
    const adapters = makeAdapters();
    const { db, repo, run, schedule } = adapters;
    await promote(adapters);
    expect(await db.seasonDrafts.count()).toBe(0);
    const index = await repo.loadActiveRunIndex();
    expect(index).not.toBeNull();
    expect(index?.runId).toBe(run.runId);
    expect(index?.revision).toBe(0);
    expect(index?.humanWins).toBe(0);
    const snapshot = await repo.loadActiveRunWithSchedule(schedule);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.run.runId).toBe(run.runId);
    expect(snapshot?.run.games).toHaveLength(1230);
    expect(snapshot?.run.games.every((game) => game.status === 'scheduled')).toBe(true);
    expect(snapshot?.run.standings.rows.every((row) => row.wins === 0 && row.losses === 0)).toBe(
      true,
    );
    expect(snapshot?.run.cursor.completedRounds).toBe(0);
    expect(snapshot?.summaries).toHaveLength(0);
    expect(snapshot?.retainedDetails).toHaveLength(0);
    expect(snapshot?.acceptedBlocks).toHaveLength(0);
  });

  it('a failed promotion leaves the draft intact and writes nothing', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    const draft = buildFixtureStoredDraft(run);
    await adapters.seasonDraft.saveSeasonDraft(draft);
    const invalidRun = { ...run, games: run.games.slice(0, 10) };
    await expect(repo.promoteSeasonDraftToRun(draft, invalidRun as never)).rejects.toThrow();
    expect(await db.seasonDrafts.count()).toBe(1);
    expect(await db.seasonRuns.count()).toBe(0);
    expect(await db.seasonRunIndex.count()).toBe(0);
  });

  it('rejects promotion when the stored draft runId does not match', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    const stored = buildFixtureStoredDraft(run);
    await adapters.seasonDraft.saveSeasonDraft(stored);
    const otherRun = buildFixtureRun({ runId: 'other-season-run' });
    const draftForOther = buildFixtureStoredDraft(otherRun);
    await expect(repo.promoteSeasonDraftToRun(draftForOther, otherRun)).rejects.toThrow(
      /stored draft runId/,
    );
    expect(await db.seasonDrafts.count()).toBe(1);
    expect(await db.seasonRuns.count()).toBe(0);
  });

  it('commits one block and reloads summaries, details, history, and totals', async () => {
    const adapters = makeAdapters();
    const { repo, run, blocks } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));

    expect((await repo.loadBlockSummaries(run.runId, 0)).length).toBe(150);
    expect((await repo.loadBlockSummaries(run.runId, 1)).length).toBe(0);
    const details = await repo.loadRetainedDetails(run.runId);
    expect(details.length).toBeGreaterThan(0);
    expect(details.every((detail) => detail.runId === run.runId)).toBe(true);
    const history = await repo.loadBlockHistory(run.runId);
    expect(history).toHaveLength(1);
    expect(history[0]?.revision).toBe(1);
    expect(history[0]?.blockIndex).toBe(0);
    expect(history[0]?.summaryCount).toBe(150);

    const snapshot = await loadOrThrow(adapters);
    expect(snapshot.run.cursor.completedRounds).toBe(10);
    expect(snapshot.run.standings).toEqual(blocks[0]?.standings);
    expect(snapshot.summaries).toHaveLength(150);
    expect(snapshot.summaries.map((summary) => summary.gameId)).toEqual(
      blocks[0]?.summaries.map((summary) => summary.gameId),
    );
    expect(snapshot.acceptedBlocks).toHaveLength(1);
    const index = await repo.loadActiveRunIndex();
    expect(index?.revision).toBe(1);
    const humanRow = blocks[0]?.standings.rows.find((row) => row.franchiseId === 'lakers');
    expect(index?.humanWins).toBe(humanRow?.wins);
    expect(index?.humanLosses).toBe(humanRow?.losses);
  });

  it('rejects duplicate command ids and revision regressions inside the transaction', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));

    await expect(
      repo.commitSeasonBlock({ ...commitInputFor(adapters, 1), commandId: 'command-0' }),
    ).rejects.toThrow(/duplicate commandId/);
    await expect(repo.commitSeasonBlock(commitInputFor(adapters, 0))).rejects.toThrow(
      /revision regression/,
    );
    await expect(
      repo.commitSeasonBlock({ ...commitInputFor(adapters, 1), revision: 7 }),
    ).rejects.toThrow(/revision regression/);

    expect(await db.seasonRunBlocks.count()).toBe(1);
    expect(await db.seasonRunSummaries.count()).toBe(150);
    const snapshot = await loadOrThrow(adapters);
    expect(snapshot.run.cursor.completedRounds).toBe(10);
    expect(snapshot.acceptedBlocks).toHaveLength(1);
  });

  it('rejects a mismatched runId, a completedRounds regression, and invalid revisions', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));

    await expect(
      repo.commitSeasonBlock({ ...commitInputFor(adapters, 1), runId: 'other-run' }),
    ).rejects.toThrow(/runId/);
    await expect(
      repo.commitSeasonBlock({ ...commitInputFor(adapters, 1), completedRounds: 5 }),
    ).rejects.toThrow(/completedRounds regression/);
    await expect(
      repo.commitSeasonBlock({ ...commitInputFor(adapters, 1), revision: 0 }),
    ).rejects.toThrow(/not a valid block boundary/);
    expect(await db.seasonRuns.count()).toBe(1);
    expect(await db.seasonRunSummaries.count()).toBe(150);
  });

  it('rejects commits when no active run checkpoint exists', async () => {
    const adapters = makeAdapters();
    await expect(adapters.repo.commitSeasonBlock(commitInputFor(adapters, 0))).rejects.toThrow(
      /no active run checkpoint/,
    );
  });

  it('a failure inside the transaction rolls back the entire block', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    const input = commitInputFor(adapters, 0);
    const firstSummary = input.summaries[0];
    if (firstSummary === undefined) throw new Error('expected a fixture summary');
    const invalid = {
      ...input,
      summaries: [{ ...firstSummary, gameId: 'not-a-game-id' }],
    };
    await expect(repo.commitSeasonBlock(invalid)).rejects.toThrow();
    expect(await db.seasonRunSummaries.count()).toBe(0);
    expect(await db.seasonRunDetails.count()).toBe(0);
    expect(await db.seasonRunBlocks.count()).toBe(0);
    const snapshot = await loadOrThrow(adapters);
    expect(snapshot.run.cursor.completedRounds).toBe(0);
    expect(snapshot.acceptedBlocks).toHaveLength(0);
    expect((await repo.loadActiveRunIndex())?.revision).toBe(0);
  });

  it('a failure before the transaction writes nothing', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    await expect(
      repo.commitSeasonBlock({ ...commitInputFor(adapters, 0), revision: 0 }),
    ).rejects.toThrow(/not a valid block boundary/);
    await expect(
      repo.commitSeasonBlock({ ...commitInputFor(adapters, 0), revision: 10 }),
    ).rejects.toThrow(/not a valid block boundary/);
    expect(await db.seasonRunSummaries.count()).toBe(0);
    expect(await db.seasonRunBlocks.count()).toBe(0);
    const snapshot = await loadOrThrow(adapters);
    expect(snapshot.acceptedBlocks).toHaveLength(0);
  });

  it('surfaces a corrupt stored summary row on load', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    const row = (await db.seasonRunSummaries.toArray())[0];
    if (row === undefined) throw new Error('expected a stored summary row');
    await db.seasonRunSummaries.put({ ...row, summary: { corrupted: true } } as never);
    await expect(repo.loadActiveRun()).rejects.toThrow(SeasonRunLoadError);
    await expect(repo.loadBlockSummaries(run.runId, 0)).rejects.toThrow(SeasonRunLoadError);
  });

  it('surfaces a stale revision on load', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    const row = await db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (row === undefined) throw new Error('expected a checkpoint row');
    await db.seasonRuns.put({ ...row, revision: 5 });
    await expect(repo.loadActiveRun()).rejects.toThrow(/revision/);
  });

  it('surfaces a mismatched checkpoint digest on load', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    const row = await db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (row === undefined) throw new Error('expected a checkpoint row');
    await db.seasonRuns.put({
      ...row,
      lastCheckpointDigest: 'f'.repeat(32),
      lastRotationDigest: 'e'.repeat(32),
    });
    await expect(repo.loadActiveRun()).rejects.toThrow(/lastCheckpointDigest/);
  });

  it('surfaces a missing or corrupt active-run index on load', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    await db.seasonRunIndex.delete(SEASON_RUN_RECORD_ID);
    await expect(repo.loadActiveRun()).rejects.toThrow(/index row is missing/);
    await db.seasonRunIndex.put({
      recordId: SEASON_RUN_RECORD_ID,
      index: { broken: true },
    } as never);
    await expect(repo.loadActiveRun()).rejects.toThrow(/corrupt active-run index/);
  });

  it('surfaces a corrupt retained detail row and a corrupt block row', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    const detail = (await db.seasonRunDetails.toArray())[0];
    if (detail !== undefined) {
      await db.seasonRunDetails.put({ ...detail, detail: { broken: true } } as never);
      await expect(repo.loadActiveRun()).rejects.toThrow(SeasonRunLoadError);
      await expect(repo.loadRetainedDetails(run.runId)).rejects.toThrow(SeasonRunLoadError);
    }
    const block = (await db.seasonRunBlocks.toArray())[0];
    if (block !== undefined) {
      await db.seasonRunBlocks.put({ ...block, block: { broken: true } } as never);
      await expect(repo.loadBlockHistory(run.runId)).rejects.toThrow(SeasonRunLoadError);
    }
  });

  it('clearSeasonRun removes the checkpoint, rows, and index atomically', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    await repo.commitSeasonBlock(commitInputFor(adapters, 1));
    expect(await db.seasonRunSummaries.count()).toBe(300);
    await repo.clearSeasonRun(run.runId);
    expect(await db.seasonRuns.count()).toBe(0);
    expect(await db.seasonRunIndex.count()).toBe(0);
    expect(await db.seasonRunSummaries.count()).toBe(0);
    expect(await db.seasonRunDetails.count()).toBe(0);
    expect(await db.seasonRunBlocks.count()).toBe(0);
    expect(await repo.loadActiveRun()).toBeNull();
    expect(await repo.loadActiveRunIndex()).toBeNull();
  });

  it('clearSeasonRun rejects a runId that does not match the active checkpoint', async () => {
    const adapters = makeAdapters();
    const { repo } = adapters;
    await promote(adapters);
    await expect(repo.clearSeasonRun('other-run')).rejects.toThrow(/does not match/);
    await expect(repo.loadActiveRun()).resolves.not.toBeNull();
  });

  it('a full nine-block season reloads with reconciled standings and aggregates', async () => {
    const adapters = makeAdapters();
    const { repo, blocks, run } = adapters;
    await promote(adapters);
    for (let blockIndex = 0; blockIndex < 9; blockIndex += 1) {
      await repo.commitSeasonBlock(commitInputFor(adapters, blockIndex));
    }
    const snapshot = await loadOrThrow(adapters);
    expect(snapshot.run.games).toHaveLength(1230);
    expect(snapshot.run.games.filter((game) => game.status !== 'scheduled')).toHaveLength(1230);
    expect(snapshot.run.cursor.completedRounds).toBe(82);
    expect(snapshot.summaries).toHaveLength(1230);
    expect(snapshot.retainedDetails).toHaveLength(82);
    expect(snapshot.acceptedBlocks).toHaveLength(9);
    expect(snapshot.run.standings).toEqual(blocks[8]?.standings);
    expect(snapshot.run.games.every((game) => game.homeScore !== null)).toBe(true);
    const index = await repo.loadActiveRunIndex();
    expect(index?.completedRounds).toBe(82);
    expect(index?.revision).toBe(9);
    const humanRow = blocks[8]?.standings.rows.find((row) => row.franchiseId === 'lakers');
    expect(index?.humanWins).toBe(humanRow?.wins);
    expect(index?.humanLosses).toBe(humanRow?.losses);
    expect(run.runId).toBeTruthy();
  });

  it('the exported convenience function loads the full snapshot', async () => {
    const adapters = makeAdapters();
    const { db, schedule } = adapters;
    await promote(adapters);
    const viaFreeFunction = await loadActiveRunWithSchedule(schedule, db);
    const viaRepository = await loadOrThrow(adapters);
    expect(viaFreeFunction?.run.runId).toBe(viaRepository.run.runId);
    expect(viaFreeFunction?.run.games).toHaveLength(1230);
  });

  it('rejects an invalid schedule artifact at the load boundary', async () => {
    const adapters = makeAdapters();
    const { repo, schedule } = adapters;
    await promote(adapters);
    const invalidSchedule = { ...schedule, games: schedule.games.slice(0, 100) };
    await expect(repo.loadActiveRunWithSchedule(invalidSchedule as never)).rejects.toThrow();
  });
});

describe('season run migration', () => {
  it('opens a v5-era save at schema version 6 and keeps the stored draft intact', async () => {
    resetIndexedDb();
    const run = buildFixtureRun({});
    const legacyDb = new Dexie('hoop-rush-saves');
    legacyDb.version(1).stores({ active: 'recordId', completed: 'recordId', history: 'recordId' });
    legacyDb.version(2).stores({
      active: 'recordId',
      activeGames: '[runId+gameNumber], runId',
      completed: 'recordId',
      history: 'recordId',
    });
    legacyDb.version(3).stores({ history: 'recordId, completedAtIso' });
    legacyDb.version(4).stores({ classicDrafts: 'recordId' });
    legacyDb.version(5).stores({ seasonDrafts: 'recordId' });
    await legacyDb.open();
    await legacyDb.table('seasonDrafts').put(buildFixtureStoredDraft(run));
    legacyDb.close();

    const db = new HoopRushDatabase();
    const seasonDraft = new DexieSeasonDraftRepository(db);
    const seasonRun = new DexieSeasonRunRepository(db, {
      schedule: buildFixtureSchedule(run.rootSeed),
      seam: buildStubSeasonEngineSeam(),
    });
    expect((await seasonDraft.loadSeasonDraft())?.draft.runId).toBe(run.runId);
    expect(await seasonRun.loadActiveRunIndex()).toBeNull();
    await seasonRun.promoteSeasonDraftToRun(buildFixtureStoredDraft(run), run);
    const snapshot = await seasonRun.loadActiveRun();
    expect(snapshot?.run.games).toHaveLength(1230);
    expect(await seasonDraft.loadSeasonDraft()).toBeNull();
  });
});
