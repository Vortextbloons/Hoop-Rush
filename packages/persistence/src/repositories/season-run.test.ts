import { afterEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import {
  SEASON_RUN_SAVE_SCHEMA_VERSION,
  type SeasonEffectsState,
  type SeasonPendingBlockCandidate,
  type SeasonRun,
  type SeasonRunCommand,
} from '@hoop-rush/data-contracts';
import { SEASON_RUN_RECORD_ID } from '../schemas/season-run-record.ts';
import { storedSeasonActiveRunIndexSchema } from '../schemas/season-run-record.ts';
import { storedSeasonSummaryRowSchema } from '../schemas/season-run-record.ts';
import { DexieChallengeRepository, HoopRushDatabase } from './dexie.ts';
import { DexieSeasonDraftRepository } from './season-draft.ts';
import {
  DexieSeasonRunRepository,
  SeasonRunLoadError,
  loadActiveRunWithSchedule,
} from './season-run-dexie.ts';
import {
  TestDatabase,
  resetIndexedDb,
  restoreIndexedDb,
  testDatabaseName,
} from '../testing/repo-test-support.ts';
import {
  buildFixtureEffectsState,
  buildFixtureInterruption,
  buildFixturePendingBlock,
  buildFixtureRun,
  buildFixtureSchedule,
  buildFixtureStateDigest,
  buildFixtureStoredDraft,
  buildStubSeasonEngineSeam,
} from '../testing/season-run-fixture.ts';
import { buildFullSeasonDataset } from '../benchmark/season-run.ts';
import {
  SeasonPendingBlockRejectedError,
  SeasonRunCommandDuplicateError,
  SeasonRunCommandRunMismatchError,
  SeasonRunCommandStaleStateError,
  type CommitSeasonBlockInput,
} from './season-run.ts';

/**
 * Season Run repository contract tests (spec/2.0/07 persistence, spec/2.0/10
 * M2.3, M2.4). The dedicated v6 tables isolate the active run from the
 * Challenge and Classic stores. `commitSeasonBlock` is one atomic
 * transaction: a failure before or inside the transaction writes nothing and
 * the accepted checkpoint never advances; a failed promotion leaves the
 * draft intact. Every load validates stored rows and audits aggregate and
 * M2.4 effects-state reconciliation, so corrupt rows throw a typed
 * `SeasonRunLoadError` instead of entering app state. Stored development
 * rows (save-schema v1/v2, schema-4 and schema-5 runs) are auto-cleared at
 * load and reported as null: they are never read, migrated, or preserved.
 * The engine math comes through the stub seam (documented pure semantics),
 * keeping these tests independent of the engine agent's parallel
 * block-pipeline work.
 */

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

// Read-only full-season fixture data shared by every test in this file.
// Each test only clones or spreads `run`/`blocks`/`schedule`, so one
// module-level build (schema parse of the 1,230-game snapshot) replaces a
// per-test rebuild of the full dataset.
const sharedDataset = buildFullSeasonDataset({
  seam: buildStubSeasonEngineSeam(),
  runId: 'season-run-contract-test',
});

/** Fresh repositories with one isolated database and the stub engine seam. */
function makeAdapters(): Adapters {
  const db = new TestDatabase(testDatabaseName('season-run'));
  const seam = buildStubSeasonEngineSeam();
  const repo = new DexieSeasonRunRepository(db, {
    schedule: sharedDataset.schedule,
    seam,
  });
  return {
    db,
    repo,
    challenge: new DexieChallengeRepository(db),
    seasonDraft: new DexieSeasonDraftRepository(db),
    schedule: sharedDataset.schedule,
    run: sharedDataset.run,
    blocks: sharedDataset.blocks,
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
    effects: block.effects,
    rotations: block.rotations,
    health: block.health,
    transactions: block.transactions,
    influence: block.influence,
    trade: block.trade,
    objectives: block.objectives,
    checkpointState: block.checkpointState,
    stateRevision: block.stateRevision,
    stateDigest: block.stateDigest,
    expectedStateRevision: blockIndex,
    expectedStateDigest: block.expectedStateDigest,
    window: null,
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
  it('opens the v7 database with the season tables and keeps the other stores', async () => {
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
      'seasonPendingBlocks',
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
    if (
      row === undefined ||
      (row as { saveSchemaVersion?: unknown }).saveSchemaVersion !== SEASON_RUN_SAVE_SCHEMA_VERSION
    ) {
      throw new Error('expected a current v5 checkpoint row');
    }
    await db.seasonRuns.put({ ...row, revision: 5 });
    await expect(repo.loadActiveRun()).rejects.toThrow(/revision/);
  });

  it('surfaces a mismatched checkpoint digest on load', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    const row = await db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (
      row === undefined ||
      (row as { saveSchemaVersion?: unknown }).saveSchemaVersion !== SEASON_RUN_SAVE_SCHEMA_VERSION
    ) {
      throw new Error('expected a current v5 checkpoint row');
    }
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

describe('season run development-row auto-clear (M2.4)', () => {
  /** Minimal-but-faithful stored save-schema-v1 row (schema-4 run). */
  function developmentV1Row(runId: string): Record<string, unknown> {
    return {
      recordId: SEASON_RUN_RECORD_ID,
      saveSchemaVersion: 1,
      run: {
        runId,
        schemaVersion: 4,
        versions: { runSchemaVersion: 4 },
      },
    };
  }

  /** Development v2 row (schema-5 run, pre-v3 wrapper with effects). */
  function developmentV2Row(adapters: Adapters): Record<string, unknown> {
    const { run } = adapters;
    const { games: _games, ...runWithoutGames } = run;
    return {
      recordId: SEASON_RUN_RECORD_ID,
      saveSchemaVersion: 2,
      run: runWithoutGames,
      completedRounds: 0,
      revision: 0,
      lastCommandId: null,
      lastRotationDigest: null,
      lastCheckpointDigest: null,
      standings: run.standings,
      teamAggregates: [],
      playerAggregates: [],
      recap: null,
      effects: buildFixtureEffectsState(run.rosters),
    };
  }

  async function currentCheckpoint(
    adapters: Adapters,
  ): Promise<import('../schemas/season-run-record.ts').StoredSeasonRunRecord> {
    const row = await adapters.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (
      row === undefined ||
      (row as { saveSchemaVersion?: unknown }).saveSchemaVersion !== SEASON_RUN_SAVE_SCHEMA_VERSION
    ) {
      throw new Error('expected a current v5 checkpoint row');
    }
    return row;
  }

  /** Rewrites the stored row with a mutated effects state (schema-valid writes only). */
  async function corruptStoredEffects(
    adapters: Adapters,
    mutate: (effects: SeasonEffectsState) => SeasonEffectsState,
  ): Promise<void> {
    const row = await currentCheckpoint(adapters);
    await adapters.db.seasonRuns.put({
      ...row,
      effects: mutate(structuredClone(row.effects)),
    });
  }

  it('reports a stored v1 row as typed incompatible on every load path and preserves it', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    await db.seasonRuns.put(developmentV1Row(run.runId) as never);

    await expect(repo.loadActiveRun()).rejects.toMatchObject({
      name: 'SeasonRunIncompatibleError',
      info: {
        storedSaveSchemaVersion: SEASON_RUN_SAVE_SCHEMA_VERSION,
        storedRunSchemaVersion: 4,
        runId: run.runId,
      },
    });
    expect(await db.seasonRuns.count()).toBe(1);

    await expect(repo.loadActiveRunWithSchedule(adapters.schedule)).rejects.toMatchObject({
      name: 'SeasonRunIncompatibleError',
    });
    expect(await db.seasonRuns.count()).toBe(1);
  });

  it('reports a stored v2 row as typed incompatible and preserves it', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await db.seasonRuns.put(developmentV2Row(adapters) as never);
    await expect(repo.loadActiveRun()).rejects.toMatchObject({
      name: 'SeasonRunIncompatibleError',
    });
    expect(await db.seasonRuns.count()).toBe(1);
    expect(await db.seasonRunIndex.count()).toBe(0);
  });

  it('never deletes legacy rows with their summaries, details, and blocks', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    await db.seasonRuns.put(developmentV1Row(run.runId) as never);
    const summary = sharedDataset.blocks[0]?.summaries[0];
    if (summary === undefined) throw new Error('expected a fixture summary');
    await db.seasonRunSummaries.put(
      storedSeasonSummaryRowSchema.parse({
        runId: run.runId,
        gameId: summary.gameId,
        blockIndex: 0,
        round: summary.round,
        summary,
      }),
    );
    await db.seasonRunIndex.put(
      storedSeasonActiveRunIndexSchema.parse({
        recordId: SEASON_RUN_RECORD_ID,
        index: {
          runId: run.runId,
          rootSeed: 'a'.repeat(32),
          humanFranchiseId: 'lakers',
          completedRounds: 0,
          revision: 0,
          humanWins: 0,
          humanLosses: 0,
          updatedAtIso: '2026-08-04T12:00:00.000Z',
        },
      }),
    );

    await expect(repo.loadActiveRun()).rejects.toMatchObject({
      name: 'SeasonRunIncompatibleError',
    });
    expect(await db.seasonRuns.count()).toBe(1);
    expect(await db.seasonRunIndex.count()).toBe(1);
    expect(await db.seasonRunSummaries.count()).toBe(1);
    expect(await db.seasonRunDetails.count()).toBe(0);
    expect(await db.seasonRunBlocks.count()).toBe(0);
  });

  it('commit and promotion reject legacy rows instead of silently rewriting them', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    await db.seasonRuns.put(developmentV1Row(run.runId) as never);

    await expect(repo.commitSeasonBlock(commitInputFor(adapters, 0))).rejects.toMatchObject({
      name: 'SeasonRunIncompatibleError',
    });
    expect(await db.seasonRuns.count()).toBe(1);

    await db.seasonRuns.put(developmentV2Row(adapters) as never);
    await expect(
      repo.promoteSeasonDraftToRun(buildFixtureStoredDraft(run), run),
    ).rejects.toMatchObject({
      name: 'SeasonRunIncompatibleError',
    });
    expect(await db.seasonRuns.count()).toBe(1);
  });

  it('clearSeasonRun removes a development row and its rows', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    await db.seasonRuns.put(developmentV1Row(run.runId) as never);
    await db.seasonRunIndex.put(
      storedSeasonActiveRunIndexSchema.parse({
        recordId: SEASON_RUN_RECORD_ID,
        index: {
          runId: run.runId,
          rootSeed: 'a'.repeat(32),
          humanFranchiseId: 'lakers',
          completedRounds: 0,
          revision: 0,
          humanWins: 0,
          humanLosses: 0,
          updatedAtIso: '2026-08-04T12:00:00.000Z',
        },
      }),
    );
    const summary = sharedDataset.blocks[0]?.summaries[0];
    if (summary === undefined) throw new Error('expected a fixture summary');
    await db.seasonRunSummaries.put(
      storedSeasonSummaryRowSchema.parse({
        runId: run.runId,
        gameId: summary.gameId,
        blockIndex: 0,
        round: summary.round,
        summary,
      }),
    );

    await repo.clearSeasonRun(run.runId);
    expect(await db.seasonRuns.count()).toBe(0);
    expect(await db.seasonRunIndex.count()).toBe(0);
    expect(await db.seasonRunSummaries.count()).toBe(0);
    expect(await repo.loadActiveRun()).toBeNull();
  });

  it('a fresh v5 row round-trips the effects state through promotion, commit, and reload', async () => {
    const adapters = makeAdapters();
    const { repo, run } = adapters;
    await promote(adapters);
    let row = await currentCheckpoint(adapters);
    expect(row.saveSchemaVersion).toBe(SEASON_RUN_SAVE_SCHEMA_VERSION);
    expect(row.effects).toEqual(buildFixtureEffectsState(run.rosters));

    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    row = await currentCheckpoint(adapters);
    expect(row.effects).toEqual(sharedDataset.blocks[0]?.effects);

    const snapshot = await loadOrThrow(adapters);
    expect(snapshot.effects).toEqual(sharedDataset.blocks[0]?.effects);
  });

  it('surfaces corrupt v2 effects as SeasonRunLoadError on load', async () => {
    const adapters = makeAdapters();
    const { repo } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));

    const stranger = 'pv-00000000000000000000000000000000';
    const cases: Array<[string, (effects: SeasonEffectsState) => SeasonEffectsState]> = [
      [
        'wrong player count',
        (effects) => ({ ...effects, playerStates: effects.playerStates.slice(0, 299) }),
      ],
      [
        'wrong pair count',
        (effects) => ({ ...effects, pairStates: effects.pairStates.slice(0, 1349) }),
      ],
      [
        'noncanonical pair',
        (effects) => {
          const first = effects.pairStates[0];
          if (first === undefined) throw new Error('expected a pair state');
          return {
            ...effects,
            pairStates: [
              { a: first.b, b: first.a, sharedPossessions: first.sharedPossessions },
              ...effects.pairStates.slice(1),
            ],
          };
        },
      ],
      [
        'duplicate pair',
        (effects) => {
          const first = effects.pairStates[0];
          if (first === undefined) throw new Error('expected a pair state');
          return { ...effects, pairStates: [...effects.pairStates.slice(0, -1), first] };
        },
      ],
      [
        'pair member outside the player states',
        (effects) => {
          const first = effects.pairStates[0];
          if (first === undefined) throw new Error('expected a pair state');
          return {
            ...effects,
            pairStates: [
              { a: first.a, b: stranger, sharedPossessions: first.sharedPossessions },
              ...effects.pairStates.slice(1),
            ],
          };
        },
      ],
      [
        'out-of-range fatigue',
        (effects) => {
          const first = effects.playerStates[0];
          if (first === undefined) throw new Error('expected a player state');
          return {
            ...effects,
            playerStates: [
              { ...first, fatigueBasisPoints: 10_001 },
              ...effects.playerStates.slice(1),
            ],
          };
        },
      ],
      [
        'out-of-range shared possessions',
        (effects) => {
          const first = effects.pairStates[0];
          if (first === undefined) throw new Error('expected a pair state');
          return {
            ...effects,
            pairStates: [
              { ...first, sharedPossessions: 10_000_001 },
              ...effects.pairStates.slice(1),
            ],
          };
        },
      ],
      [
        'lastCompletedRound beyond the checkpoint completedRounds',
        (effects) => {
          const first = effects.playerStates[0];
          if (first === undefined) throw new Error('expected a player state');
          return {
            ...effects,
            playerStates: [{ ...first, lastCompletedRound: 11 }, ...effects.playerStates.slice(1)],
          };
        },
      ],
      [
        'player set differing from the rosters',
        (effects) => {
          const first = effects.playerStates[0];
          if (first === undefined) throw new Error('expected a player state');
          const original = first.playerVersionId;
          return {
            ...effects,
            playerStates: [
              { ...first, playerVersionId: stranger },
              ...effects.playerStates.slice(1),
            ],
            pairStates: effects.pairStates.map((pair) =>
              pair.a === original
                ? { ...pair, a: stranger }
                : pair.b === original
                  ? { ...pair, b: stranger }
                  : pair,
            ),
          };
        },
      ],
    ];

    for (const [name, mutate] of cases) {
      await corruptStoredEffects(adapters, mutate);
      await expect(repo.loadActiveRun(), name).rejects.toThrow(SeasonRunLoadError);
    }
  });
});

describe('season run migration', () => {
  afterEach(restoreIndexedDb);

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

describe('season run M2.5 pending blocks (v5)', () => {
  function pendingFor(
    adapters: Adapters,
    blockIndex = 0,
    overrides: Partial<SeasonPendingBlockCandidate> = {},
  ): SeasonPendingBlockCandidate {
    return buildFixturePendingBlock({
      run: adapters.run,
      commandId: `command-${String(blockIndex)}`,
      blockIndex,
      expectedRevision: blockIndex,
      expectedStateRevision: blockIndex,
      expectedStateDigest: adapters.run.stateDigest,
      nextGameId: `s${String(blockIndex * 150 + 16).padStart(6, '0')}`,
      ...overrides,
    });
  }

  it('round-trips a pending block through save, load, and discard', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    await promote(adapters);
    const pending = pendingFor(adapters);
    await repo.savePendingBlock(
      pending,
      buildFixtureInterruption({
        runId: run.runId,
        blockIndex: 0,
        commandId: 'command-0',
        nextGameId: pending.nextGameId,
      }),
    );
    expect(await db.seasonPendingBlocks.count()).toBe(1);
    const loaded = await repo.loadPendingBlock(run.runId);
    expect(loaded).not.toBeNull();
    expect(loaded?.blockIndex).toBe(0);
    expect(loaded?.nextGameId).toBe(pending.nextGameId);
    expect(loaded?.expectedStateDigest).toBe(run.stateDigest);
    await repo.discardPendingBlock(run.runId);
    expect(await repo.loadPendingBlock(run.runId)).toBeNull();
    expect(await db.seasonPendingBlocks.count()).toBe(0);
  });

  it('rejects a pending save when the cursor advanced past the pending block', async () => {
    const adapters = makeAdapters();
    const { repo } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    const pending = pendingFor(adapters, 1);
    await expect(
      repo.savePendingBlock(
        pending,
        buildFixtureInterruption({
          runId: adapters.run.runId,
          blockIndex: 1,
          commandId: 'command-1',
          nextGameId: pending.nextGameId,
        }),
      ),
    ).rejects.toThrow(SeasonPendingBlockRejectedError);
    await expect(
      repo.savePendingBlock(
        pendingFor(adapters, 0),
        buildFixtureInterruption({
          runId: adapters.run.runId,
          blockIndex: 0,
          commandId: 'command-0',
          nextGameId: 's000016',
        }),
      ),
    ).rejects.toThrow(SeasonPendingBlockRejectedError);
  });

  it('rejects a pending save with stale expected state facts or a mismatched run', async () => {
    const adapters = makeAdapters();
    const { repo, run } = adapters;
    await promote(adapters);
    const interruption = buildFixtureInterruption({
      runId: run.runId,
      blockIndex: 0,
      commandId: 'command-0',
      nextGameId: 's000016',
    });
    await expect(
      repo.savePendingBlock({ ...pendingFor(adapters), expectedStateRevision: 1 }, interruption),
    ).rejects.toThrow(SeasonPendingBlockRejectedError);
    await expect(
      repo.savePendingBlock(
        { ...pendingFor(adapters), expectedStateDigest: 'f'.repeat(32) },
        interruption,
      ),
    ).rejects.toThrow(SeasonPendingBlockRejectedError);
    await expect(
      repo.savePendingBlock({ ...pendingFor(adapters), runId: 'other-run' }, interruption),
    ).rejects.toThrow(SeasonPendingBlockRejectedError);
  });

  it('a pending block survives a full validated reload', async () => {
    const adapters = makeAdapters();
    const { repo, run } = adapters;
    await promote(adapters);
    const pending = pendingFor(adapters);
    await repo.savePendingBlock(
      pending,
      buildFixtureInterruption({
        runId: run.runId,
        blockIndex: 0,
        commandId: 'command-0',
        nextGameId: pending.nextGameId,
      }),
    );
    const snapshot = await repo.loadActiveRun();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.acceptedBlocks).toHaveLength(0);
    expect((await repo.loadPendingBlock(run.runId))?.nextGameId).toBe(pending.nextGameId);
  });

  it('resume commits atomically and deletes the pending row', async () => {
    const adapters = makeAdapters();
    const { db, repo, run, blocks } = adapters;
    await promote(adapters);
    const block = blocks[0];
    if (block === undefined) throw new Error('expected fixture block 0');
    // Interruption after 60 of the block's 150 games.
    const partial = block.summaries.slice(0, 60);
    const pending = buildFixturePendingBlock({
      run,
      commandId: 'command-0',
      blockIndex: 0,
      expectedRevision: 0,
      expectedStateRevision: 0,
      expectedStateDigest: run.stateDigest,
      nextGameId: 's000061',
      summaries: partial,
    });
    await repo.savePendingBlock(
      pending,
      buildFixtureInterruption({
        runId: run.runId,
        blockIndex: 0,
        commandId: 'command-0',
        nextGameId: 's000061',
      }),
    );
    expect(await db.seasonPendingBlocks.count()).toBe(1);
    // Resume completes the block: the pending's partial summaries plus the
    // remaining games form the full block (the union, no duplicates).
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    expect(await db.seasonPendingBlocks.count()).toBe(0);
    expect(await repo.loadPendingBlock(run.runId)).toBeNull();
    const summaries = await repo.loadBlockSummaries(run.runId, 0);
    expect(summaries).toHaveLength(150);
    expect(new Set(summaries.map((summary) => summary.gameId))).toEqual(
      new Set(block.summaries.map((summary) => summary.gameId)),
    );
    expect(summaries.map((summary) => summary.gameId)).toEqual(
      block.summaries.map((summary) => summary.gameId),
    );
  });

  it('an interrupted-resumed block equals an uninterrupted block with no duplicates', async () => {
    const uninterrupted = makeAdapters();
    await promote(uninterrupted);
    await uninterrupted.repo.commitSeasonBlock(commitInputFor(uninterrupted, 0));

    const resumed = makeAdapters();
    await promote(resumed);
    const block = resumed.blocks[0];
    if (block === undefined) throw new Error('expected fixture block 0');
    const partial = block.summaries.slice(0, 40);
    const pending = buildFixturePendingBlock({
      run: resumed.run,
      commandId: 'command-0',
      blockIndex: 0,
      expectedRevision: 0,
      expectedStateRevision: 0,
      expectedStateDigest: resumed.run.stateDigest,
      nextGameId: 's000041',
      summaries: partial,
    });
    await resumed.repo.savePendingBlock(
      pending,
      buildFixtureInterruption({
        runId: resumed.run.runId,
        blockIndex: 0,
        commandId: 'command-0',
        nextGameId: 's000041',
      }),
    );
    await resumed.repo.commitSeasonBlock(commitInputFor(resumed, 0));

    const a = (await uninterrupted.repo.loadBlockSummaries(uninterrupted.run.runId, 0)).map(
      (summary) => summary.gameId,
    );
    const b = (await resumed.repo.loadBlockSummaries(resumed.run.runId, 0)).map(
      (summary) => summary.gameId,
    );
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(150);
  });

  it('clearSeasonRun deletes the pending row too', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    await promote(adapters);
    const pending = pendingFor(adapters);
    await repo.savePendingBlock(
      pending,
      buildFixtureInterruption({
        runId: run.runId,
        blockIndex: 0,
        commandId: 'command-0',
        nextGameId: pending.nextGameId,
      }),
    );
    expect(await db.seasonPendingBlocks.count()).toBe(1);
    await repo.clearSeasonRun(run.runId);
    expect(await db.seasonPendingBlocks.count()).toBe(0);
  });
});

describe('season run M2.5 command application (v5)', () => {
  function selectObjectiveCommand(
    adapters: Adapters,
    overrides: Partial<SeasonRunCommand> = {},
  ): SeasonRunCommand {
    return {
      schemaVersion: 7,
      command: 'select-block-objective',
      commandId: 'cmd-select-0',
      runId: adapters.run.runId,
      expectedStateRevision: 0,
      expectedStateDigest: adapters.run.stateDigest,
      blockIndex: 0,
      objectiveId: 'win-six',
      ...overrides,
    } as SeasonRunCommand;
  }

  /** The engine-produced post-command run (objective selected, revision +1). */
  function postCommandRun(adapters: Adapters): SeasonRun {
    const { run } = adapters;
    const objectives = {
      ...run.objectives,
      selections: {
        0: { objectiveId: 'win-six' as const, selectedByCommandId: 'cmd-select-0', success: null },
      },
    };
    return {
      ...run,
      objectives,
      stateRevision: 1,
      stateDigest: buildFixtureStateDigest(run, { stateRevision: 1, objectives }),
    };
  }

  it('applies a command atomically and reloads with the audit passing', async () => {
    const adapters = makeAdapters();
    const { repo, run } = adapters;
    await promote(adapters);
    await repo.applySeasonRunCommand({
      runId: run.runId,
      command: selectObjectiveCommand(adapters),
      run: postCommandRun(adapters),
      pending: null,
    });
    const snapshot = await repo.loadActiveRun();
    expect(snapshot?.run.stateRevision).toBe(1);
    expect(snapshot?.run.objectives.selections[0]?.objectiveId).toBe('win-six');
    expect(snapshot?.run.checkpointState).toBeNull();
  });

  it('rejects a stale command (revision and digest) and a run mismatch', async () => {
    const adapters = makeAdapters();
    const { repo, run } = adapters;
    await promote(adapters);
    await expect(
      repo.applySeasonRunCommand({
        runId: run.runId,
        command: selectObjectiveCommand(adapters, { expectedStateRevision: 3 }),
        run: postCommandRun(adapters),
        pending: null,
      }),
    ).rejects.toThrow(SeasonRunCommandStaleStateError);
    await expect(
      repo.applySeasonRunCommand({
        runId: run.runId,
        command: selectObjectiveCommand(adapters, { expectedStateDigest: 'f'.repeat(32) }),
        run: postCommandRun(adapters),
        pending: null,
      }),
    ).rejects.toThrow(SeasonRunCommandStaleStateError);
    await expect(
      repo.applySeasonRunCommand({
        runId: 'other-run',
        command: selectObjectiveCommand(adapters),
        run: postCommandRun(adapters),
        pending: null,
      }),
    ).rejects.toThrow(SeasonRunCommandRunMismatchError);
  });

  it('rejects duplicate command ids from the recorded history', async () => {
    const adapters = makeAdapters();
    const { repo, run } = adapters;
    await promote(adapters);
    const command = selectObjectiveCommand(adapters);
    await repo.applySeasonRunCommand({
      runId: run.runId,
      command,
      run: postCommandRun(adapters),
      pending: null,
    });
    // The same command id again (with the now-current state facts): the id
    // is already recorded via the objective selection.
    await expect(
      repo.applySeasonRunCommand({
        runId: run.runId,
        command: {
          ...command,
          expectedStateRevision: 1,
          expectedStateDigest: postCommandRun(adapters).stateDigest,
        },
        run: postCommandRun(adapters),
        pending: null,
      }),
    ).rejects.toThrow(SeasonRunCommandDuplicateError);
  });

  it('rejects a command id that collides with the last accepted block command', async () => {
    const adapters = makeAdapters();
    const { repo, run, blocks } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    const blockState = blocks[0]?.checkpointState;
    if (blockState === undefined) throw new Error('expected fixture checkpoint state');
    await expect(
      repo.applySeasonRunCommand({
        runId: run.runId,
        command: selectObjectiveCommand(adapters, {
          commandId: 'command-0',
          expectedStateRevision: 1,
          expectedStateDigest: blocks[0]?.stateDigest ?? '0'.repeat(32),
        }),
        run: postCommandRun(adapters),
        pending: null,
      }),
    ).rejects.toThrow(SeasonRunCommandDuplicateError);
    void blockState;
  });

  it('a command with a non-null pending preserves the recorded interruption', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    await promote(adapters);
    const pending = buildFixturePendingBlock({
      run,
      commandId: 'command-0',
      blockIndex: 0,
      expectedRevision: 0,
      expectedStateRevision: 0,
      expectedStateDigest: run.stateDigest,
      nextGameId: 's000016',
    });
    await repo.savePendingBlock(
      pending,
      buildFixtureInterruption({
        runId: run.runId,
        blockIndex: 0,
        commandId: 'command-0',
        nextGameId: 's000016',
        unavailablePlayerVersionIds: ['pv-' + '1'.repeat(32)],
      }),
    );
    // A forfeit command advances the pending to the next game.
    const advanced = { ...pending, nextGameId: 's000017' };
    await repo.applySeasonRunCommand({
      runId: run.runId,
      command: selectObjectiveCommand(adapters),
      run: postCommandRun(adapters),
      pending: advanced,
    });
    const row = await db.seasonPendingBlocks.get(run.runId);
    expect(row?.interruption.nextGameId).toBe('s000017');
    expect(row?.interruption.unavailablePlayerVersionIds).toEqual(['pv-' + '1'.repeat(32)]);
  });
});

describe('season run M2.5 reload audit (v5)', () => {
  async function currentRow(
    adapters: Adapters,
  ): Promise<import('../schemas/season-run-record.ts').StoredSeasonRunRecord> {
    const row = await adapters.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (
      row === undefined ||
      (row as { saveSchemaVersion?: unknown }).saveSchemaVersion !== SEASON_RUN_SAVE_SCHEMA_VERSION
    ) {
      throw new Error('expected a current v5 checkpoint row');
    }
    return row;
  }

  it('rejects a stateDigest that does not recompute over the stored facts', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    const row = await currentRow(adapters);
    await db.seasonRuns.put({ ...row, stateDigest: 'f'.repeat(32) });
    await expect(repo.loadActiveRun()).rejects.toThrow(/stateDigest/);
  });

  it('rejects a stateRevision regression behind the last accepted block', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    const row = await currentRow(adapters);
    await db.seasonRuns.put({ ...row, stateRevision: 0 });
    await expect(repo.loadActiveRun()).rejects.toThrow(/stateRevision/);
  });

  it('rejects an Influence balance that does not reconcile from the ledger', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    const row = await currentRow(adapters);
    await db.seasonRuns.put({
      ...row,
      influence: { ...row.influence, balances: { ...row.influence.balances, lakers: 3 } },
    });
    await expect(repo.loadActiveRun()).rejects.toThrow(/recomputes/);
  });

  it('rejects a ledger entry whose balanceAfter does not reconcile', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    const row = await currentRow(adapters);
    const ledger = row.influence.ledger.map((entry, index) =>
      index === 0 ? { ...entry, balanceAfter: 5 } : entry,
    );
    await db.seasonRuns.put({ ...row, influence: { ...row.influence, ledger } });
    await expect(repo.loadActiveRun()).rejects.toThrow(/does not reconcile/);
  });

  it('rejects health injuries referencing unknown players or games', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    const row = await currentRow(adapters);
    const injury = {
      injuryId: 'inj-' + 'a'.repeat(32),
      playerVersionId: 'pv-' + 'f'.repeat(32),
      franchiseId: 'lakers',
      gameId: 's000001',
      type: 'lower-body' as const,
      severity: 'minor' as const,
      occurredBeforeHalftime: false,
      sameGameReturn: false,
      sameGameReturned: null,
      missedGamesTotal: 1,
      missedGamesRemaining: 1,
      actualReturnRound: null,
      seasonEnding: false,
      rehabModifier: 0 as const,
      recurrenceWindowRoundsRemaining: 0,
      seedPath: ['fixture'],
    };
    await db.seasonRuns.put({ ...row, health: { ...row.health, injuries: [injury] } });
    await expect(repo.loadActiveRun()).rejects.toThrow(/outside the 30 rosters/);
  });

  it('rejects a transaction entry applied beyond the stored stateRevision', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    const row = await currentRow(adapters);
    await db.seasonRuns.put({
      ...row,
      transactions: [
        {
          transactionId: 'tx-fake',
          commandId: null,
          franchiseId: null,
          type: 'initial-grant',
          blockIndex: null,
          appliedAtStateRevision: 5,
          payload: {},
          explanation: 'fake entry',
        },
      ],
    });
    await expect(repo.loadActiveRun()).rejects.toThrow(/exceeds the stored stateRevision/);
  });

  it('rejects a checkpointState that does not match the last accepted block', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    const row = await currentRow(adapters);
    const blockState = adapters.blocks[0]?.checkpointState;
    if (blockState === undefined) throw new Error('expected fixture checkpoint state');
    await db.seasonRuns.put({
      ...row,
      checkpointState: { ...blockState, commandId: 'other-command' },
    });
    await expect(repo.loadActiveRun()).rejects.toThrow(/checkpointState/);
  });

  it('rejects a pending row for an already committed blockIndex', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    const pending = buildFixturePendingBlock({
      run,
      commandId: 'command-0',
      blockIndex: 0,
      expectedRevision: 0,
      expectedStateRevision: 0,
      expectedStateDigest: run.stateDigest,
      nextGameId: 's000016',
    });
    // The repo guard rejects this via savePendingBlock; a row written
    // directly (corruption) is caught by the reload audit.
    await db.seasonPendingBlocks.put({
      runId: run.runId,
      block: pending,
      interruption: {
        code: 'invalid-roster',
        runId: run.runId,
        blockIndex: 0,
        commandId: 'command-0',
        nextGameId: 's000016',
        humanFranchiseId: 'lakers',
        unavailablePlayerVersionIds: ['pv-' + '1'.repeat(32)],
      },
    });
    await expect(repo.loadActiveRun()).rejects.toThrow(/already committed/);
  });

  it('commit rejects stale expected state facts and non-advancing stateRevision', async () => {
    const adapters = makeAdapters();
    const { repo } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    await expect(
      repo.commitSeasonBlock({ ...commitInputFor(adapters, 1), expectedStateRevision: 5 }),
    ).rejects.toThrow(/stale expectedStateRevision/);
    await expect(
      repo.commitSeasonBlock({
        ...commitInputFor(adapters, 1),
        expectedStateDigest: 'f'.repeat(32),
      }),
    ).rejects.toThrow(/stale expectedStateDigest/);
    await expect(
      repo.commitSeasonBlock({ ...commitInputFor(adapters, 1), stateRevision: 1 }),
    ).rejects.toThrow(/does not advance/);
    expect((await repo.loadActiveRun())?.acceptedBlocks).toHaveLength(1);
  });

  it('a stored save-schema-v3 row (M2.4) is reported typed incompatible and preserved', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    const fixture = buildFixtureRun({ runId: run.runId });
    const { games: _games, ...runWithoutGames } = fixture;
    // The fixture run now carries the schema-8 minute-policy shape; a
    // genuine M2.4-era row stores a schema-7 run under save schema 3.
    const legacyRun = {
      ...runWithoutGames,
      schemaVersion: 7,
      versions: { ...runWithoutGames.versions, runSchemaVersion: 7 },
    };
    const row = {
      recordId: SEASON_RUN_RECORD_ID,
      saveSchemaVersion: 3,
      run: legacyRun,
      completedRounds: 0,
      revision: 0,
      lastCommandId: null,
      lastRotationDigest: null,
      lastCheckpointDigest: null,
      standings: fixture.standings,
      teamAggregates: [],
      playerAggregates: [],
      recap: null,
      effects: buildFixtureEffectsState(fixture.rosters),
    };
    await db.seasonRuns.put(row as never);
    await expect(repo.loadActiveRun()).rejects.toMatchObject({
      name: 'SeasonRunIncompatibleError',
      info: {
        storedSaveSchemaVersion: SEASON_RUN_SAVE_SCHEMA_VERSION,
        storedRunSchemaVersion: 7,
      },
    });
    expect(await db.seasonRuns.count()).toBe(1);
  });
});
