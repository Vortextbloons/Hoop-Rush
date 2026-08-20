import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  playerVersionId,
  SEASON_RUN_SAVE_SCHEMA_VERSION,
  seasonCommandLogDigest,
  seasonFreeAgencyStateSchema,
  type SeasonFreeAgencyCandidate,
  type SeasonFreeAgencyDeclaration,
  type SeasonFreeAgencySigning,
  type SeasonFreeAgencyState,
  type SeasonInfluenceState,
  type SeasonRun,
  type SeasonRunCommand,
  type SeasonTransactionEntry,
} from '@hoop-rush/data-contracts';
import { SEASON_RUN_RECORD_ID } from '../schemas/season-run-record.ts';
import { buildFullSeasonDataset } from '../benchmark/season-run.ts';
import { DexieSeasonRunRepository, SeasonRunLoadError } from './season-run-dexie.ts';
import {
  SeasonRunCommandDuplicateError,
  SeasonRunCommandStaleStateError,
  type CommitSeasonBlockInput,
} from './season-run.ts';
import { TestDatabase, restoreIndexedDb, testDatabaseName } from '../testing/repo-test-support.ts';
import {
  buildFixtureEffectsState,
  buildFixtureFreeAgencyState,
  buildFixtureStateDigest,
  buildFixtureStoredDraft,
  buildStubSeasonEngineSeam,
} from '../testing/season-run-fixture.ts';

const FA_LAKERS = {
  playerVersionId: playerVersionId('p-synth-fa-lakers', 'lakers', '1990s', '1995-96'),
  playerId: 'p-synth-fa-lakers',
};
const FA_CELTICS = {
  playerVersionId: playerVersionId('p-synth-fa-celtics', 'celtics', '1990s', '1995-96'),
  playerId: 'p-synth-fa-celtics',
};

interface Adapters {
  db: TestDatabase;
  repo: DexieSeasonRunRepository;
  seam: ReturnType<typeof buildStubSeasonEngineSeam>;
  schedule: ReturnType<typeof buildFullSeasonDataset>['schedule'];
  run: ReturnType<typeof buildFullSeasonDataset>['run'];
  blocks: ReturnType<typeof buildFullSeasonDataset>['blocks'];
}

const sharedDataset = buildFullSeasonDataset({
  seam: buildStubSeasonEngineSeam(),
  runId: 'season-run-free-agency-test',
});

function makeAdapters(): Adapters {
  const db = new TestDatabase(testDatabaseName('season-free-agency'));
  const seam = buildStubSeasonEngineSeam();
  const repo = new DexieSeasonRunRepository(db, {
    schedule: sharedDataset.schedule,
    seam,
  });
  return {
    db,
    repo,
    seam,
    schedule: sharedDataset.schedule,
    run: sharedDataset.run,
    blocks: sharedDataset.blocks,
  };
}

async function promote(adapters: Adapters): Promise<void> {
  await adapters.repo.promoteSeasonDraftToRun(buildFixtureStoredDraft(adapters.run), adapters.run);
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

function faCandidate(
  versionId: string,
  playerId: string,
  band: 'featured' | 'role' | 'development' | 'emergency' = 'role',
): SeasonFreeAgencyCandidate {
  return {
    playerVersionId: versionId,
    playerId,
    displayName: `FA ${playerId}`,
    positions: {
      primary: 'SG',
      secondary: [],
      playable: ['SG'],
      normalizationVersion: 'position-normalization-v1',
    },
    band,
    minimumInfluence: 2,
    supportedRoles: ['rotation', 'depth'],
    strengths: ['fixture strength'],
    limitations: [],
    durabilityRating: 70,
    minutesPerGame: 22,
    availability: { healthy: true, notes: '' },
    catalogRef: {
      catalogVersion: 'season-draft-catalog-v4',
      dataVersion: 'fixture-data-v1',
      candidateIndex: 0,
    },
    derivationEvidence: 'fixture evidence',
    exclusionEvidence: '',
  };
}

function declarationsOf(
  run: SeasonRun,
  windowIndex: number,
): Record<string, SeasonFreeAgencyDeclaration> {
  return Object.fromEntries(
    run.league.teams.map((team) => [
      team.franchiseId,
      {
        franchiseId: team.franchiseId,
        windowIndex,
        commandId: `cmd-fa-ai-${team.franchiseId}`,
        targets: [],
      },
    ]),
  );
}

function baseFreeAgency(): SeasonFreeAgencyState {
  return buildFixtureFreeAgencyState();
}

function openWindowState(run: SeasonRun): SeasonFreeAgencyState {
  const base = baseFreeAgency();
  return seasonFreeAgencyStateSchema.parse({
    ...base,
    windows: [
      {
        windowIndex: 0,
        blockIndex: 2,
        status: 'open',
        candidates: [
          faCandidate(FA_LAKERS.playerVersionId, FA_LAKERS.playerId),
          faCandidate(FA_CELTICS.playerVersionId, FA_CELTICS.playerId),
        ],
        declarations: declarationsOf(run, 0),
        traces: [],
        signings: [],
      },
    ],
  });
}

function resolvedWindowState(
  run: SeasonRun,
  commandId: string,
  franchiseIds: readonly string[] = ['lakers', 'celtics'],
): SeasonFreeAgencyState {
  const open = openWindowState(run);
  const signingOf = (franchiseId: 'lakers' | 'celtics'): SeasonFreeAgencySigning | null => {
    const facts = franchiseId === 'lakers' ? FA_LAKERS : FA_CELTICS;
    if (!franchiseIds.includes(franchiseId)) return null;
    return {
      signingId: `signing-fa-${franchiseId}`,
      windowIndex: 0,
      franchiseId,
      playerVersionId: facts.playerVersionId,
      playerId: facts.playerId,
      band: 'role',
      roleExpectation: 'rotation',
      influenceCost: 2,
      commandId,
      seedPath: ['free-agency', '0', 'resolve', 'draw'],
      ledgerEntryId: `influence-fa-${franchiseId}`,
      transactionId: `tx-fa-${franchiseId}`,
      appliedAtStateRevision: 4,
    };
  };
  const signings = ['lakers', 'celtics']
    .map((franchiseId) => signingOf(franchiseId as 'lakers' | 'celtics'))
    .filter((signing): signing is SeasonFreeAgencySigning => signing !== null);
  const signingCounts = { ...open.signingCounts };
  const seasonSpend = { ...open.seasonSpend };
  for (const franchiseId of franchiseIds) {
    signingCounts[franchiseId] = 1;
    seasonSpend[franchiseId] = 2;
  }
  return seasonFreeAgencyStateSchema.parse({
    ...open,
    windows: [
      {
        ...(open.windows[0] as NonNullable<SeasonFreeAgencyState['windows'][number]>),
        status: 'resolved',
        signings,
      },
    ],
    signingCounts,
    seasonSpend,
  });
}

function faLedgerEntry(
  franchiseId: string,
  entryId: string,
  commandId: string,
  balanceAfter: number,
): SeasonInfluenceState['ledger'][number] {
  return {
    entryId,
    franchiseId,
    source: 'free-agent-signing',
    blockIndex: null,
    commandId,
    requestedDelta: -2,
    appliedDelta: -2,
    balanceAfter,
    explanation: 'Fixture free-agent signing debit',
  };
}

function faTransaction(
  franchiseId: string,
  transactionId: string,
  commandId: string,
  playerVersionIdValue: string,
  appliedAtStateRevision: number,
): SeasonTransactionEntry {
  return {
    transactionId,
    commandId,
    franchiseId,
    type: 'free-agent-signing',
    blockIndex: null,
    appliedAtStateRevision,
    payload: { playerVersionId: playerVersionIdValue, windowIndex: 0 },
    explanation: 'Fixture free-agent signing transaction',
  };
}

function resolveCommand(
  adapters: Adapters,
  overrides: Partial<SeasonRunCommand> = {},
): SeasonRunCommand {
  const block2 = adapters.blocks[2];
  if (block2 === undefined) throw new Error('expected fixture block 2');
  const block2Digest = buildFixtureStateDigest(adapters.run, {
    stateRevision: block2.stateRevision,
    checkpointState: block2.checkpointState,
    effects: block2.effects,
    freeAgency: openWindowState(adapters.run),
  });
  return {
    schemaVersion: 11,
    command: 'resolve-free-agent-market',
    commandId: 'cmd-resolve-fa-0',
    runId: adapters.run.runId,
    expectedStateRevision: 3,
    expectedStateDigest: block2Digest,
    windowIndex: 0,
    ...overrides,
  } as SeasonRunCommand;
}

interface ResolutionContext {
  openState: SeasonFreeAgencyState;
  block2Digest: string;
  command: SeasonRunCommand;
  run: SeasonRun;
  effects: ReturnType<typeof buildFixtureEffectsState>;
}

async function setupResolution(adapters: Adapters): Promise<ResolutionContext> {
  const { repo, run, blocks } = adapters;
  await promote(adapters);
  await repo.commitSeasonBlock(commitInputFor(adapters, 0));
  await repo.commitSeasonBlock(commitInputFor(adapters, 1));
  const block2 = blocks[2];
  if (block2 === undefined) throw new Error('expected fixture block 2');
  const openState = openWindowState(run);
  const block2Digest = buildFixtureStateDigest(run, {
    stateRevision: block2.stateRevision,
    checkpointState: block2.checkpointState,
    effects: block2.effects,
    freeAgency: openState,
  });
  await repo.commitSeasonBlock({
    ...commitInputFor(adapters, 2),
    freeAgency: openState,
    stateDigest: block2Digest,
  });

  const commandId = 'cmd-resolve-fa-0';
  const resolved = resolvedWindowState(run, commandId);
  const ledger = [
    ...run.influence.ledger,
    faLedgerEntry('lakers', 'influence-fa-lakers', commandId, 0),
    faLedgerEntry('celtics', 'influence-fa-celtics', commandId, 0),
  ];
  const influence: SeasonInfluenceState = {
    ...run.influence,
    balances: { ...run.influence.balances, lakers: 0, celtics: 0 },
    ledger,
  };
  const transactions = [
    faTransaction('lakers', 'tx-fa-lakers', commandId, FA_LAKERS.playerVersionId, 4),
    faTransaction('celtics', 'tx-fa-celtics', commandId, FA_CELTICS.playerVersionId, 4),
  ];
  const rosters = run.rosters.map((roster) => {
    if (roster.franchiseId === 'lakers') {
      return {
        ...roster,
        players: [
          ...roster.players,
          {
            playerVersionId: FA_LAKERS.playerVersionId,
            playerId: FA_LAKERS.playerId,
            franchiseId: 'lakers',
            eraId: '1990s',
            seasonKey: '1995-96',
            displayName: 'FA Lakers',
          },
        ],
      };
    }
    if (roster.franchiseId === 'celtics') {
      return {
        ...roster,
        players: [
          ...roster.players,
          {
            playerVersionId: FA_CELTICS.playerVersionId,
            playerId: FA_CELTICS.playerId,
            franchiseId: 'celtics',
            eraId: '1990s',
            seasonKey: '1995-96',
            displayName: 'FA Celtics',
          },
        ],
      };
    }
    return roster;
  });
  const ownership = [
    ...run.ownership,
    { playerVersionId: FA_LAKERS.playerVersionId, ownerFranchiseId: 'lakers' },
    { playerVersionId: FA_CELTICS.playerVersionId, ownerFranchiseId: 'celtics' },
  ];
  const stateRevision = 4;
  const stateDigest = buildFixtureStateDigest(run, {
    stateRevision,
    checkpointState: block2.checkpointState,
    influence,
    transactions,
    rosters,
    ownership,
    effects: block2.effects,
    freeAgency: resolved,
  });
  const postRun: SeasonRun = {
    ...run,
    rosters,
    ownership,
    influence,
    transactions,
    freeAgency: resolved,
    checkpointState: block2.checkpointState,
    stateRevision,
    stateDigest,
  };
  const command = resolveCommand(adapters);
  return {
    openState,
    block2Digest,
    command,
    run: postRun,
    effects: block2.effects,
  };
}

afterEach(() => {
  restoreIndexedDb();
  vi.restoreAllMocks();
});

describe('season run free-agency persistence (M2.6.5)', () => {
  it('round-trips the save-schema-7 wrapper with the free-agency state', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    await promote(adapters);
    const row = await db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    expect(row?.saveSchemaVersion).toBe(SEASON_RUN_SAVE_SCHEMA_VERSION);
    expect(row?.run.freeAgency.windows).toEqual([]);
    expect(row?.run.freeAgency.signingCounts).toHaveProperty('lakers', 0);

    const context = await setupResolution(adapters);
    await repo.applySeasonRunCommand({
      runId: run.runId,
      command: context.command,
      run: context.run,
      effects: context.effects,
      pending: null,
    });
    const stored = await db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    expect(stored?.saveSchemaVersion).toBe(SEASON_RUN_SAVE_SCHEMA_VERSION);
    expect(stored?.run.freeAgency.windows[0]?.status).toBe('resolved');
    expect(stored?.run.freeAgency.signingCounts.lakers).toBe(1);
    expect(stored?.run.freeAgency.seasonSpend.celtics).toBe(2);

    const snapshot = await repo.loadActiveRun();
    expect(snapshot?.run.freeAgency).toEqual(stored?.run.freeAgency);
  });

  it('reloads an open market that is still waiting on the human declaration', async () => {
    const adapters = makeAdapters();
    const { repo, run, blocks } = adapters;
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    await repo.commitSeasonBlock(commitInputFor(adapters, 1));
    const opened = openWindowState(run);
    const window = opened.windows[0];
    if (window === undefined) throw new Error('expected an open window');
    const { lakers: _human, ...aiDeclarations } = window.declarations;
    const pendingHuman = {
      ...opened,
      windows: [{ ...window, declarations: aiDeclarations }],
    };
    const block2 = blocks[2];
    if (block2 === undefined) throw new Error('no block 2');
    await repo.commitSeasonBlock({
      ...commitInputFor(adapters, 2),
      freeAgency: pendingHuman,
      stateDigest: buildFixtureStateDigest(run, {
        stateRevision: block2.stateRevision,
        checkpointState: block2.checkpointState,
        effects: block2.effects,
        freeAgency: pendingHuman,
      }),
    });
    const snapshot = await repo.loadActiveRun();
    expect(snapshot?.run.freeAgency.windows[0]?.status).toBe('open');
    expect(snapshot?.run.freeAgency.windows[0]?.declarations.lakers).toBeUndefined();
  });

  it('reports a stored save-schema-6 row as typed incompatible and preserves it', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    await promote(adapters);
    const row = await db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (row === undefined) throw new Error('expected the promoted checkpoint row');
    const { games: _games, ...runWithoutGames } = run;
    const legacyRow = {
      ...row,
      saveSchemaVersion: 6,
      run: {
        ...runWithoutGames,
        schemaVersion: 9,
        versions: { ...runWithoutGames.versions, runSchemaVersion: 9 },
      },
    };
    await db.seasonRuns.put(legacyRow as never);

    await expect(repo.loadActiveRun()).rejects.toMatchObject({
      name: 'SeasonRunIncompatibleError',
      info: {
        storedSaveSchemaVersion: 6,
        storedRunSchemaVersion: 9,
        runId: run.runId,
      },
    });
    expect(await db.seasonRuns.count()).toBe(1);

    await repo.clearSeasonRun(run.runId);
    expect(await db.seasonRuns.count()).toBe(0);
    expect(await repo.loadActiveRun()).toBeNull();
  });

  it('applies a multi-team resolution atomically: signings, ledger, transactions, caps, chain', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    const context = await setupResolution(adapters);

    await repo.applySeasonRunCommand({
      runId: run.runId,
      command: context.command,
      run: context.run,
      effects: context.effects,
      pending: null,
    });

    const stored = await db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (stored === undefined) throw new Error('expected the stored checkpoint row');

    const lakersRoster = stored.run.rosters.find((roster) => roster.franchiseId === 'lakers');
    const celticsRoster = stored.run.rosters.find((roster) => roster.franchiseId === 'celtics');
    expect(lakersRoster?.players).toHaveLength(11);
    expect(celticsRoster?.players).toHaveLength(11);
    expect(stored.run.ownership).toHaveLength(302);

    expect(stored.influence.balances.lakers).toBe(0);
    expect(stored.influence.balances.celtics).toBe(0);
    expect(
      stored.influence.ledger.filter((entry) => entry.source === 'free-agent-signing'),
    ).toHaveLength(2);

    expect(stored.transactions.filter((entry) => entry.type === 'free-agent-signing')).toHaveLength(
      2,
    );

    expect(stored.run.freeAgency.windows[0]?.signings).toHaveLength(2);
    expect(stored.run.freeAgency.signingCounts.lakers).toBe(1);
    expect(stored.run.freeAgency.seasonSpend.lakers).toBe(2);

    expect(stored.stateRevision).toBe(4);
    expect(stored.stateDigest).toBe(context.run.stateDigest);
    expect(stored.checkpointState?.revision).toBe(3);

    const snapshot = await repo.loadActiveRun();
    expect(snapshot?.run.stateDigest).toBe(context.run.stateDigest);
    expect(
      snapshot?.run.rosters.find((roster) => roster.franchiseId === 'lakers')?.players,
    ).toHaveLength(11);
  });

  it('a fresh repository reloads the resolved run with identical digests (reload parity)', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    const context = await setupResolution(adapters);
    await repo.applySeasonRunCommand({
      runId: run.runId,
      command: context.command,
      run: context.run,
      effects: context.effects,
      pending: null,
    });

    const fresh = new DexieSeasonRunRepository(db, {
      schedule: adapters.schedule,
      seam: adapters.seam,
    });
    const snapshot = await fresh.loadActiveRun();
    expect(snapshot?.run.stateRevision).toBe(4);
    expect(snapshot?.run.stateDigest).toBe(context.run.stateDigest);
    expect(snapshot?.run.freeAgency.windows[0]?.status).toBe('resolved');
    expect(snapshot?.acceptedBlocks.at(-1)?.stateDigest).toBe(context.block2Digest);
  });

  it('rejects stale and duplicate free-agency commands without writing anything', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    const context = await setupResolution(adapters);

    await expect(
      repo.applySeasonRunCommand({
        runId: run.runId,
        command: {
          ...context.command,
          expectedStateRevision: 5,
        },
        run: context.run,
        effects: context.effects,
        pending: null,
      }),
    ).rejects.toThrow(SeasonRunCommandStaleStateError);
    await expect(
      repo.applySeasonRunCommand({
        runId: run.runId,
        command: {
          ...context.command,
          expectedStateDigest: 'f'.repeat(32),
        },
        run: context.run,
        effects: context.effects,
        pending: null,
      }),
    ).rejects.toThrow(SeasonRunCommandStaleStateError);
    await expect(
      repo.applySeasonRunCommand({
        runId: 'other-run',
        command: context.command,
        run: context.run,
        effects: context.effects,
        pending: null,
      }),
    ).rejects.toThrow();

    await repo.applySeasonRunCommand({
      runId: run.runId,
      command: context.command,
      run: context.run,
      effects: context.effects,
      pending: null,
    });
    const stored = await db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (stored === undefined) throw new Error('expected the stored checkpoint row');
    await expect(
      repo.applySeasonRunCommand({
        runId: run.runId,
        command: {
          ...context.command,
          expectedStateRevision: 4,
          expectedStateDigest: stored.stateDigest,
        },
        run: context.run,
        effects: context.effects,
        pending: null,
      }),
    ).rejects.toThrow(SeasonRunCommandDuplicateError);
  });

  it('rolls back the whole resolution when a transaction write fails mid-apply', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    const context = await setupResolution(adapters);
    const before = await db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (before === undefined) throw new Error('expected the stored checkpoint row');

    vi.spyOn(db.seasonCommandLog, 'put').mockRejectedValueOnce(new Error('injected failure'));
    await expect(
      repo.applySeasonRunCommand({
        runId: run.runId,
        command: context.command,
        run: context.run,
        effects: context.effects,
        pending: null,
      }),
    ).rejects.toThrow('injected failure');

    const after = await db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    expect(after).toEqual(before);
    expect(after?.stateRevision).toBe(3);
    expect(after?.stateDigest).toBe(context.block2Digest);
    expect(
      after?.run.rosters.find((roster) => roster.franchiseId === 'lakers')?.players,
    ).toHaveLength(10);
    expect(after?.run.ownership).toHaveLength(300);
    expect(after?.run.freeAgency.windows[0]?.status).toBe('open');
    expect(after?.transactions.filter((entry) => entry.type === 'free-agent-signing')).toHaveLength(
      0,
    );
    expect(after?.influence.balances.lakers).toBe(2);
    expect(
      after?.influence.ledger.filter((entry) => entry.source === 'free-agent-signing'),
    ).toHaveLength(0);
    expect(await db.seasonCommandLog.where('runId').equals(run.runId).count()).toBe(0);

    const snapshot = await repo.loadActiveRun();
    expect(snapshot?.run.stateRevision).toBe(3);
  });

  it('records free-agency commands with dense command-log ordinals and a chained digest', async () => {
    const adapters = makeAdapters();
    const { db, repo, run, blocks } = adapters;
    const open = openWindowState(run);
    const block2 = blocks[2];
    if (block2 === undefined) throw new Error('expected fixture block 2');
    const block2Digest = buildFixtureStateDigest(run, {
      stateRevision: block2.stateRevision,
      checkpointState: block2.checkpointState,
      effects: block2.effects,
      freeAgency: open,
    });
    await promote(adapters);
    await repo.commitSeasonBlock(commitInputFor(adapters, 0));
    await repo.commitSeasonBlock(commitInputFor(adapters, 1));
    await repo.commitSeasonBlock({
      ...commitInputFor(adapters, 2),
      freeAgency: open,
      stateDigest: block2Digest,
    });

    const apply = async (overrides: {
      command: SeasonRunCommand;
      freeAgency: SeasonFreeAgencyState;
      stateRevision: number;
    }) => {
      const stateDigest = buildFixtureStateDigest(run, {
        stateRevision: overrides.stateRevision,
        checkpointState: block2.checkpointState,
        effects: block2.effects,
        freeAgency: overrides.freeAgency,
      });
      await repo.applySeasonRunCommand({
        runId: run.runId,
        command: overrides.command,
        run: {
          ...run,
          freeAgency: overrides.freeAgency,
          checkpointState: block2.checkpointState,
          stateRevision: overrides.stateRevision,
          stateDigest,
        },
        effects: block2.effects,
        pending: null,
      });
      return stateDigest;
    };

    const declared: SeasonFreeAgencyState = {
      ...open,
      windows: [
        {
          ...(open.windows[0] as NonNullable<SeasonFreeAgencyState['windows'][number]>),
          declarations: {
            ...open.windows[0]?.declarations,
            lakers: {
              franchiseId: 'lakers',
              windowIndex: 0,
              commandId: 'cmd-declare-fa-0',
              targets: [
                {
                  playerVersionId: FA_LAKERS.playerVersionId,
                  roleExpectation: 'rotation',
                  influence: 2,
                },
              ],
            },
          },
        },
      ],
    };
    const declareDigest = await apply({
      command: {
        schemaVersion: 11,
        command: 'declare-free-agent-interest',
        commandId: 'cmd-declare-fa-0',
        runId: run.runId,
        expectedStateRevision: 3,
        expectedStateDigest: block2Digest,
        franchiseId: 'lakers',
        windowIndex: 0,
        targets: [
          { playerVersionId: FA_LAKERS.playerVersionId, roleExpectation: 'rotation', influence: 2 },
        ],
      },
      freeAgency: declared,
      stateRevision: 4,
    });

    const skipped: SeasonFreeAgencyState = {
      ...declared,
      windows: [
        {
          ...(declared.windows[0] as NonNullable<SeasonFreeAgencyState['windows'][number]>),
          declarations: {
            ...declared.windows[0]?.declarations,
            celtics: {
              franchiseId: 'celtics',
              windowIndex: 0,
              commandId: 'cmd-skip-fa-0',
              targets: [],
            },
          },
        },
      ],
    };
    const skipDigest = await apply({
      command: {
        schemaVersion: 11,
        command: 'skip-free-agent-market',
        commandId: 'cmd-skip-fa-0',
        runId: run.runId,
        expectedStateRevision: 4,
        expectedStateDigest: declareDigest,
        franchiseId: 'celtics',
        windowIndex: 0,
      },
      freeAgency: skipped,
      stateRevision: 5,
    });

    const resolved = resolvedWindowState(run, 'cmd-resolve-fa-0', ['lakers']);
    const ledger = [
      ...run.influence.ledger,
      faLedgerEntry('lakers', 'influence-fa-lakers', 'cmd-resolve-fa-0', 0),
    ];
    const influence: SeasonInfluenceState = {
      ...run.influence,
      balances: { ...run.influence.balances, lakers: 0 },
      ledger,
    };
    const transactions = [
      faTransaction('lakers', 'tx-fa-lakers', 'cmd-resolve-fa-0', FA_LAKERS.playerVersionId, 6),
    ];
    const rosters = run.rosters.map((roster) =>
      roster.franchiseId === 'lakers'
        ? {
            ...roster,
            players: [
              ...roster.players,
              {
                playerVersionId: FA_LAKERS.playerVersionId,
                playerId: FA_LAKERS.playerId,
                franchiseId: 'lakers',
                eraId: '1990s',
                seasonKey: '1995-96',
                displayName: 'FA Lakers',
              },
            ],
          }
        : roster,
    );
    const ownership = [
      ...run.ownership,
      { playerVersionId: FA_LAKERS.playerVersionId, ownerFranchiseId: 'lakers' },
    ];
    const resolveDigest = buildFixtureStateDigest(run, {
      stateRevision: 6,
      checkpointState: block2.checkpointState,
      influence,
      transactions,
      rosters,
      ownership,
      effects: block2.effects,
      freeAgency: resolved,
    });
    await repo.applySeasonRunCommand({
      runId: run.runId,
      command: {
        schemaVersion: 11,
        command: 'resolve-free-agent-market',
        commandId: 'cmd-resolve-fa-0',
        runId: run.runId,
        expectedStateRevision: 5,
        expectedStateDigest: skipDigest,
        windowIndex: 0,
      },
      run: {
        ...run,
        rosters,
        ownership,
        influence,
        transactions,
        freeAgency: resolved,
        checkpointState: block2.checkpointState,
        stateRevision: 6,
        stateDigest: resolveDigest,
      },
      effects: block2.effects,
      pending: null,
      transactionIds: ['tx-fa-lakers'],
    });

    const log = await repo.loadCommandLog(run.runId);
    expect(log).not.toBeNull();
    if (log === null) throw new Error('expected a command log');
    expect(log.entries.map((entry) => entry.ordinal)).toEqual([0, 1, 2]);
    expect(log.entries.map((entry) => entry.command.command)).toEqual([
      'declare-free-agent-interest',
      'skip-free-agent-market',
      'resolve-free-agent-market',
    ]);
    expect(log.entries[0]?.preStateRevision).toBe(3);
    expect(log.entries[2]?.postStateRevision).toBe(6);
    expect(log.entries[2]?.previousLogDigest).toBe(
      seasonCommandLogDigest(
        [log.entries[0], log.entries[1]].filter(
          (entry): entry is NonNullable<(typeof log.entries)[number]> => entry !== undefined,
        ),
      ),
    );
    expect(log.entries[2]?.transactionIds).toEqual(['tx-fa-lakers']);

    const snapshot = await repo.loadActiveRun();
    expect(snapshot?.run.stateRevision).toBe(6);
    expect(snapshot?.run.freeAgency.windows[0]?.status).toBe('resolved');
    expect(await db.seasonCommandLog.where('runId').equals(run.runId).count()).toBe(3);
  });

  it('tops up factual zero-game aggregate rows for acquired players at signing application', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    const context = await setupResolution(adapters);
    await repo.applySeasonRunCommand({
      runId: run.runId,
      command: context.command,
      run: context.run,
      effects: context.effects,
      pending: null,
    });

    const stored = await db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    expect(stored?.playerAggregates).toHaveLength(302);
    const sorted = stored?.playerAggregates.map((row) => row.playerVersionId);
    expect(sorted).toEqual([...(sorted ?? [])].sort());
    const lakersRow = stored?.playerAggregates.find(
      (row) => row.playerVersionId === FA_LAKERS.playerVersionId,
    );
    const celticsRow = stored?.playerAggregates.find(
      (row) => row.playerVersionId === FA_CELTICS.playerVersionId,
    );
    expect(lakersRow).toMatchObject({
      playerVersionId: FA_LAKERS.playerVersionId,
      franchiseId: 'lakers',
      gamesPlayed: 0,
      points: 0,
      seconds: 0,
    });
    expect(celticsRow?.franchiseId).toBe('celtics');

    const existing = stored?.playerAggregates.find(
      (row) => row.playerVersionId === run.rosters[0]?.players[0]?.playerVersionId,
    );
    expect(existing?.gamesPlayed).toBeGreaterThan(0);
  });

  it('replaces a prior run across tabs without leaking free-agency rows or log entries', async () => {
    const adapters = makeAdapters();
    const { db, repo, run } = adapters;
    const context = await setupResolution(adapters);
    await repo.applySeasonRunCommand({
      runId: run.runId,
      command: context.command,
      run: context.run,
      effects: context.effects,
      pending: null,
    });
    expect(await db.seasonCommandLog.where('runId').equals(run.runId).count()).toBe(1);

    const secondRun = { ...sharedDataset.run, runId: 'replacement-free-agency-run' };
    await repo.promoteSeasonDraftToRun(buildFixtureStoredDraft(secondRun), secondRun);

    expect(await db.seasonRuns.count()).toBe(1);
    const row = await db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    expect(row?.run.runId).toBe('replacement-free-agency-run');
    expect(await db.seasonCommandLog.where('runId').equals(run.runId).count()).toBe(0);
    expect(await db.seasonRunIndex.get(SEASON_RUN_RECORD_ID)).not.toBeNull();
    const snapshot = await repo.loadActiveRun();
    expect(snapshot?.run.runId).toBe('replacement-free-agency-run');
    expect(snapshot?.run.freeAgency.windows).toEqual([]);
  });

  it('rejects an effects state with active/inactive overlap on load', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    const context = await setupResolution(adapters);
    await repo.applySeasonRunCommand({
      runId: context.run.runId,
      command: context.command,
      run: context.run,
      effects: context.effects,
      pending: null,
    });
    const row = await db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (row === undefined) throw new Error('expected the stored checkpoint row');
    const first = row.effects.playerStates[0];
    if (first === undefined) throw new Error('expected an active player state');
    await db.seasonRuns.put({
      ...row,
      effects: {
        ...row.effects,
        inactivePlayerStates: [{ ...first, fatigueBasisPoints: 0 }],
      },
    });
    await expect(repo.loadActiveRun()).rejects.toThrow(SeasonRunLoadError);
  });

  it('rejects an effects active set that does not match the locked rotations', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    const context = await setupResolution(adapters);
    await repo.applySeasonRunCommand({
      runId: context.run.runId,
      command: context.command,
      run: context.run,
      effects: context.effects,
      pending: null,
    });
    const row = await db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (row === undefined) throw new Error('expected the stored checkpoint row');
    const stranger = playerVersionId('p-synth-fa-stranger', 'lakers', '1990s', '1995-96');
    const replaced = row.effects.playerStates[0];
    if (replaced === undefined) throw new Error('expected an active player state');
    const playerStates = row.effects.playerStates.map((player) =>
      player.playerVersionId === replaced.playerVersionId
        ? { ...player, playerVersionId: stranger }
        : player,
    );
    const pairStates = row.effects.pairStates.map((pair) => ({
      a: pair.a === replaced.playerVersionId ? stranger : pair.a,
      b: pair.b === replaced.playerVersionId ? stranger : pair.b,
      sharedPossessions: pair.sharedPossessions,
    }));
    await db.seasonRuns.put({
      ...row,
      effects: { ...row.effects, playerStates, pairStates },
    });
    await expect(repo.loadActiveRun()).rejects.toThrow(/locked rotations/);
  });

  it('rejects active pairs that span rotations (non-per-rotation 1,350)', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    const context = await setupResolution(adapters);
    await repo.applySeasonRunCommand({
      runId: context.run.runId,
      command: context.command,
      run: context.run,
      effects: context.effects,
      pending: null,
    });
    const row = await db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (row === undefined) throw new Error('expected the stored checkpoint row');
    const rotationUnion = adapters.seam.seasonRotationPlayerVersionIds(row.run.rotations);
    const smallest = rotationUnion[0];
    const largest = rotationUnion[rotationUnion.length - 1];
    if (smallest === undefined || largest === undefined)
      throw new Error('expected rotation members');
    const pairStates = row.effects.pairStates.map((pair, index) =>
      index === 0 ? { a: smallest, b: largest, sharedPossessions: 0 } : pair,
    );
    await db.seasonRuns.put({
      ...row,
      effects: { ...row.effects, pairStates },
    });
    await expect(repo.loadActiveRun()).rejects.toThrow(/45 canonical pairs/);
  });

  it('rejects ownership rows that do not reconcile with the rosters', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    const context = await setupResolution(adapters);
    await repo.applySeasonRunCommand({
      runId: context.run.runId,
      command: context.command,
      run: context.run,
      effects: context.effects,
      pending: null,
    });
    const row = await db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (row === undefined) throw new Error('expected the stored checkpoint row');
    await db.seasonRuns.put({
      ...row,
      run: {
        ...row.run,
        ownership: [
          ...row.run.ownership,
          {
            playerVersionId: playerVersionId('p-synth-fa-ghost', 'lakers', '1990s', '1995-96'),
            ownerFranchiseId: 'lakers',
          },
        ],
      },
    });
    await expect(repo.loadActiveRun()).rejects.toThrow(/ownership row .* outside the rosters/);
  });

  it('rejects a signing that does not reconcile with the recorded transactions', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    const context = await setupResolution(adapters);
    await repo.applySeasonRunCommand({
      runId: context.run.runId,
      command: context.command,
      run: context.run,
      effects: context.effects,
      pending: null,
    });
    const row = await db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (row === undefined) throw new Error('expected the stored checkpoint row');
    const window = row.run.freeAgency.windows[0];
    if (window === undefined) throw new Error('expected the resolved window');
    const signings = window.signings.map((signing) => ({ ...signing, transactionId: 'tx-ghost' }));
    const signingCounts = { ...row.run.freeAgency.signingCounts };
    const seasonSpend = { ...row.run.freeAgency.seasonSpend };
    const freeAgency = seasonFreeAgencyStateSchema.parse({
      ...row.run.freeAgency,
      windows: [{ ...window, signings }],
      signingCounts,
      seasonSpend,
    });
    await db.seasonRuns.put({
      ...row,
      run: { ...row.run, freeAgency },
    });
    await expect(repo.loadActiveRun()).rejects.toThrow(/links unknown transaction/);
  });

  it('rejects a signing count that does not reconcile from the recorded signings', async () => {
    const adapters = makeAdapters();
    const { db, repo } = adapters;
    const context = await setupResolution(adapters);
    await repo.applySeasonRunCommand({
      runId: context.run.runId,
      command: context.command,
      run: context.run,
      effects: context.effects,
      pending: null,
    });
    const row = await db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (row === undefined) throw new Error('expected the stored checkpoint row');
    const freeAgency = seasonFreeAgencyStateSchema.parse({
      ...row.run.freeAgency,
      signingCounts: { ...row.run.freeAgency.signingCounts, lakers: 2 },
    });
    await db.seasonRuns.put({
      ...row,
      run: { ...row.run, freeAgency },
    });
    await expect(repo.loadActiveRun()).rejects.toThrow(/signingCounts for lakers/);
  });
});
