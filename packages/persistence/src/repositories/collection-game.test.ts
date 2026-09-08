import { afterEach, describe, expect, it } from 'vitest';
import { auditCollectionState, simulateCollectionGame } from '@hoop-rush/engine';
import { collectionPlayStateDigest, collectionPlayStateFactsOf } from '@hoop-rush/engine';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCollectionFixtureCard,
  buildCollectionFixtureCatalog,
} from '@hoop-rush/test-fixtures';
import type {
  CollectionCatalog,
  CollectionGameCommand,
  CollectionPlayState,
  CollectionRarity,
} from '@hoop-rush/data-contracts';
import { collectionGameCommandSchema } from '@hoop-rush/data-contracts';
import { HoopRushDatabase } from './dexie.ts';
import {
  CollectionCommandStaleError,
  CollectionGameCommandConflictError,
  CollectionLoadError,
  DexieCollectionRepository,
} from './collection.ts';
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
const RARITIES: CollectionRarity[] = ['Ember', 'Eruption', 'Apex', 'Titan', 'Eclipse', 'Immortal'];
const POSITIONS: Array<CollectionCatalog['cards'][number]['positions']> = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
];

function gameCatalog(): CollectionCatalog {
  const base = buildCollectionFixtureCatalog();
  const cards = [];
  for (let i = 0; i < 18; i += 1) {
    cards.push(
      buildCollectionFixtureCard(`gstate-${String(i).padStart(2, '0')}`, {
        displayName: `Gstate ${String(i).padStart(2, '0')}`,
        positions: POSITIONS[i % POSITIONS.length] ?? ['PG'],
        rarity: i < 8 ? 'Ember' : (RARITIES[i % RARITIES.length] ?? 'Ember'),
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
): CollectionGameCommand {
  return collectionGameCommandSchema.parse({
    schemaVersion: 1,
    commandVersion: 'collection-command-v1',
    commandId,
    collectionId: COLLECTION_ID,
    expectedRevision: playState.revision,
    expectedDigest: collectionPlayStateDigest(collectionPlayStateFactsOf(playState)),
    ...extra,
  });
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
  const { collectionCommandSchema: packCommandSchema } = await import('@hoop-rush/data-contracts');
  await repo.applyCollectionCommand({
    command: packCommandSchema.parse({
      schemaVersion: 1,
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

function gameInput(catalog: CollectionCatalog) {
  return {
    catalog,
    catalogHash: CATALOG_HASH,
    profile: DEFAULT_ERA_SIM_PROFILE,
    profileHash: PROFILE_HASH,
    rulesHash: RULES_HASH,
    cpuWeights: WEIGHTS,
    recordedAtIso: AT_ISO,
  };
}

describe('collection game persistence', () => {
  afterEach(restoreIndexedDb);

  it('lazily initializes play state and completes a game atomically', async () => {
    const { db, repo, catalog } = await claimedRepo();
    expect(await repo.loadPlayState(COLLECTION_ID)).toBeNull();
    const play = await repo.ensurePlayState({
      collectionId: COLLECTION_ID,
      catalog,
      catalogHash: CATALOG_HASH,
      recordedAtIso: AT_ISO,
    });
    expect(play.playState.revision).toBe(0);
    expect(play.playState.activeTeam.starters).toHaveLength(5);
    expect(play.playState.pendingGame).toBeNull();

    const prepared = await repo.applyCollectionGameCommand({
      ...gameInput(catalog),
      command: gameCommandFor(play.playState, 'cmd-prep-1', { command: 'prepare-basic-game' }),
    });
    expect(prepared.duplicate).toBe(false);
    expect(prepared.prepared?.gameSequence).toBe(0);
    expect(prepared.playState.pendingGame?.gameId).toBe(prepared.prepared?.gameId);

    const pending = prepared.playState.pendingGame;
    if (pending === null) throw new Error('missing pending game');
    const { result, events } = simulateCollectionGame(pending, catalog, DEFAULT_ERA_SIM_PROFILE);
    const accepted = await repo.applyCollectionGameCommand({
      ...gameInput(catalog),
      command: gameCommandFor(prepared.playState, 'cmd-accept-1', {
        command: 'accept-basic-game-result',
        gameId: pending.gameId,
        result,
        events,
        completedAtIso: AT_ISO,
      }),
    });
    expect(accepted.duplicate).toBe(false);
    expect(accepted.playState.pendingGame).toBeNull();
    expect(accepted.record?.gameId).toBe(pending.gameId);
    const expectedReward = result.winner === 'home' ? 100 : 10;
    expect(accepted.ledgerEntries).toHaveLength(1);
    expect(accepted.ledgerEntries[0]?.amount).toBe(expectedReward);
    expect(accepted.ledgerEntries[0]?.pullSequence).toBeNull();
    expect(accepted.balances?.Coins).toBe(3000 + expectedReward);

    const snapshot = await repo.loadCollection(COLLECTION_ID);
    expect(snapshot?.state.revision).toBe(2);
    expect(snapshot?.state.nextPullSequence).toBe(1);
    expect(snapshot?.gameRecords).toHaveLength(1);
    if (snapshot === null) throw new Error('missing collection');
    expect(
      auditCollectionState(snapshot.state, snapshot.pulls, snapshot.ledger, snapshot.gameRecords),
    ).toEqual([]);
    db.close();
  });

  it('returns the stored record on duplicate accept without double-granting', async () => {
    const { db, repo, catalog } = await claimedRepo();
    const play = await repo.ensurePlayState({
      collectionId: COLLECTION_ID,
      catalog,
      catalogHash: CATALOG_HASH,
      recordedAtIso: AT_ISO,
    });
    const prepared = await repo.applyCollectionGameCommand({
      ...gameInput(catalog),
      command: gameCommandFor(play.playState, 'cmd-prep-1', { command: 'prepare-basic-game' }),
    });
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
    const snapshot = await repo.loadCollection(COLLECTION_ID);
    if (snapshot === null) throw new Error('missing collection');
    const rewards = snapshot.ledger.filter((entry) => entry.reason.startsWith('game-'));
    expect(rewards).toHaveLength(1);
    expect(snapshot.state.balances.Coins).toBe(first.balances?.Coins);
    db.close();
  });

  it('rejects conflicting reuse and stale play state without partial writes', async () => {
    const { db, repo, catalog } = await claimedRepo();
    const play = await repo.ensurePlayState({
      collectionId: COLLECTION_ID,
      catalog,
      catalogHash: CATALOG_HASH,
      recordedAtIso: AT_ISO,
    });
    const prepared = await repo.applyCollectionGameCommand({
      ...gameInput(catalog),
      command: gameCommandFor(play.playState, 'cmd-prep-1', { command: 'prepare-basic-game' }),
    });
    const conflict = {
      ...gameCommandFor(prepared.playState, 'cmd-prep-1', { command: 'prepare-basic-game' }),
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
    db.close();
  });

  it('abandons and resumes with fresh sequences, then reloads cleanly', async () => {
    const { db, repo, catalog } = await claimedRepo();
    const play = await repo.ensurePlayState({
      collectionId: COLLECTION_ID,
      catalog,
      catalogHash: CATALOG_HASH,
      recordedAtIso: AT_ISO,
    });
    const first = await repo.applyCollectionGameCommand({
      ...gameInput(catalog),
      command: gameCommandFor(play.playState, 'cmd-prep-1', { command: 'prepare-basic-game' }),
    });
    const abandoned = await repo.applyCollectionGameCommand({
      ...gameInput(catalog),
      command: gameCommandFor(first.playState, 'cmd-abandon-1', {
        command: 'abandon-basic-game',
        gameId: first.playState.pendingGame?.gameId,
      }),
    });
    expect(abandoned.playState.pendingGame).toBeNull();
    const second = await repo.applyCollectionGameCommand({
      ...gameInput(catalog),
      command: gameCommandFor(abandoned.playState, 'cmd-prep-2', {
        command: 'prepare-basic-game',
      }),
    });
    expect(second.prepared?.gameSequence).toBe(1);
    expect(second.prepared?.gameId).not.toBe(first.prepared?.gameId);

    const reloaded = new DexieCollectionRepository(db);
    const playReloaded = await reloaded.loadPlayState(COLLECTION_ID);
    expect(playReloaded?.playState.pendingGame?.gameId).toBe(second.prepared?.gameId);
    const bundle = await reloaded.exportBundle(COLLECTION_ID);
    expect(bundle.playState?.playState.pendingGame?.gameId).toBe(second.prepared?.gameId);
    expect(bundle.gameRecords).toHaveLength(0);
    expect(bundle.gameCommands).toHaveLength(3);
    db.close();
  });

  it('keeps pack and game writes consistent with exact rewards', async () => {
    const { db, repo, catalog } = await claimedRepo();
    const play = await repo.ensurePlayState({
      collectionId: COLLECTION_ID,
      catalog,
      catalogHash: CATALOG_HASH,
      recordedAtIso: AT_ISO,
    });
    let state = (await repo.loadCollection(COLLECTION_ID))?.state;
    if (state === undefined) throw new Error('missing collection');
    const seen = new Set<number>();
    for (let gameSequence = 0; gameSequence < 6; gameSequence += 1) {
      const current = await repo.loadPlayState(COLLECTION_ID);
      if (current === null) throw new Error('missing play state');
      const prepared = await repo.applyCollectionGameCommand({
        ...gameInput(catalog),
        command: gameCommandFor(current.playState, `cmd-prep-${String(gameSequence)}`, {
          command: 'prepare-basic-game',
        }),
      });
      const pending = prepared.playState.pendingGame;
      if (pending === null) throw new Error('missing pending game');
      const { result, events } = simulateCollectionGame(pending, catalog, DEFAULT_ERA_SIM_PROFILE);
      const accepted = await repo.applyCollectionGameCommand({
        ...gameInput(catalog),
        command: gameCommandFor(prepared.playState, `cmd-accept-${String(gameSequence)}`, {
          command: 'accept-basic-game-result',
          gameId: pending.gameId,
          result,
          events,
          completedAtIso: AT_ISO,
        }),
      });
      const amount = accepted.ledgerEntries[0]?.amount;
      expect(amount).toBe(result.winner === 'home' ? 100 : 10);
      seen.add(amount ?? 0);
      if (gameSequence === 2) {
        const packState = (await repo.loadCollection(COLLECTION_ID))?.state;
        if (!packState) throw new Error('missing collection');
        const { collectionCommandSchema: packCommandSchema } =
          await import('@hoop-rush/data-contracts');
        const packOutcome = await repo.applyCollectionCommand({
          command: packCommandSchema.parse({
            schemaVersion: 1,
            commandVersion: 'collection-command-v1',
            commandId: `cmd-pack-${String(gameSequence)}`,
            collectionId: COLLECTION_ID,
            expectedRevision: packState.revision,
            expectedDigest: packState.digest,
            command: 'open-pack',
            packId: 'tip-off',
            acquiredAtIso: AT_ISO,
          }),
          catalog,
          catalogHash: CATALOG_HASH,
          recordedAtIso: AT_ISO,
        });
        expect(packOutcome.duplicate).toBe(false);
        expect(packOutcome.pull?.kind).toBe('pack');
      }
      const reloaded = await repo.loadCollection(COLLECTION_ID);
      if (reloaded === null) throw new Error('missing collection');
      state = reloaded.state;
    }
    expect(seen.has(100) || seen.has(10)).toBe(true);
    const snapshot = await repo.loadCollection(COLLECTION_ID);
    if (snapshot === null) throw new Error('missing collection');
    expect(snapshot.pulls.length).toBe(2);
    expect(snapshot.gameRecords.length).toBe(6);
    expect(snapshot.state.revision).toBe(snapshot.pulls.length + snapshot.gameRecords.length);
    expect(snapshot.state.nextPullSequence).toBe(snapshot.pulls.length);
    expect(
      auditCollectionState(snapshot.state, snapshot.pulls, snapshot.ledger, snapshot.gameRecords),
    ).toEqual([]);
    const totalRewards = snapshot.ledger
      .filter((entry) => entry.reason.startsWith('game-'))
      .reduce((sum, entry) => sum + entry.amount, 0);
    expect(snapshot.state.balances.Coins).toBe(3000 + totalRewards - 100);
    expect(play.playState.nextGameSequence).toBe(0);
    void state;
    db.close();
  });

  it('clears play, game, and command rows on explicit reset', async () => {
    const { db, repo, catalog } = await claimedRepo();
    const play = await repo.ensurePlayState({
      collectionId: COLLECTION_ID,
      catalog,
      catalogHash: CATALOG_HASH,
      recordedAtIso: AT_ISO,
    });
    await repo.applyCollectionGameCommand({
      ...gameInput(catalog),
      command: gameCommandFor(play.playState, 'cmd-prep-1', { command: 'prepare-basic-game' }),
    });
    await repo.clearCollection(COLLECTION_ID);
    expect(await repo.loadCollection(COLLECTION_ID)).toBeNull();
    expect(await repo.loadPlayState(COLLECTION_ID)).toBeNull();
    const games = await db.collectionGames
      .where('[collectionId+gameId]')
      .between([COLLECTION_ID, ''], [COLLECTION_ID, '￿'])
      .toArray();
    const gameCommands = await db.collectionGameCommands
      .where('[collectionId+commandId]')
      .between([COLLECTION_ID, ''], [COLLECTION_ID, '￿'])
      .toArray();
    expect(games).toHaveLength(0);
    expect(gameCommands).toHaveLength(0);
    await expect(repo.exportBundle(COLLECTION_ID)).rejects.toBeInstanceOf(CollectionLoadError);
    db.close();
  });
});
