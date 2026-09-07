import { afterEach, describe, expect, it } from 'vitest';
import { reproduceCollectionPull, auditCollectionState } from '@hoop-rush/engine';
import {
  buildCollectionFixtureCatalog,
  buildCollectionFixtureCard,
} from '@hoop-rush/test-fixtures';
import type {
  CollectionCatalog,
  CollectionCommand,
  CollectionRarity,
} from '@hoop-rush/data-contracts';
import { COLLECTION_PACK_RULES_VERSION, collectionCommandSchema } from '@hoop-rush/data-contracts';
import { HoopRushDatabase } from './dexie.ts';
import {
  CollectionCommandConflictError,
  CollectionCommandStaleError,
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
const AT_ISO = '2026-01-01T00:00:00.000Z';

function commandFor(
  state: { revision: number; digest: string },
  commandId: string,
  command: 'claim-welcome' | 'open-pack' = 'claim-welcome',
): CollectionCommand {
  const base = {
    schemaVersion: 1,
    commandVersion: 'collection-command-v1',
    commandId,
    collectionId: COLLECTION_ID,
    expectedRevision: state.revision,
    expectedDigest: state.digest,
    acquiredAtIso: AT_ISO,
  } as const;
  if (command === 'claim-welcome')
    return collectionCommandSchema.parse({ ...base, command: 'claim-welcome' });
  return collectionCommandSchema.parse({ ...base, command: 'open-pack', packId: 'tip-off' });
}

function richCatalog(): CollectionCatalog {
  const base = buildCollectionFixtureCatalog();
  const specs: Array<[string, CollectionRarity, number]> = [
    ['persist-ember-pg', 'Ember', 60],
    ['persist-ember-sg', 'Ember', 61],
    ['persist-ember-sf', 'Ember', 62],
    ['persist-ember-pf', 'Ember', 63],
    ['persist-ember-c', 'Ember', 64],
    ['persist-eruption-a', 'Eruption', 72],
    ['persist-apex-a', 'Apex', 85],
    ['persist-titan-a', 'Titan', 90],
    ['persist-eclipse-a', 'Eclipse', 95],
    ['persist-immortal-a', 'Immortal', 99],
  ];
  const cards = specs.map(([playerId, rarity, overall]) =>
    buildCollectionFixtureCard(playerId, {
      displayName: `Persist ${playerId}`,
      rarity,
      summarySource: { overallRating: overall, offenseRating: overall, defenseRating: overall },
    }),
  );
  type CardPositions = CollectionCatalog['cards'][number]['positions'];
  const slots: CardPositions[] = [
    ['PG'],
    ['SG'],
    ['SF'],
    ['PF'],
    ['C'],
    ['SG'],
    ['SF'],
    ['SG'],
    ['SF'],
    ['C'],
  ];
  const positioned: CollectionCatalog['cards'] = cards.map((card, index) => ({
    ...card,
    positions: slots[index] ?? (['PG'] as CardPositions),
  }));
  return {
    ...base,
    cards: positioned,
    packs: [
      {
        packId: 'tip-off',
        packRulesVersion: COLLECTION_PACK_RULES_VERSION,
        priceCurrency: 'Coins',
        priceAmount: 100,
        slots: [{ kind: 'ordinary' }],
        eligibleScope: 'full-catalog',
        rarityWeights: {
          Ember: 70,
          Eruption: 23,
          Apex: 5,
          Titan: 1.7,
          Eclipse: 0.29,
          Immortal: 0.01,
        },
        duplicateExchange: {
          Ember: 5,
          Eruption: 15,
          Apex: 50,
          Titan: 150,
          Eclipse: 500,
          Immortal: 1500,
        },
      },
    ],
  };
}

describe('collection persistence', () => {
  afterEach(restoreIndexedDb);

  it('initializes, commits the welcome claim, and survives reload', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('collection'));
    const repo = new DexieCollectionRepository(db);
    const catalog = buildCollectionFixtureCatalog();
    expect(await repo.loadCollection(COLLECTION_ID)).toBeNull();
    const initial = await repo.initializeCollection({
      collectionId: COLLECTION_ID,
      rootSeed: ROOT_SEED,
      catalogHash: CATALOG_HASH,
      createdAtIso: AT_ISO,
    });
    expect(initial.revision).toBe(0);
    const outcome = await repo.applyCollectionCommand({
      command: commandFor(initial, 'cmd-welcome'),
      catalog,
      catalogHash: CATALOG_HASH,
      recordedAtIso: AT_ISO,
    });
    expect(outcome.duplicate).toBe(false);
    expect(outcome.state.balances).toEqual({ Coins: 3000, Exchange: 0 });
    expect(outcome.state.owned).toHaveLength(5);
    const reloaded = new DexieCollectionRepository(db);
    const snapshot = await reloaded.loadCollection(COLLECTION_ID);
    expect(snapshot?.state).toEqual(outcome.state);
    expect(snapshot?.pulls).toHaveLength(1);
    expect(snapshot?.ledger).toHaveLength(1);
    expect(snapshot?.catalogHash).toBe(CATALOG_HASH);
    db.close();
  });

  it('returns the stored receipt on identical retry without double-spend', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('collection'));
    const repo = new DexieCollectionRepository(db);
    const catalog = buildCollectionFixtureCatalog();
    const initial = await repo.initializeCollection({
      collectionId: COLLECTION_ID,
      rootSeed: ROOT_SEED,
      catalogHash: CATALOG_HASH,
      createdAtIso: AT_ISO,
    });
    const command = commandFor(initial, 'cmd-welcome');
    const first = await repo.applyCollectionCommand({
      command,
      catalog,
      catalogHash: CATALOG_HASH,
      recordedAtIso: AT_ISO,
    });
    const retry = await repo.applyCollectionCommand({
      command,
      catalog,
      catalogHash: CATALOG_HASH,
      recordedAtIso: AT_ISO,
    });
    expect(retry.duplicate).toBe(true);
    expect(retry.state).toEqual(first.state);
    expect(retry.pull).toEqual(first.pull);
    const snapshot = await repo.loadCollection(COLLECTION_ID);
    expect(snapshot?.state.balances).toEqual(first.state.balances);
    expect(snapshot?.state.owned).toHaveLength(5);
    expect(snapshot?.pulls).toHaveLength(1);
    expect(snapshot?.ledger).toHaveLength(1);
    db.close();
  });

  it('rejects conflicting reuse and stale state without partial writes', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('collection'));
    const repo = new DexieCollectionRepository(db);
    const catalog = buildCollectionFixtureCatalog();
    const initial = await repo.initializeCollection({
      collectionId: COLLECTION_ID,
      rootSeed: ROOT_SEED,
      catalogHash: CATALOG_HASH,
      createdAtIso: AT_ISO,
    });
    const welcome = commandFor(initial, 'cmd-shared');
    await repo.applyCollectionCommand({
      command: welcome,
      catalog,
      catalogHash: CATALOG_HASH,
      recordedAtIso: AT_ISO,
    });
    const conflict: CollectionCommand = {
      ...(commandFor(initial, 'cmd-shared', 'open-pack') as Extract<
        CollectionCommand,
        { command: 'open-pack' }
      >),
    };
    await expect(
      repo.applyCollectionCommand({
        command: conflict,
        catalog,
        catalogHash: CATALOG_HASH,
        recordedAtIso: AT_ISO,
      }),
    ).rejects.toBeInstanceOf(CollectionCommandConflictError);
    const snapshot = await repo.loadCollection(COLLECTION_ID);
    if (snapshot === null) throw new Error('missing collection');
    const stale: CollectionCommand = {
      ...commandFor(snapshot.state, 'cmd-stale', 'open-pack'),
      expectedRevision: 0,
      expectedDigest: '0'.repeat(32),
    };
    await expect(
      repo.applyCollectionCommand({
        command: stale,
        catalog,
        catalogHash: CATALOG_HASH,
        recordedAtIso: AT_ISO,
      }),
    ).rejects.toBeInstanceOf(CollectionCommandStaleError);
    const after = await repo.loadCollection(COLLECTION_ID);
    expect(after?.pulls).toHaveLength(1);
    expect(after?.ledger).toHaveLength(1);
    expect(after?.state.revision).toBe(1);
    db.close();
  });

  it('commits pack purchases atomically and exports a verifiable bundle', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('collection'));
    const repo = new DexieCollectionRepository(db);
    const catalog = richCatalog();
    const initial = await repo.initializeCollection({
      collectionId: COLLECTION_ID,
      rootSeed: ROOT_SEED,
      catalogHash: CATALOG_HASH,
      createdAtIso: AT_ISO,
    });
    const welcome = await repo.applyCollectionCommand({
      command: commandFor(initial, 'cmd-welcome'),
      catalog,
      catalogHash: CATALOG_HASH,
      recordedAtIso: AT_ISO,
    });
    const purchase = await repo.applyCollectionCommand({
      command: commandFor(welcome.state, 'cmd-pack-1', 'open-pack'),
      catalog,
      catalogHash: CATALOG_HASH,
      recordedAtIso: AT_ISO,
    });
    expect(purchase.duplicate).toBe(false);
    expect(purchase.pull?.kind).toBe('pack');
    const bundle = await repo.exportBundle(COLLECTION_ID);
    expect(bundle.pulls).toHaveLength(2);
    for (const pull of bundle.pulls) {
      expect(reproduceCollectionPull(catalog, pull, ROOT_SEED).ok).toBe(true);
    }
    expect(auditCollectionState(bundle.state, bundle.pulls, bundle.ledger)).toEqual([]);
    const folded = bundle.ledger.reduce(
      (sums, entry) => ({ ...sums, [entry.currency]: sums[entry.currency] + entry.amount }),
      { Coins: 0, Exchange: 0 },
    );
    expect(folded).toEqual(bundle.state.balances);
    db.close();
  });

  it('reports corrupt rows with diagnostics and never overwrites them', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('collection'));
    const repo = new DexieCollectionRepository(db);
    const catalog = buildCollectionFixtureCatalog();
    const initial = await repo.initializeCollection({
      collectionId: COLLECTION_ID,
      rootSeed: ROOT_SEED,
      catalogHash: CATALOG_HASH,
      createdAtIso: AT_ISO,
    });
    await repo.applyCollectionCommand({
      command: commandFor(initial, 'cmd-welcome'),
      catalog,
      catalogHash: CATALOG_HASH,
      recordedAtIso: AT_ISO,
    });
    await db.collectionOwnership.put({
      collectionId: COLLECTION_ID,
      cardId: 'card-ffffffffffffffffffffffffffffffff',
      owned: {
        cardId: 'card-ffffffffffffffffffffffffffffffff',
        acquiredPullSequence: 0,
        acquiredSlotIndex: 0,
        acquiredAtIso: AT_ISO,
      },
    });
    let error: unknown;
    try {
      await repo.loadCollection(COLLECTION_ID);
    } catch (loadError) {
      error = loadError;
    }
    expect(error).toBeInstanceOf(CollectionLoadError);
    expect((error as CollectionLoadError).diagnostics.length).toBeGreaterThan(0);
    const ghost = await db.collectionOwnership.get([
      COLLECTION_ID,
      'card-ffffffffffffffffffffffffffffffff',
    ]);
    expect(ghost).toBeDefined();
    db.close();
  });

  it('exposes collection tables alongside existing stores', async () => {
    resetIndexedDb();
    const db = new HoopRushDatabase(testDatabaseName('collection'));
    await db.open();
    const names = db.tables.map((table) => table.name);
    for (const name of [
      'active',
      'classicDrafts',
      'seasonRuns',
      'seasonCommandLog',
      'fixedFiveActive',
      'collectionState',
      'collectionOwnership',
      'collectionPulls',
      'collectionLedger',
      'collectionCommands',
    ]) {
      expect(names).toContain(name);
    }
    expect(db.verno).toBe(16);
    db.close();
  });
});
