import { describe, expect, it } from 'vitest';
import {
  SEASON_RUN_SAVE_SCHEMA_VERSION,
  commandIdSchema,
  franchiseIdSchema,
  seasonRunCommandSchema,
  type SeasonCampaignOpportunity,
  type SeasonEffectsState,
  type SeasonPendingBlockCandidate,
  type SeasonRun,
  type SeasonRunCommand,
} from '@hoop-rush/data-contracts';
import { SEASON_RUN_RECORD_ID } from '../schemas/season-run-record.ts';
import { challengeRunProgressDigest } from '@hoop-rush/engine';
import { DexieChallengeRepository } from './dexie.ts';
import { DexieSeasonDraftRepository } from './season-draft.ts';
import { DexieSeasonRunRepository, SeasonRunLoadError } from './season-run-dexie.ts';
import { TestDatabase, testDatabaseName } from '../testing/repo-test-support.ts';
import {
  buildFixtureEffectsState,
  buildFixtureInterruption,
  buildFixturePendingBlock,
  buildFixtureRun,
  buildFixtureStateDigest,
  buildFixtureStoredDraft,
  buildStubSeasonEngineSeam,
} from '../testing/season-run-fixture.ts';
import { buildEmptyCampaignState } from '@hoop-rush/engine';
import { applySeasonBlockInfluenceGrants } from '@hoop-rush/engine';
import { buildFullSeasonDataset } from '../benchmark/season-run.ts';
import {
  SeasonPendingBlockRejectedError,
  SeasonRunCommandRunMismatchError,
  SeasonRunCommandStaleStateError,
  type CommitSeasonBlockInput,
} from './season-run.ts';
import { buildChallengeRun } from '@hoop-rush/test-fixtures';
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
const sharedDataset = buildFullSeasonDataset({
  seam: buildStubSeasonEngineSeam(),
  runId: 'season-run-contract-test',
});
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
    freeAgency: dataset.run.freeAgency,
  };
}
function lockedRotationSet(dataset: Pick<Adapters, 'run'>): SeasonRun['rotations'] {
  return dataset.run.rotations.map((rotation) =>
    rotation.franchiseId === 'lakers'
      ? {
          ...rotation,
          targetMinutes: rotation.targetMinutes.map((row, index) => ({
            ...row,
            minutes: index < 5 ? 38 : 10,
          })),
        }
      : rotation,
  );
}
async function promote(adapters: Adapters): Promise<void> {
  await adapters.repo.promoteSeasonDraftToRun(buildFixtureStoredDraft(adapters.run), adapters.run);
  const snapshot = await adapters.repo.loadActiveRun();
  if (snapshot === null) throw new Error('expected promoted run');
  Object.assign(adapters.run, snapshot.run);
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
    await expect(bare.loadActiveRun()).rejects.toMatchObject({
      name: 'SeasonRunLoadError',
      code: 'SEASON_RUN_SCHEDULE_UNAVAILABLE',
    });
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
  it('a failure inside the transaction rolls back the entire block', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    const input = commitInputFor(adapters, 0);
    const firstSummary = input.summaries[0];
    if (firstSummary === undefined) throw new Error('expected a fixture summary');
    const invalid = {
      ...input,
      summaries: [{ ...firstSummary, round: 999 }],
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
  it('surfaces a corrupt stored summary row on load', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    const row = (await db.seasonRunSummaries.toArray())[0];
    if (row === undefined) throw new Error('expected a stored summary row');
    await db.seasonRunSummaries.put({ ...row, summary: { corrupted: true } } as never);
    await expect(repo.loadActiveRun()).rejects.toMatchObject({
      name: 'SeasonRunLoadError',
      code: 'SEASON_RUN_STATE_VALIDATION_FAILED',
    });
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
      (
        row as {
          saveSchemaVersion?: unknown;
        }
      ).saveSchemaVersion !== SEASON_RUN_SAVE_SCHEMA_VERSION
    ) {
      throw new Error('expected a current v5 checkpoint row');
    }
    await db.seasonRuns.put({ ...row, revision: 5 });
    await expect(repo.loadActiveRun()).rejects.toThrow(/revision/);
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
  it('forceClearActiveSeasonRun removes corrupt saves without a matching runId', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    await expect(repo.clearSeasonRun('other-run')).rejects.toThrow(/does not match/);
    await repo.forceClearActiveSeasonRun();
    expect(await db.seasonRuns.count()).toBe(0);
    expect(await db.seasonRunIndex.count()).toBe(0);
    expect(await db.seasonRunSummaries.count()).toBe(0);
    expect(await db.seasonRunDetails.count()).toBe(0);
    expect(await db.seasonRunBlocks.count()).toBe(0);
    expect(await repo.loadActiveRunIndex()).toBeNull();
    expect(await repo.loadActiveRun()).toBeNull();
  });
  it('a full nine-block season reloads with reconciled standings and aggregates', async () => {
    const adapters = makeAdapters();
    const { repo, blocks } = adapters;
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
  });
});
describe('season run unsupported-version handling', () => {
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
  async function currentCheckpoint(
    adapters: Adapters,
  ): Promise<import('../schemas/season-run-record.ts').StoredSeasonRunRecord> {
    const row = await adapters.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (
      row === undefined ||
      (
        row as {
          saveSchemaVersion?: unknown;
        }
      ).saveSchemaVersion !== SEASON_RUN_SAVE_SCHEMA_VERSION
    ) {
      throw new Error('expected a current v5 checkpoint row');
    }
    return row;
  }
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
  it('rejects a stored v1 row as an unsupported version on every load path', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    await db.seasonRuns.put(developmentV1Row(run.runId) as never);
    await expect(repo.loadActiveRun()).rejects.toMatchObject({
      name: 'SeasonRunLoadError',
      code: 'SEASON_RUN_VERSION_UNSUPPORTED',
    });
    expect(await db.seasonRuns.count()).toBe(1);
    await expect(repo.loadActiveRunWithSchedule(adapters.schedule)).rejects.toMatchObject({
      name: 'SeasonRunLoadError',
      code: 'SEASON_RUN_VERSION_UNSUPPORTED',
    });
    expect(await db.seasonRuns.count()).toBe(1);
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
              { ...first, fatigueBasisPoints: 10001 },
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
            pairStates: [{ ...first, sharedPossessions: 10000001 }, ...effects.pairStates.slice(1)],
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
  it('resume commits atomically and deletes the pending row', async () => {
    const adapters = makeAdapters();
    const { db, repo, run, blocks } = adapters;
    await promote(adapters);
    const block = blocks[0];
    if (block === undefined) throw new Error('expected fixture block 0');
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
});
describe('season run M2.5 command application (v5)', () => {
  function fixedCampaignOffers(
    blockIndex: number,
  ): [SeasonCampaignOpportunity, SeasonCampaignOpportunity] {
    const offerOf = (slot: 0 | 1): SeasonCampaignOpportunity => {
      const suffix = String(blockIndex * 2 + slot + 1).padStart(8, '0');
      return {
        opportunityId: `copp-${suffix}`,
        branchId: `cbr-${suffix}`,
        templateId: `ctpl-${suffix}`,
        blockIndex,
        identity: 'win-now',
        family: 'results',
        prerequisiteId: null,
        target: { kind: 'block-wins', comparisonOperator: 'gte', threshold: 6, window: 'block' },
        breakthrough: null,
        completedReward: { rewardId: `rew-${suffix}`, type: 'influence', amount: 1 },
        breakthroughReward: null,
        feasibilityFacts: {},
        seedPath: ['campaign', String(blockIndex), 'offers', String(slot)],
      };
    };
    return [offerOf(0), offerOf(1)];
  }
  function block0Offers(): [SeasonCampaignOpportunity, SeasonCampaignOpportunity] {
    return fixedCampaignOffers(0);
  }
  function firstCampaignOffer(): SeasonCampaignOpportunity {
    return block0Offers()[0];
  }
  function selectCampaignCommand(
    adapters: Adapters,
    overrides: Partial<SeasonRunCommand> = {},
  ): SeasonRunCommand {
    const offer = firstCampaignOffer();
    return seasonRunCommandSchema.parse({
      schemaVersion: 11,
      command: 'select-campaign-opportunity',
      commandId: commandIdSchema.parse('cmd-select-0'),
      runId: adapters.run.runId,
      expectedStateRevision: adapters.run.stateRevision,
      expectedStateDigest: adapters.run.stateDigest,
      blockIndex: 0,
      opportunityId: offer.opportunityId,
      ...overrides,
    });
  }
  function postCommandRun(adapters: Adapters): SeasonRun {
    const { run } = adapters;
    const offers = block0Offers();
    const offer = firstCampaignOffer();
    const campaign = {
      ...(run.campaign ?? buildEmptyCampaignState()),
      offers: { ...(run.campaign?.offers ?? {}), 0: offers },
      selections: {
        0: {
          opportunityId: offer.opportunityId,
          selectedByCommandId: commandIdSchema.parse('cmd-select-0'),
        },
      },
    };
    return {
      ...run,
      campaign,
      stateRevision: run.stateRevision + 1,
      stateDigest: buildFixtureStateDigest(run, {
        stateRevision: run.stateRevision + 1,
        campaign,
      }),
    };
  }
  it('applies a command atomically and reloads with the audit passing', async () => {
    const adapters = makeAdapters();
    const { repo, run } = adapters;
    await promote(adapters);
    const offer = firstCampaignOffer();
    await repo.applySeasonRunCommand({
      runId: run.runId,
      command: selectCampaignCommand(adapters),
      run: postCommandRun(adapters),
      pending: null,
    });
    const snapshot = await repo.loadActiveRun();
    expect(snapshot?.run.stateRevision).toBe(1);
    expect(snapshot?.run.campaign?.selections[0]?.opportunityId).toBe(offer.opportunityId);
    expect(snapshot?.run.checkpointState).toBeNull();
  });
  it('rejects a stale command (revision and digest) and a run mismatch', async () => {
    const adapters = makeAdapters();
    const { repo, run } = adapters;
    await promote(adapters);
    await expect(
      repo.applySeasonRunCommand({
        runId: run.runId,
        command: selectCampaignCommand(adapters, { expectedStateRevision: 3 }),
        run: postCommandRun(adapters),
        pending: null,
      }),
    ).rejects.toThrow(SeasonRunCommandStaleStateError);
    await expect(
      repo.applySeasonRunCommand({
        runId: run.runId,
        command: selectCampaignCommand(adapters, { expectedStateDigest: 'f'.repeat(32) }),
        run: postCommandRun(adapters),
        pending: null,
      }),
    ).rejects.toThrow(SeasonRunCommandStaleStateError);
    await expect(
      repo.applySeasonRunCommand({
        runId: 'other-run',
        command: selectCampaignCommand(adapters),
        run: postCommandRun(adapters),
        pending: null,
      }),
    ).rejects.toThrow(SeasonRunCommandRunMismatchError);
  });
});
describe('season run M2.5 reload audit (v5)', () => {
  async function currentRow(
    adapters: Adapters,
  ): Promise<import('../schemas/season-run-record.ts').StoredSeasonRunRecord> {
    const row = await adapters.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (
      row === undefined ||
      (
        row as {
          saveSchemaVersion?: unknown;
        }
      ).saveSchemaVersion !== SEASON_RUN_SAVE_SCHEMA_VERSION
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
  it('rejects a block missing a game summary without touching the good checkpoint', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    const base = commitInputFor(adapters, 0);
    await expect(
      repo.commitSeasonBlock({ ...base, summaries: base.summaries.slice(1) }),
    ).rejects.toThrow(/exactly 150 summaries/);
    expect(await db.seasonRunSummaries.count()).toBe(0);
    expect(await db.seasonRunBlocks.count()).toBe(0);
    const snapshot = await repo.loadActiveRun();
    expect(snapshot?.acceptedBlocks).toHaveLength(0);
    expect(snapshot?.run.cursor.completedRounds).toBe(0);
  });
  it('stores the post-commit revision when a trade window is behind the free-agency bump', async () => {
    const adapters = makeAdapters();
    const { repo, run } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    await repo.commitSeasonBlock(commitInputFor(adapters, 1));
    const base = commitInputFor(adapters, 2);
    const trade = {
      schemaVersion: 1 as const,
      tradeVersion: 'season-trade-v7' as const,
      windows: [
        {
          windowIndex: 0,
          blockIndex: 2,
          status: 'open' as const,
          offers: [],
        },
      ],
    };
    const postCommitRevision = base.stateRevision + 1;
    const postCommitDigest = buildFixtureStateDigest(run, {
      stateRevision: postCommitRevision,
      checkpointState: base.checkpointState,
      health: base.health,
      influence: base.influence,
      transactions: base.transactions,
      trade,
      objectives: base.objectives,
      challenges: run.challenges ?? null,
      campaign: run.campaign ?? null,
      rosters: run.rosters,
      ownership: run.ownership,
      rotations: base.rotations,
      effects: base.effects,
      freeAgency: base.freeAgency,
    });
    await repo.commitSeasonBlock({
      ...base,
      trade,
      stateRevision: postCommitRevision,
      stateDigest: postCommitDigest,
      window: {
        trade,
        influence: base.influence,
        transactions: base.transactions,
        rosters: run.rosters,
        ownership: run.ownership,
        rotations: base.rotations,
        effects: base.effects,
        health: base.health,
        stateRevision: base.stateRevision,
        stateDigest: base.stateDigest,
      },
    });
    const snapshot = await repo.loadActiveRun();
    expect(snapshot?.run.stateRevision).toBe(postCommitRevision);
    expect(snapshot?.run.stateDigest).toBe(postCommitDigest);
  });
  it('accepts a commit whose digest covers the locked rotation set the commit stores', async () => {
    const adapters = makeAdapters();
    const { repo, run } = adapters;
    await promote(adapters);
    const base = commitInputFor(adapters, 0);
    const locked = lockedRotationSet(adapters);
    expect(adapters.seam.seasonRotationSetDigest(locked)).not.toBe(
      adapters.seam.seasonRotationSetDigest(run.rotations),
    );
    const checkpointState = {
      ...base.checkpointState,
      rotationDigest: adapters.seam.seasonRotationSetDigest(locked),
    };
    const digestOverLocked = adapters.seam.seasonRunStateDigest({
      stateRevision: base.stateRevision,
      stage: run.stage,
      postseason: run.postseason,
      awards: run.awards,
      completion: run.completion,
      checkpointState,
      health: base.health,
      influence: base.influence,
      transactions: base.transactions,
      trade: base.trade,
      objectives: base.objectives,
      challenges: run.challenges ?? null,
      campaign: run.campaign ?? null,
      rosters: run.rosters,
      ownership: run.ownership,
      rotations: locked,
      effects: base.effects,
      freeAgency: run.freeAgency,
      authority: run.authority,
    });
    await repo.commitSeasonBlock({
      ...base,
      checkpointState,
      rotations: locked,
      rotationDigest: adapters.seam.seasonRotationSetDigest(locked),
      stateDigest: digestOverLocked,
    });
    const snapshot = await repo.loadActiveRun();
    expect(snapshot?.acceptedBlocks).toHaveLength(1);
    expect(snapshot?.run.rotations).toEqual(locked);
  });
  it('rejects an Influence balance that does not reconcile from the ledger', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    const row = await currentRow(adapters);
    const lakersBalanceKey = franchiseIdSchema.parse('lakers');
    await db.seasonRuns.put({
      ...row,
      influence: {
        ...row.influence,
        balances: { ...row.influence.balances, [lakersBalanceKey]: 3 },
      },
    });
    await expect(repo.loadActiveRun()).rejects.toThrow(/recomputes/);
  });
  it('accepts a valid partially capped challenge reward', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    await promote(adapters);
    const row = await currentRow(adapters);
    let influence = row.influence;
    for (let blockIndex = 0; blockIndex < 2; blockIndex += 1) {
      influence = applySeasonBlockInfluenceGrants({
        influence,
        blockIndex,
        humanFranchiseId: 'pelicans',
        challengeSuccesses:
          blockIndex === 1 ? [{ challengeId: 'beat-leader', success: true, reward: 2 }] : [],
      }).influence;
    }
    influence = applySeasonBlockInfluenceGrants({
      influence,
      blockIndex: 2,
      humanFranchiseId: 'pelicans',
      challengeSuccesses: [{ challengeId: 'beat-higher', success: true, reward: 2 }],
    }).influence;
    const entry = influence.ledger.find(
      (candidate) => candidate.entryId === 'influence-challenge-2-pelicans-beat-higher',
    );
    const stateDigest = adapters.seam.seasonRunStateDigest({
      stateRevision: row.stateRevision,
      stage: row.run.stage,
      postseason: row.run.postseason,
      awards: row.run.awards,
      completion: row.run.completion,
      checkpointState: row.checkpointState,
      health: row.health,
      influence,
      transactions: row.transactions,
      trade: row.trade,
      objectives: row.objectives,
      challenges: row.challenges ?? adapters.run.challenges ?? null,
      campaign: row.campaign ?? adapters.run.campaign ?? null,
      rosters: row.run.rosters,
      ownership: row.run.ownership,
      rotations: row.run.rotations,
      effects: row.effects,
      freeAgency: row.run.freeAgency,
      authority: row.run.authority,
    });
    await db.seasonRuns.put({ ...row, influence, stateDigest });
    const snapshot = await repo.loadActiveRun();
    expect(entry?.requestedDelta).toBe(2);
    expect(entry?.appliedDelta).toBe(1);
    expect(snapshot?.run.influence.balances[franchiseIdSchema.parse('pelicans')]).toBe(8);
  });
});
describe('classic run promotion compare-and-swap', () => {
  function classicRecord(runId: string) {
    const run = buildChallengeRun({
      runId,
      status: 'finished',
      firstLossGameNumber: 1,
    });
    return {
      run,
      record: { recordId: 'active', saveSchemaVersion: 2 as const, run },
      index: {
        recordId: runId,
        runId,
        mode: run.mode,
        variant: run.variant,
        franchiseId: run.franchiseId,
        eraId: run.eraId,
        playerIds: run.playerIds,
        runSeed: run.runSeed,
        wins: 0,
        losses: 0,
        gamesPlayed: 1,
        outcome: 'eliminated' as const,
        completedAtIso: '2026-01-01T00:00:00.000Z',
      },
    };
  }
  it('promotes a finished classic run under matching games/digest facts', async () => {
    const { db, challenge } = makeAdapters();
    const { run, record, index } = classicRecord('classic-cas-run');
    await challenge.saveActiveRun(record);
    await challenge.promoteActiveToCompleted(record, index, {
      expectedGamesPlayed: 0,
      expectedRunDigest: challengeRunProgressDigest(run),
    });
    expect(await challenge.loadActiveRun()).toBeNull();
    const completed = await challenge.loadCompletedRun(run.runId);
    expect(completed?.run.runId).toBe(run.runId);
    expect(await db.history.count()).toBe(1);
  });
});
