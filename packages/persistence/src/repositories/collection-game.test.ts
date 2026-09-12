import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  auditCollectionFirstClearState,
  auditCollectionState,
  collectionObjectiveDefinitionsFromRules,
  collectionPlayStateDigest,
  collectionPlayStateFactsOf,
  collectionStateDigest,
  collectionStateFactsOf,
  initializeCollectionActiveTeam,
  prepareCollectionBasicGame,
  reproduceCollectionGame,
  simulateCollectionGame,
} from '@hoop-rush/engine';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCollectionDifficultyProfiles,
  buildCollectionFixtureCard,
  buildCollectionFixtureCatalog,
  buildCollectionGameRulesFixture,
} from '@hoop-rush/test-fixtures';
import {
  COLLECTION_COMMAND_V1_VERSION,
  COLLECTION_GAME_COMMAND_VERSION,
  COLLECTION_GAME_V1_VERSION,
  COLLECTION_GAME_VERSION,
  COLLECTION_PLAY_SAVE_VERSION,
  COLLECTION_PLAY_SAVE_V1_VERSION,
  COLLECTION_SAVE_VERSION,
  COLLECTION_SCHEMA_VERSION,
  collectionCommandSchema,
  collectionGameCommandSchema,
  collectionPlayStateV1Schema,
  type CollectionCatalog,
  type CollectionDifficultyProfile,
  type CollectionGameCommand,
  type CollectionObjectiveDefinition,
  type CollectionPlayState,
  type CollectionPreparedGameV1,
  type CollectionRarity,
} from '@hoop-rush/data-contracts';
import Dexie from 'dexie';
import { HoopRushDatabase, HOOP_RUSH_DATABASE_STORES } from './dexie.ts';
import {
  CollectionCommandStaleError,
  CollectionGameCommandConflictError,
  CollectionLoadError,
  DexieCollectionRepository,
  type CollectionGameCommandOutcome,
} from './collection.ts';
import {
  storedCollectionLedgerSchema,
  storedCollectionPlayStateV2Schema,
  storedCollectionStateSchema,
} from '../schemas/collection-record.ts';
import {
  resetIndexedDb,
  restoreIndexedDb,
  testDatabaseName,
} from '../testing/repo-test-support.ts';

const COLLECTION_ID = 'collection-1';
const ROOT_SEED = 'e'.repeat(32);
const CATALOG_HASH = 'f'.repeat(64);
const PROFILE_HASH = 'a'.repeat(64);
const RULES_HASH = 'b'.repeat(64);
const AT_ISO = '2026-01-01T00:00:00.000Z';
const WEIGHTS: Record<CollectionRarity, number> = {
  Ember: 70,
  Eruption: 23,
  Apex: 5,
  Titan: 1.7,
  Eclipse: 0.29,
  Immortal: 0.01,
};
const POSITIONS: Array<CollectionCatalog['cards'][number]['positions']> = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
];
const RULES = buildCollectionGameRulesFixture();
const DIFFICULTY_PROFILES: CollectionDifficultyProfile[] = buildCollectionDifficultyProfiles();
const OBJECTIVE_DEFINITIONS: CollectionObjectiveDefinition[] =
  collectionObjectiveDefinitionsFromRules(RULES);

function rarityFor(index: number): CollectionRarity {
  if (index < 8) return 'Ember';
  if (index < 12) return 'Eruption';
  if (index < 16) return 'Apex';
  if (index < 20) return 'Titan';
  if (index < 22) return 'Eclipse';
  return 'Immortal';
}

function gameCatalog(): CollectionCatalog {
  const base = buildCollectionFixtureCatalog();
  const cards: CollectionCatalog['cards'] = [];
  for (let i = 0; i < 24; i += 1) {
    cards.push(
      buildCollectionFixtureCard(`gstate-${String(i).padStart(2, '0')}`, {
        displayName: `Gstate ${String(i).padStart(2, '0')}`,
        positions: POSITIONS[i % POSITIONS.length] ?? ['PG'],
        rarity: rarityFor(i),
        summarySource: { overallRating: 60, offenseRating: 60, defenseRating: 60 },
      }),
    );
  }
  return {
    ...base,
    cards,
    sets: [
      {
        setId: 'sharpshooter-set',
        title: 'Gstate',
        memberCardIds: [cards[0]?.cardId as string, cards[1]?.cardId as string],
      },
    ],
  };
}

function gameCommandFor(
  playState: CollectionPlayState,
  commandId: string,
  extra: Record<string, unknown>,
  commandVersion: string = COLLECTION_GAME_COMMAND_VERSION,
): CollectionGameCommand {
  return collectionGameCommandSchema.parse({
    schemaVersion: COLLECTION_SAVE_VERSION,
    commandVersion,
    commandId,
    collectionId: COLLECTION_ID,
    expectedRevision: playState.revision,
    expectedDigest: collectionPlayStateDigest(collectionPlayStateFactsOf(playState)),
    ...extra,
  });
}

function gameInput(catalog: CollectionCatalog) {
  return {
    catalog,
    catalogHash: CATALOG_HASH,
    profile: DEFAULT_ERA_SIM_PROFILE,
    profileHash: PROFILE_HASH,
    rulesHash: RULES_HASH,
    cpuWeights: WEIGHTS,
    difficultyProfiles: DIFFICULTY_PROFILES,
    objectiveDefinitions: OBJECTIVE_DEFINITIONS,
    recordedAtIso: AT_ISO,
  };
}

async function claimedRepo(): Promise<{
  db: HoopRushDatabase;
  repo: DexieCollectionRepository;
  catalog: CollectionCatalog;
}> {
  resetIndexedDb();
  const db = new HoopRushDatabase(testDatabaseName('collection-game'));
  const repo = new DexieCollectionRepository(db);
  const catalog = gameCatalog();
  const initial = await repo.initializeCollection({
    collectionId: COLLECTION_ID,
    rootSeed: ROOT_SEED,
    catalogHash: CATALOG_HASH,
    createdAtIso: AT_ISO,
  });
  await repo.applyCollectionCommand({
    command: collectionCommandSchema.parse({
      schemaVersion: COLLECTION_SAVE_VERSION,
      commandVersion: 'collection-command-v1',
      commandId: 'cmd-welcome',
      collectionId: COLLECTION_ID,
      expectedRevision: initial.revision,
      expectedDigest: initial.digest,
      command: 'claim-welcome',
      acquiredAtIso: AT_ISO,
    }),
    catalog,
    catalogHash: CATALOG_HASH,
    recordedAtIso: AT_ISO,
  });
  return { db, repo, catalog };
}

async function ensurePlay(
  repo: DexieCollectionRepository,
  catalog: CollectionCatalog,
): Promise<CollectionPlayState> {
  const play = await repo.ensurePlayState({
    collectionId: COLLECTION_ID,
    catalog,
    catalogHash: CATALOG_HASH,
    recordedAtIso: AT_ISO,
  });
  return play.playState;
}

async function prepareV2(
  repo: DexieCollectionRepository,
  catalog: CollectionCatalog,
  playState: CollectionPlayState,
  commandId: string,
  difficultyId: 'street' | 'pro' | 'legend',
  objectiveId: string | null = null,
): Promise<CollectionGameCommandOutcome> {
  return repo.applyCollectionGameCommand({
    ...gameInput(catalog),
    command: gameCommandFor(playState, commandId, {
      command: 'prepare-basic-game',
      difficultyId,
      objectiveId,
    }),
  });
}

async function acceptPending(
  repo: DexieCollectionRepository,
  catalog: CollectionCatalog,
  playState: CollectionPlayState,
  commandId: string,
  commandVersion: string = COLLECTION_GAME_COMMAND_VERSION,
): Promise<CollectionGameCommandOutcome> {
  const pending = playState.pendingGame;
  if (pending === null) throw new Error('missing pending game');
  const { result, events } = simulateCollectionGame(pending, catalog, DEFAULT_ERA_SIM_PROFILE);
  return repo.applyCollectionGameCommand({
    ...gameInput(catalog),
    command: gameCommandFor(
      playState,
      commandId,
      {
        command: 'accept-basic-game-result',
        gameId: pending.gameId,
        result,
        events,
        completedAtIso: AT_ISO,
      },
      commandVersion,
    ),
  });
}

async function runV2Game(
  repo: DexieCollectionRepository,
  catalog: CollectionCatalog,
  playState: CollectionPlayState,
  tag: string,
  difficultyId: 'street' | 'pro' | 'legend' = 'street',
): Promise<{ accepted: CollectionGameCommandOutcome; acceptCommand: CollectionGameCommand }> {
  const prepared = await prepareV2(repo, catalog, playState, `${tag}-prep`, difficultyId, null);
  const pending = prepared.playState.pendingGame;
  if (pending === null) throw new Error('missing pending game');
  const { result, events } = simulateCollectionGame(pending, catalog, DEFAULT_ERA_SIM_PROFILE);
  const acceptCommand = gameCommandFor(prepared.playState, `${tag}-accept`, {
    command: 'accept-basic-game-result',
    gameId: pending.gameId,
    result,
    events,
    completedAtIso: AT_ISO,
  });
  const accepted = await repo.applyCollectionGameCommand({
    ...gameInput(catalog),
    command: acceptCommand,
  });
  return { accepted, acceptCommand };
}

async function expectBalanced(repo: DexieCollectionRepository): Promise<void> {
  const snapshot = await repo.loadCollection(COLLECTION_ID);
  if (snapshot === null) throw new Error('missing collection');
  expect(
    auditCollectionState(snapshot.state, snapshot.pulls, snapshot.ledger, snapshot.gameRecords),
  ).toEqual([]);
  expect(snapshot.state.revision).toBe(snapshot.pulls.length + snapshot.gameRecords.length);
  const play = await repo.loadPlayState(COLLECTION_ID);
  if (play !== null) {
    expect(
      auditCollectionFirstClearState(play.playState, snapshot.gameRecords, snapshot.ledger),
    ).toEqual([]);
  }
}

describe('collection game persistence', () => {
  afterEach(restoreIndexedDb);

  it('initializes save v2 play state and completes a v2 game with every reward row', async () => {
    const { db, repo, catalog } = await claimedRepo();
    expect(await repo.loadPlayState(COLLECTION_ID)).toBeNull();
    const play = await ensurePlay(repo, catalog);
    expect(play.saveVersion).toBe(COLLECTION_PLAY_SAVE_VERSION);
    expect(play.clearedDifficultyIds).toEqual([]);
    expect(play.pendingGame).toBeNull();
    expect(play.activeTeam.starters).toHaveLength(5);
    expect(play.digest).toBe(collectionPlayStateDigest(collectionPlayStateFactsOf(play)));

    const prepared = await prepareV2(repo, catalog, play, 'cmd-prep-1', 'street', null);
    expect(prepared.duplicate).toBe(false);
    expect(prepared.prepared?.gameSequence).toBe(0);
    const prepareReceipt = await db.collectionGameCommands.get([COLLECTION_ID, 'cmd-prep-1']);
    expect(prepareReceipt?.command.commandVersion).toBe(COLLECTION_GAME_COMMAND_VERSION);
    const pending = prepared.playState.pendingGame;
    if (pending === null) throw new Error('missing pending game');
    if (pending.gameVersion === COLLECTION_GAME_V1_VERSION) throw new Error('expected a v2 game');
    expect(pending.difficulty.difficultyId).toBe('street');
    expect(pending.firstClearEligible).toBe(true);
    expect(pending.objectives.offers).toHaveLength(3);

    const accepted = await acceptPending(repo, catalog, prepared.playState, 'cmd-accept-1');
    const record = accepted.record;
    if (record === null || record.gameVersion === COLLECTION_GAME_V1_VERSION) {
      throw new Error('expected a v2 record');
    }
    expect(accepted.playState.pendingGame).toBeNull();
    expect(accepted.record?.gameId).toBe(pending.gameId);
    expect(accepted.ledgerEntries).toHaveLength(record.reward.components.length);
    const ledgerTotal = accepted.ledgerEntries.reduce((sum, entry) => sum + entry.amount, 0);
    expect(ledgerTotal).toBe(record.reward.total);
    expect(accepted.balances?.Coins).toBe(3000 + record.reward.total);
    for (const entry of accepted.ledgerEntries) {
      expect(entry.pullSequence).toBeNull();
      expect(entry.commandId).toBe('cmd-accept-1');
      expect(entry.currency).toBe('Coins');
    }

    const snapshot = await repo.loadCollection(COLLECTION_ID);
    expect(snapshot?.state.revision).toBe(2);
    expect(snapshot?.gameRecords).toHaveLength(1);
    expect(snapshot?.ledger.filter((entry) => entry.reason.startsWith('game-'))).toHaveLength(
      record.reward.components.length,
    );
    await expectBalanced(repo);
    db.close();
  });

  it('returns the stored record on duplicate v2 accept without double-granting', async () => {
    const { db, repo, catalog } = await claimedRepo();
    const play = await ensurePlay(repo, catalog);
    const prepared = await prepareV2(repo, catalog, play, 'cmd-prep-1', 'street', null);
    const pending = prepared.playState.pendingGame;
    if (pending === null) throw new Error('missing pending game');
    const { result, events } = simulateCollectionGame(pending, catalog, DEFAULT_ERA_SIM_PROFILE);
    const accept = gameCommandFor(prepared.playState, 'cmd-accept-1', {
      command: 'accept-basic-game-result',
      gameId: pending.gameId,
      result,
      events,
      completedAtIso: AT_ISO,
    });
    const first = await repo.applyCollectionGameCommand({ ...gameInput(catalog), command: accept });
    const retry = await repo.applyCollectionGameCommand({ ...gameInput(catalog), command: accept });
    expect(retry.duplicate).toBe(true);
    expect(retry.record).toEqual(first.record);
    expect(retry.ledgerEntries).toEqual([]);
    expect(retry.balances).toBeNull();
    await expectBalanced(repo);
    const snapshot = await repo.loadCollection(COLLECTION_ID);
    if (snapshot === null) throw new Error('missing collection');
    expect(snapshot.ledger.filter((entry) => entry.reason.startsWith('game-'))).toHaveLength(
      first.ledgerEntries.length,
    );
    expect(snapshot.state.balances.Coins).toBe(first.balances?.Coins);
    db.close();
  });

  it('rejects conflicting reuse and stale play state without partial writes', async () => {
    const { db, repo, catalog } = await claimedRepo();
    const play = await ensurePlay(repo, catalog);
    const prepared = await prepareV2(repo, catalog, play, 'cmd-prep-1', 'street', null);
    const conflict = {
      ...gameCommandFor(prepared.playState, 'cmd-prep-1', {
        command: 'prepare-basic-game',
        difficultyId: 'street',
        objectiveId: null,
      }),
      expectedDigest: '0'.repeat(32),
    } as CollectionGameCommand;
    await expect(
      repo.applyCollectionGameCommand({ ...gameInput(catalog), command: conflict }),
    ).rejects.toBeInstanceOf(CollectionGameCommandConflictError);
    const stale = {
      ...gameCommandFor(prepared.playState, 'cmd-abandon-1', {
        command: 'abandon-basic-game',
        gameId: prepared.playState.pendingGame?.gameId,
      }),
      expectedRevision: 0,
      expectedDigest: '0'.repeat(32),
    } as CollectionGameCommand;
    await expect(
      repo.applyCollectionGameCommand({ ...gameInput(catalog), command: stale }),
    ).rejects.toBeInstanceOf(CollectionCommandStaleError);
    const after = await repo.loadPlayState(COLLECTION_ID);
    expect(after?.playState.pendingGame?.gameId).toBe(prepared.playState.pendingGame?.gameId);
    expect(await db.collectionGames.count()).toBe(0);
    await expectBalanced(repo);
    db.close();
  });

  it('rejects a game completion that raced a pack purchase without partial rows', async () => {
    const { db, repo, catalog } = await claimedRepo();
    const play = await ensurePlay(repo, catalog);
    const prepared = await prepareV2(repo, catalog, play, 'cmd-prep-1', 'street', null);
    const pending = prepared.playState.pendingGame;
    if (pending === null) throw new Error('missing pending game');
    const { result, events } = simulateCollectionGame(pending, catalog, DEFAULT_ERA_SIM_PROFILE);
    const accept = gameCommandFor(prepared.playState, 'cmd-accept-1', {
      command: 'accept-basic-game-result',
      gameId: pending.gameId,
      result,
      events,
      completedAtIso: AT_ISO,
    });

    const originalPlayGet = db.collectionPlayState.get.bind(db.collectionPlayState);
    let injected = false;
    const playGetSpy = vi.spyOn(db.collectionPlayState, 'get');
    playGetSpy.mockImplementation((async (key: string) => {
      const row = await originalPlayGet(key);
      if (!injected && key === COLLECTION_ID && row !== undefined) {
        injected = true;
        const snapshot = await repo.loadCollection(COLLECTION_ID);
        if (snapshot === null) throw new Error('missing collection');
        await repo.applyCollectionCommand({
          command: collectionCommandSchema.parse({
            schemaVersion: COLLECTION_SAVE_VERSION,
            commandVersion: 'collection-command-v1',
            commandId: 'cmd-race-pack',
            collectionId: COLLECTION_ID,
            expectedRevision: snapshot.state.revision,
            expectedDigest: snapshot.state.digest,
            command: 'open-pack',
            packId: 'tip-off',
            acquiredAtIso: AT_ISO,
          }),
          catalog,
          catalogHash: CATALOG_HASH,
          recordedAtIso: AT_ISO,
        });
      }
      return row;
    }) as typeof db.collectionPlayState.get);

    await expect(
      repo.applyCollectionGameCommand({ ...gameInput(catalog), command: accept }),
    ).rejects.toBeInstanceOf(CollectionCommandStaleError);
    playGetSpy.mockRestore();
    expect(injected).toBe(true);

    const raced = await repo.loadCollection(COLLECTION_ID);
    if (raced === null) throw new Error('missing collection');
    expect(raced.state.revision).toBe(2);
    expect(raced.pulls).toHaveLength(2);
    expect(raced.gameRecords).toHaveLength(0);
    expect(raced.ledger.filter((entry) => entry.reason.startsWith('game-'))).toHaveLength(0);
    expect(await db.collectionGameCommands.get([COLLECTION_ID, 'cmd-accept-1'])).toBeUndefined();
    const playAfter = await repo.loadPlayState(COLLECTION_ID);
    expect(playAfter?.playState.pendingGame?.gameId).toBe(pending.gameId);

    const recovered = await repo.applyCollectionGameCommand({
      ...gameInput(catalog),
      command: accept,
    });
    expect(recovered.duplicate).toBe(false);
    expect(recovered.record?.gameId).toBe(pending.gameId);
    await expectBalanced(repo);
    db.close();
  });

  it('rolls back a failed commit and recovers without granting twice', async () => {
    const { db, repo, catalog } = await claimedRepo();
    const play = await ensurePlay(repo, catalog);
    const prepared = await prepareV2(repo, catalog, play, 'cmd-prep-1', 'street', null);
    const pending = prepared.playState.pendingGame;
    if (pending === null) throw new Error('missing pending game');
    const { result, events } = simulateCollectionGame(pending, catalog, DEFAULT_ERA_SIM_PROFILE);
    const accept = gameCommandFor(prepared.playState, 'cmd-accept-1', {
      command: 'accept-basic-game-result',
      gameId: pending.gameId,
      result,
      events,
      completedAtIso: AT_ISO,
    });
    const before = await repo.loadCollection(COLLECTION_ID);
    if (before === null) throw new Error('missing collection');

    const putSpy = vi.spyOn(db.collectionState, 'put');
    putSpy.mockImplementationOnce(() => {
      throw new Error('simulated crash');
    });
    await expect(
      repo.applyCollectionGameCommand({ ...gameInput(catalog), command: accept }),
    ).rejects.toThrow('simulated crash');
    putSpy.mockRestore();

    expect(await db.collectionGames.count()).toBe(0);
    expect(await db.collectionLedger.count()).toBe(before.ledger.length);
    expect(await db.collectionGameCommands.get([COLLECTION_ID, 'cmd-accept-1'])).toBeUndefined();
    const after = await repo.loadCollection(COLLECTION_ID);
    expect(after?.state).toEqual(before.state);
    const playAfter = await repo.loadPlayState(COLLECTION_ID);
    expect(playAfter?.playState.pendingGame?.gameId).toBe(pending.gameId);

    const recovered = await repo.applyCollectionGameCommand({
      ...gameInput(catalog),
      command: accept,
    });
    expect(recovered.duplicate).toBe(false);
    await expectBalanced(repo);
    db.close();
  });

  it('grants the v2 first clear exactly once across retry, reload, reuse, and repeat wins', async () => {
    const { db, repo, catalog } = await claimedRepo();
    let play = await ensurePlay(repo, catalog);
    let firstClear: {
      acceptCommand: CollectionGameCommand;
      outcome: CollectionGameCommandOutcome;
    } | null = null;
    for (let attempt = 0; attempt < 60 && firstClear === null; attempt += 1) {
      const { accepted, acceptCommand } = await runV2Game(
        repo,
        catalog,
        play,
        `cmd-clear-${String(attempt)}`,
      );
      play = accepted.playState;
      const record = accepted.record;
      if (
        record !== null &&
        record.gameVersion === COLLECTION_GAME_VERSION &&
        record.reward.firstClearGranted
      ) {
        firstClear = { acceptCommand, outcome: accepted };
      }
    }
    expect(firstClear).not.toBeNull();
    if (firstClear === null) throw new Error('missing first clear');
    const firstRecord = firstClear.outcome.record;
    if (firstRecord === null || firstRecord.gameVersion !== COLLECTION_GAME_VERSION) {
      throw new Error('expected a v2 first clear');
    }
    expect(firstRecord.reward.components.length).toBeGreaterThanOrEqual(2);
    expect(firstClear.outcome.playState.clearedDifficultyIds).toEqual(['street']);
    await expectBalanced(repo);
    const snapshotAfterFirst = await repo.loadCollection(COLLECTION_ID);
    if (snapshotAfterFirst === null) throw new Error('missing collection');
    const firstClearLedger = snapshotAfterFirst.ledger.filter(
      (entry) => entry.reason === 'game-first-clear-reward',
    );
    expect(firstClearLedger).toHaveLength(1);
    const componentTransactions = firstRecord.reward.components.map(
      (component) => component.transactionId,
    );
    expect(new Set(componentTransactions).size).toBe(componentTransactions.length);
    for (const component of firstRecord.reward.components) {
      const rows = snapshotAfterFirst.ledger.filter(
        (entry) => entry.transactionId === component.transactionId,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.amount).toBe(component.amount);
      expect(rows[0]?.reason).toBe(component.reason);
      expect(rows[0]?.commandId).toBe(firstClear.acceptCommand.commandId);
    }

    const retry = await repo.applyCollectionGameCommand({
      ...gameInput(catalog),
      command: firstClear.acceptCommand,
    });
    expect(retry.duplicate).toBe(true);
    expect(retry.record).toEqual(firstClear.outcome.record);
    expect(retry.ledgerEntries).toEqual([]);

    const reloaded = new DexieCollectionRepository(db);
    const playReloaded = await reloaded.loadPlayState(COLLECTION_ID);
    expect(playReloaded?.playState.clearedDifficultyIds).toEqual(['street']);

    const conflict = {
      ...firstClear.acceptCommand,
      completedAtIso: '2026-02-01T00:00:00.000Z',
    } as CollectionGameCommand;
    await expect(
      reloaded.applyCollectionGameCommand({ ...gameInput(catalog), command: conflict }),
    ).rejects.toBeInstanceOf(CollectionGameCommandConflictError);

    let repeatWin = false;
    let repeatPlay = (await reloaded.loadPlayState(COLLECTION_ID))?.playState;
    if (repeatPlay === undefined) throw new Error('missing play state');
    for (let attempt = 0; attempt < 80 && !repeatWin; attempt += 1) {
      const { accepted } = await runV2Game(
        reloaded,
        catalog,
        repeatPlay,
        `cmd-repeat-${String(attempt)}`,
      );
      repeatPlay = accepted.playState;
      const record = accepted.record;
      if (
        record !== null &&
        record.gameVersion === COLLECTION_GAME_VERSION &&
        record.reward.playerWin
      ) {
        expect(record.reward.firstClearGranted).toBe(false);
        expect(record.reward.components.some((component) => component.kind === 'first-clear')).toBe(
          false,
        );
        expect(accepted.playState.clearedDifficultyIds).toEqual(['street']);
        repeatWin = true;
      }
    }
    expect(repeatWin).toBe(true);
    await expectBalanced(reloaded);
    const finalSnapshot = await reloaded.loadCollection(COLLECTION_ID);
    if (finalSnapshot === null) throw new Error('missing collection');
    expect(
      finalSnapshot.ledger.filter((entry) => entry.reason === 'game-first-clear-reward'),
    ).toHaveLength(1);
    expect(
      finalSnapshot.ledger.filter((entry) => entry.reason === 'game-margin-reward').length,
    ).toBeGreaterThan(0);
    db.close();
  });

  it('rejects reward overflow without partial rows', async () => {
    const { db, repo, catalog } = await claimedRepo();
    const play = await ensurePlay(repo, catalog);
    const prepared = await prepareV2(repo, catalog, play, 'cmd-prep-1', 'street', null);
    const pending = prepared.playState.pendingGame;
    if (pending === null) throw new Error('missing pending game');
    const { result, events } = simulateCollectionGame(pending, catalog, DEFAULT_ERA_SIM_PROFILE);
    const accept = gameCommandFor(prepared.playState, 'cmd-accept-1', {
      command: 'accept-basic-game-result',
      gameId: pending.gameId,
      result,
      events,
      completedAtIso: AT_ISO,
    });

    const stateRow = await db.collectionState.get(COLLECTION_ID);
    if (stateRow === undefined) throw new Error('missing state row');
    const manualEntry = {
      transactionId: `txn-${'9'.repeat(32)}`,
      commandId: 'cmd-manual',
      pullSequence: null,
      currency: 'Coins' as const,
      amount: Number.MAX_SAFE_INTEGER - stateRow.state.balances.Coins,
      reason: 'duplicate-conversion' as const,
    };
    const boosted = {
      ...stateRow.state,
      balances: { Coins: Number.MAX_SAFE_INTEGER, Exchange: stateRow.state.balances.Exchange },
      digest: '0'.repeat(32),
    };
    const committedState = {
      ...boosted,
      digest: collectionStateDigest(collectionStateFactsOf(boosted)),
    };
    await db.transaction('rw', db.collectionState, db.collectionLedger, async () => {
      await db.collectionLedger.put(
        storedCollectionLedgerSchema.parse({
          collectionId: COLLECTION_ID,
          transactionId: manualEntry.transactionId,
          entry: manualEntry,
        }),
      );
      await db.collectionState.put(
        storedCollectionStateSchema.parse({ ...stateRow, state: committedState }),
      );
    });

    let rejection: unknown;
    try {
      await repo.applyCollectionGameCommand({ ...gameInput(catalog), command: accept });
    } catch (error) {
      rejection = error;
    }
    expect((rejection as { code?: string }).code).toBe('arithmetic-overflow');
    expect(await db.collectionGames.count()).toBe(0);
    expect(await db.collectionGameCommands.get([COLLECTION_ID, 'cmd-accept-1'])).toBeUndefined();
    const after = await repo.loadCollection(COLLECTION_ID);
    if (after === null) throw new Error('missing collection');
    expect(after.state.balances.Coins).toBe(Number.MAX_SAFE_INTEGER);
    expect(after.ledger).toHaveLength(2);
    expect(after.gameRecords).toHaveLength(0);
    const playAfter = await repo.loadPlayState(COLLECTION_ID);
    expect(playAfter?.playState.pendingGame?.gameId).toBe(pending.gameId);
    db.close();
  });

  it('keeps pack purchases and v2 game completion consistent across reloads', async () => {
    const { db, repo, catalog } = await claimedRepo();
    let play = await ensurePlay(repo, catalog);
    let committed = 0;
    for (let attempt = 0; committed < 3 && attempt < 12; attempt += 1) {
      const { accepted } = await runV2Game(repo, catalog, play, `cmd-mix-${String(attempt)}`);
      play = accepted.playState;
      committed += 1;
      if (committed === 1) {
        const snapshot = await repo.loadCollection(COLLECTION_ID);
        if (snapshot === null) throw new Error('missing collection');
        const packOutcome = await repo.applyCollectionCommand({
          command: collectionCommandSchema.parse({
            schemaVersion: COLLECTION_SAVE_VERSION,
            commandVersion: 'collection-command-v1',
            commandId: 'cmd-pack-1',
            collectionId: COLLECTION_ID,
            expectedRevision: snapshot.state.revision,
            expectedDigest: snapshot.state.digest,
            command: 'open-pack',
            packId: 'tip-off',
            acquiredAtIso: AT_ISO,
          }),
          catalog,
          catalogHash: CATALOG_HASH,
          recordedAtIso: AT_ISO,
        });
        expect(packOutcome.pull?.kind).toBe('pack');
      }
    }
    expect(committed).toBe(3);
    const snapshot = await repo.loadCollection(COLLECTION_ID);
    if (snapshot === null) throw new Error('missing collection');
    expect(snapshot.pulls).toHaveLength(2);
    expect(snapshot.gameRecords).toHaveLength(3);
    const gameRewards = snapshot.ledger.filter((entry) => entry.reason.startsWith('game-'));
    const ledgerTotal = gameRewards.reduce((sum, entry) => sum + entry.amount, 0);
    expect(snapshot.state.balances.Coins).toBe(3000 + ledgerTotal - 100);
    await expectBalanced(repo);
    db.close();
  });

  it('clears play, game, and command rows on explicit reset', async () => {
    const { db, repo, catalog } = await claimedRepo();
    const play = await ensurePlay(repo, catalog);
    await prepareV2(repo, catalog, play, 'cmd-prep-1', 'street', null);
    await repo.clearCollection(COLLECTION_ID);
    expect(await repo.loadCollection(COLLECTION_ID)).toBeNull();
    expect(await repo.loadPlayState(COLLECTION_ID)).toBeNull();
    for (const table of [
      db.collectionState,
      db.collectionOwnership,
      db.collectionPulls,
      db.collectionLedger,
      db.collectionCommands,
      db.collectionPlayState,
      db.collectionGames,
      db.collectionGameCommands,
    ]) {
      expect(await table.count()).toBe(0);
    }
    await expect(repo.exportBundle(COLLECTION_ID)).rejects.toBeInstanceOf(CollectionLoadError);
    db.close();
  });
});

async function createV18Source(): Promise<{
  name: string;
  rows: Record<string, unknown[]>;
  catalog: CollectionCatalog;
  ownedCardIds: string[];
}> {
  resetIndexedDb();
  const name = testDatabaseName('collection-migration');
  const db = new HoopRushDatabase(name);
  const repo = new DexieCollectionRepository(db);
  const catalog = gameCatalog();
  const initial = await repo.initializeCollection({
    collectionId: COLLECTION_ID,
    rootSeed: ROOT_SEED,
    catalogHash: CATALOG_HASH,
    createdAtIso: AT_ISO,
  });
  await repo.applyCollectionCommand({
    command: collectionCommandSchema.parse({
      schemaVersion: COLLECTION_SAVE_VERSION,
      commandVersion: 'collection-command-v1',
      commandId: 'cmd-welcome',
      collectionId: COLLECTION_ID,
      expectedRevision: initial.revision,
      expectedDigest: initial.digest,
      command: 'claim-welcome',
      acquiredAtIso: AT_ISO,
    }),
    catalog,
    catalogHash: CATALOG_HASH,
    recordedAtIso: AT_ISO,
  });
  const play = await repo.ensurePlayState({
    collectionId: COLLECTION_ID,
    catalog,
    catalogHash: CATALOG_HASH,
    recordedAtIso: AT_ISO,
  });
  const prepared = await repo.applyCollectionGameCommand({
    ...gameInput(catalog),
    command: gameCommandFor(
      play.playState,
      'cmd-prep-legacy',
      { command: 'prepare-basic-game' },
      COLLECTION_COMMAND_V1_VERSION,
    ),
  });
  await acceptPending(
    repo,
    catalog,
    prepared.playState,
    'cmd-accept-legacy',
    COLLECTION_COMMAND_V1_VERSION,
  );
  const rows: Record<string, unknown[]> = {
    collectionState: await db.collectionState.toArray(),
    collectionOwnership: await db.collectionOwnership.toArray(),
    collectionPulls: await db.collectionPulls.toArray(),
    collectionLedger: await db.collectionLedger.toArray(),
    collectionCommands: await db.collectionCommands.toArray(),
    collectionGames: await db.collectionGames.toArray(),
    collectionGameCommands: await db.collectionGameCommands.toArray(),
  };
  const stateRow = storedCollectionStateSchema.parse(rows.collectionState?.[0]);
  const ownedCardIds = stateRow.state.owned.map((entry) => entry.cardId);
  await db.delete();
  return { name, rows, catalog, ownedCardIds };
}

function v1TeamOf(
  catalog: CollectionCatalog,
  ownedCardIds: string[],
): ReturnType<typeof initializeCollectionActiveTeam> {
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  return initializeCollectionActiveTeam(ownedCardIds, (cardId) => byId.get(cardId));
}

function v1PendingGame(
  catalog: CollectionCatalog,
  ownedCardIds: string[],
  gameSequence: number,
): CollectionPreparedGameV1 {
  return prepareCollectionBasicGame({
    collectionId: COLLECTION_ID,
    rootSeed: ROOT_SEED,
    gameSequence,
    ownedCardIds: new Set(ownedCardIds),
    team: v1TeamOf(catalog, ownedCardIds),
    catalog,
    cpuWeights: WEIGHTS,
    profileVersion: DEFAULT_ERA_SIM_PROFILE.profileVersion,
    profileHash: PROFILE_HASH,
    catalogHash: CATALOG_HASH,
    rulesHash: RULES_HASH,
  });
}

function v1PlayStateRow(input: {
  catalog: CollectionCatalog;
  ownedCardIds: string[];
  pendingGame: CollectionPreparedGameV1 | null;
  revision: number;
  nextGameSequence: number;
}): unknown {
  return {
    collectionId: COLLECTION_ID,
    saveSchemaVersion: COLLECTION_PLAY_SAVE_V1_VERSION,
    playState: collectionPlayStateV1Schema.parse({
      schemaVersion: COLLECTION_SCHEMA_VERSION,
      teamVersion: 'collection-team-v1',
      gameVersion: COLLECTION_GAME_V1_VERSION,
      collectionId: COLLECTION_ID,
      activeTeam: v1TeamOf(input.catalog, input.ownedCardIds),
      revision: input.revision,
      digest: 'd'.repeat(32),
      nextGameSequence: input.nextGameSequence,
      pendingGame: input.pendingGame,
    }),
    rootSeed: ROOT_SEED,
    catalogHash: CATALOG_HASH,
    updatedAtIso: AT_ISO,
  };
}

async function seedLegacyDatabase(
  name: string,
  rows: Record<string, unknown[]>,
  playStateRow: unknown,
): Promise<void> {
  const legacy = new Dexie(name);
  legacy.version(18).stores(HOOP_RUSH_DATABASE_STORES);
  await legacy.open();
  for (const [tableName, tableRows] of Object.entries(rows)) {
    if (tableRows.length === 0) continue;
    await legacy.table(tableName).bulkPut(tableRows);
  }
  await legacy.table('collectionPlayState').put(playStateRow);
  legacy.close();
}

describe('collection save v1 to v2 migration', () => {
  afterEach(restoreIndexedDb);

  it('migrates a v1 play state without a pending game and leaves history immutable', async () => {
    const source = await createV18Source();
    await seedLegacyDatabase(
      source.name,
      source.rows,
      v1PlayStateRow({
        catalog: source.catalog,
        ownedCardIds: source.ownedCardIds,
        pendingGame: null,
        revision: 2,
        nextGameSequence: 1,
      }),
    );
    const db = new HoopRushDatabase(source.name);
    await db.open();
    expect(db.verno).toBe(19);
    const raw = await db.collectionPlayState.get(COLLECTION_ID);
    if (raw === undefined) throw new Error('missing play state row');
    expect(raw.saveSchemaVersion).toBe(COLLECTION_PLAY_SAVE_VERSION);
    const parsed = storedCollectionPlayStateV2Schema.parse(raw);
    expect(parsed.playState.saveVersion).toBe(COLLECTION_PLAY_SAVE_VERSION);
    expect(parsed.playState.revision).toBe(2);
    expect(parsed.playState.nextGameSequence).toBe(1);
    expect(parsed.playState.clearedDifficultyIds).toEqual([]);
    expect(parsed.playState.pendingGame).toBeNull();
    expect(parsed.playState.digest).toBe(
      collectionPlayStateDigest(collectionPlayStateFactsOf(parsed.playState)),
    );

    const repo = new DexieCollectionRepository(db);
    const snapshot = await repo.loadCollection(COLLECTION_ID);
    if (snapshot === null) throw new Error('missing collection');
    expect(snapshot.gameRecords).toHaveLength(1);
    expect(snapshot.gameRecords[0]?.gameVersion).toBe(COLLECTION_GAME_V1_VERSION);
    expect(
      auditCollectionState(snapshot.state, snapshot.pulls, snapshot.ledger, snapshot.gameRecords),
    ).toEqual([]);
    const play = await repo.loadPlayState(COLLECTION_ID);
    expect(play?.playState.pendingGame).toBeNull();

    expect(await db.collectionState.toArray()).toEqual(source.rows.collectionState);
    expect(await db.collectionOwnership.toArray()).toEqual(source.rows.collectionOwnership);
    expect(await db.collectionPulls.toArray()).toEqual(source.rows.collectionPulls);
    expect(await db.collectionLedger.toArray()).toEqual(source.rows.collectionLedger);
    expect(await db.collectionCommands.toArray()).toEqual(source.rows.collectionCommands);
    expect(await db.collectionGames.toArray()).toEqual(source.rows.collectionGames);
    expect(await db.collectionGameCommands.toArray()).toEqual(source.rows.collectionGameCommands);
    db.close();
  });

  it('completes a migrated v1 pending game with its original v1 reward and digests', async () => {
    const source = await createV18Source();
    const pending = v1PendingGame(source.catalog, source.ownedCardIds, 1);
    await seedLegacyDatabase(
      source.name,
      source.rows,
      v1PlayStateRow({
        catalog: source.catalog,
        ownedCardIds: source.ownedCardIds,
        pendingGame: pending,
        revision: 3,
        nextGameSequence: 2,
      }),
    );
    const db = new HoopRushDatabase(source.name);
    const repo = new DexieCollectionRepository(db);
    const play = await repo.loadPlayState(COLLECTION_ID);
    if (play === null) throw new Error('missing play state');
    expect(play.playState.pendingGame).toEqual(pending);
    const before = await repo.loadCollection(COLLECTION_ID);
    if (before === null) throw new Error('missing collection');

    const accepted = await acceptPending(
      repo,
      source.catalog,
      play.playState,
      'cmd-accept-migrated',
      COLLECTION_COMMAND_V1_VERSION,
    );
    const record = accepted.record;
    if (record === null || record.gameVersion !== COLLECTION_GAME_V1_VERSION) {
      throw new Error('expected a v1 record');
    }
    const reproduced = reproduceCollectionGame(pending, source.catalog, DEFAULT_ERA_SIM_PROFILE);
    expect(record.prepared.inputDigest).toBe(pending.inputDigest);
    expect(record.eventDigest).toBe(reproduced.eventDigest);
    expect(record.resultDigest).toBe(reproduced.resultDigest);
    const expectedAmount = record.result.winner === 'home' ? 100 : 10;
    expect(record.reward.amount).toBe(expectedAmount);
    expect(accepted.ledgerEntries).toHaveLength(1);
    expect(accepted.ledgerEntries[0]?.amount).toBe(expectedAmount);
    expect(accepted.balances?.Coins).toBe(before.state.balances.Coins + expectedAmount);
    expect(accepted.playState.pendingGame).toBeNull();
    expect(accepted.playState.clearedDifficultyIds).toEqual([]);

    const snapshot = await repo.loadCollection(COLLECTION_ID);
    if (snapshot === null) throw new Error('missing collection');
    expect(snapshot.gameRecords).toHaveLength(2);
    expect(snapshot.gameRecords.map((entry) => entry.gameVersion)).toEqual([
      COLLECTION_GAME_V1_VERSION,
      COLLECTION_GAME_V1_VERSION,
    ]);
    expect(
      auditCollectionState(snapshot.state, snapshot.pulls, snapshot.ledger, snapshot.gameRecords),
    ).toEqual([]);
    const reloadedPlay = await repo.loadPlayState(COLLECTION_ID);
    if (reloadedPlay === null) throw new Error('missing play state');
    expect(
      auditCollectionFirstClearState(reloadedPlay.playState, snapshot.gameRecords, snapshot.ledger),
    ).toEqual([]);
    db.close();
  });

  it('exports mixed-version history and clears every row on reset', async () => {
    const source = await createV18Source();
    const pending = v1PendingGame(source.catalog, source.ownedCardIds, 1);
    await seedLegacyDatabase(
      source.name,
      source.rows,
      v1PlayStateRow({
        catalog: source.catalog,
        ownedCardIds: source.ownedCardIds,
        pendingGame: pending,
        revision: 3,
        nextGameSequence: 2,
      }),
    );
    const db = new HoopRushDatabase(source.name);
    const repo = new DexieCollectionRepository(db);
    const migrated = await repo.loadPlayState(COLLECTION_ID);
    if (migrated === null) throw new Error('missing play state');
    await acceptPending(
      repo,
      source.catalog,
      migrated.playState,
      'cmd-accept-migrated',
      COLLECTION_COMMAND_V1_VERSION,
    );
    const afterLegacy = await repo.loadPlayState(COLLECTION_ID);
    if (afterLegacy === null) throw new Error('missing play state');
    const prepared = await prepareV2(
      repo,
      source.catalog,
      afterLegacy.playState,
      'cmd-prep-v2',
      'street',
      null,
    );
    await acceptPending(repo, source.catalog, prepared.playState, 'cmd-accept-v2');

    const bundle = await repo.exportBundle(COLLECTION_ID);
    expect(bundle.gameRecords).toHaveLength(3);
    expect(bundle.gameRecords.map((record) => record.gameVersion)).toEqual([
      COLLECTION_GAME_V1_VERSION,
      COLLECTION_GAME_V1_VERSION,
      'collection-game-v2',
    ]);
    expect(bundle.gameCommands.map((command) => command.commandVersion)).toContain(
      COLLECTION_COMMAND_V1_VERSION,
    );
    expect(bundle.gameCommands.map((command) => command.commandVersion)).toContain(
      COLLECTION_GAME_COMMAND_VERSION,
    );
    expect(bundle.playState?.playState.pendingGame).toBeNull();
    expect(bundle.playState?.playState.clearedDifficultyIds).toEqual([]);

    await repo.clearCollection(COLLECTION_ID);
    for (const table of [
      db.collectionState,
      db.collectionOwnership,
      db.collectionPulls,
      db.collectionLedger,
      db.collectionCommands,
      db.collectionPlayState,
      db.collectionGames,
      db.collectionGameCommands,
    ]) {
      expect(await table.count()).toBe(0);
    }
    db.close();
  });
});
