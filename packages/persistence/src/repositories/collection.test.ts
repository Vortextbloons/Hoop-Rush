import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COLLECTION_COMMAND_VERSION,
  COLLECTION_SAVE_V1_VERSION,
  COLLECTION_STATE_SCHEMA_VERSION,
  collectionCommandSchema,
  collectionGameCommandSchema,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionCommand,
  type CollectionProgressionRules,
  type CollectionPullRecordV2,
  type ContentHash,
} from '@hoop-rush/data-contracts';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCollectionDifficultyProfiles,
  buildCollectionFixtureCard,
  buildCollectionFixtureCatalog,
  buildCollectionGameRulesFixture,
  buildCollectionProgressionFixture,
} from '@hoop-rush/test-fixtures';
import {
  collectionObjectiveDefinitionsFromRules,
  collectionStateDigest,
  collectionStateFactsOf,
  initializeCollectionState,
  simulateCollectionGame,
} from '@hoop-rush/engine';
import { CollectionCommandStaleError, DexieCollectionRepository } from './collection.ts';
import { HOOP_RUSH_DATABASE_STORES, HoopRushDatabase } from './dexie.ts';
import {
  resetIndexedDb,
  restoreIndexedDb,
  testDatabaseName,
  TestDatabase,
} from '../testing/repo-test-support.ts';

const HASH = 'c'.repeat(64) as ContentHash;
const EMPTY_WEIGHTS = {
  Ember: 1,
  Eruption: 1,
  Apex: 1,
  Titan: 1,
  Eclipse: 1,
  Immortal: 1,
};

const POSITIONS: CollectionCatalogCard['positions'][] = [['PG'], ['SG'], ['SF'], ['PF'], ['C']];
const RARITIES: CollectionCatalogCard['rarity'][] = [
  'Ember',
  'Eruption',
  'Apex',
  'Titan',
  'Eclipse',
  'Immortal',
];

function buildCatalog(): CollectionCatalog {
  const cards: CollectionCatalogCard[] = [];
  for (let index = 0; index < 30; index += 1) {
    const playerId = `persist-${String(index).padStart(3, '0')}`;
    cards.push(
      buildCollectionFixtureCard(playerId, {
        playerId: playerId as CollectionCatalogCard['playerId'],
        positions: POSITIONS[index % POSITIONS.length] ?? ['PG'],
        rarity: RARITIES[index % RARITIES.length] ?? 'Ember',
        eraId: (index % 2 === 0 ? '1990s' : '2000s') as CollectionCatalogCard['eraId'],
        franchiseId: (index % 3 === 0
          ? 'lakers'
          : index % 3 === 1
            ? 'celtics'
            : 'bulls') as CollectionCatalogCard['franchiseId'],
        summarySource: {
          overallRating: 60 + (index % 12),
          offenseRating: 60 + (index % 12),
          defenseRating: 60,
        },
      }),
    );
  }
  return buildCollectionFixtureCatalog({
    cards,
    sets: [
      {
        setId: 'heat-check-set',
        title: 'Heat Checks',
        memberCardIds: [cards[0]?.cardId as string, cards[1]?.cardId as string],
      },
    ],
  });
}

const CATALOG = buildCatalog();
const PROGRESSION: CollectionProgressionRules = buildCollectionProgressionFixture({
  catalog: CATALOG,
});

function commandFor(
  state: { collectionId: string; revision: number; digest: string },
  command: CollectionCommand['command'],
  payload: Record<string, unknown>,
  commandId: string,
): CollectionCommand {
  return collectionCommandSchema.parse({
    schemaVersion: COLLECTION_STATE_SCHEMA_VERSION,
    commandVersion: COLLECTION_COMMAND_VERSION,
    commandId,
    collectionId: state.collectionId,
    expectedRevision: state.revision,
    expectedDigest: state.digest,
    command,
    ...payload,
  });
}

function collectionArgs(catalogHash = HASH) {
  return {
    catalog: CATALOG,
    catalogHash,
    progression: PROGRESSION,
    progressionHash: HASH,
  };
}

function v2Pull(pull: unknown): CollectionPullRecordV2 | null {
  return typeof pull === 'object' && pull !== null && 'replayVersion' in pull
    ? (pull as CollectionPullRecordV2)
    : null;
}

function seededState(input: {
  collectionId: string;
  ownedCardIds: readonly string[];
  balances?: { Coins: number; Exchange: number };
}) {
  const base = initializeCollectionState({
    collectionId: input.collectionId,
    rootSeed: '0'.repeat(32),
    progressionHash: HASH,
  });
  const owned = input.ownedCardIds.map((cardId, index) => ({
    cardId,
    acquiredPullSequence: index,
    acquiredSlotIndex: 0,
    acquiredAtIso: '2026-01-01T00:00:00.000Z',
  }));
  const draft = {
    ...base,
    claimedWelcome: true,
    revision: owned.length,
    owned,
    balances: input.balances ?? { Coins: 0, Exchange: 0 },
    nextPullSequence: owned.length,
  };
  return { ...draft, digest: collectionStateDigest(collectionStateFactsOf(draft)) };
}

async function seedCollectionRows(
  db: HoopRushDatabase,
  input: {
    collectionId: string;
    ownedCardIds: readonly string[];
    balances?: { Coins: number; Exchange: number };
  },
): Promise<void> {
  const state = seededState(input);
  await db.collectionState.put({
    collectionId: input.collectionId,
    saveSchemaVersion: 2,
    state,
    catalogHash: HASH,
    updatedAtIso: '2026-01-01T00:00:00.000Z',
  });
  for (const entry of state.owned) {
    const card = CATALOG.cards.find((candidate) => candidate.cardId === entry.cardId);
    if (card === undefined) throw new Error(`fixture card missing for ${entry.cardId}`);
    await db.collectionOwnership.put({
      collectionId: input.collectionId,
      cardId: entry.cardId,
      owned: entry,
    });
    await db.collectionPulls.put({
      collectionId: input.collectionId,
      pullSequence: entry.acquiredPullSequence,
      pull: {
        pullSequence: entry.acquiredPullSequence,
        kind: 'pack',
        packId: 'tip-off',
        packRulesVersion: 'collection-pack-rules-v1',
        economyVersion: 'collection-economy-v1',
        catalogVersion: 'collection-catalog-v1',
        catalogHash: HASH,
        commandId:
          `seed-${String(entry.acquiredPullSequence)}` as CollectionPullRecordV2['commandId'],
        seedPath: ['collection', 'seed', String(entry.acquiredPullSequence)],
        slots: [
          {
            slotIndex: 0,
            cardId: entry.cardId,
            rarity: card.rarity,
            kept: true,
            conversionAmount: 0,
          },
        ],
        replayVersion: 'collection-replay-v2',
        targeting: null,
      },
    });
  }
}

describe('M4.4 collection persistence', () => {
  afterEach(restoreIndexedDb);

  it('round-trips a v2 collection with targeting and set claims', async () => {
    resetIndexedDb();
    const db = new TestDatabase(testDatabaseName('collection-m44'));
    const repo = new DexieCollectionRepository(db);
    const state = await repo.initializeCollection({
      collectionId: 'collection-1',
      rootSeed: '0'.repeat(32),
      catalogHash: HASH,
      progressionHash: HASH,
      createdAtIso: '2026-01-01T00:00:00.000Z',
    });
    expect(state.schemaVersion).toBe(COLLECTION_STATE_SCHEMA_VERSION);

    const welcomeCommand = commandFor(
      state,
      'claim-welcome',
      { acquiredAtIso: '2026-01-01T00:00:00.000Z' },
      'cmd-welcome',
    );
    const welcome = await repo.applyCollectionCommand({
      command: welcomeCommand,
      ...collectionArgs(),
      recordedAtIso: '2026-01-01T00:00:00.000Z',
    });
    expect(welcome.pull?.kind).toBe('welcome');
    expect(v2Pull(welcome.pull)?.replayVersion).toBe('collection-replay-v2');

    const targetCommand = commandFor(
      welcome.state,
      'set-target-player',
      { playerId: 'persist-000' },
      'cmd-target',
    );
    const target = await repo.applyCollectionCommand({
      command: targetCommand,
      ...collectionArgs(),
      recordedAtIso: '2026-01-01T00:00:00.000Z',
    });
    expect(target.pull).toBeNull();
    expect(target.state.activeTargetPlayerId).toBe('persist-000');

    const packCommand = commandFor(
      target.state,
      'open-pack',
      { packId: 'tip-off', acquiredAtIso: '2026-01-01T00:00:00.000Z' },
      'cmd-pack',
    );
    const pack = await repo.applyCollectionCommand({
      command: packCommand,
      ...collectionArgs(),
      recordedAtIso: '2026-01-01T00:00:00.000Z',
    });
    expect(v2Pull(pack.pull)?.replayVersion).toBe('collection-replay-v2');
    expect(v2Pull(pack.pull)?.targeting?.targetPlayerId).toBe('persist-000');

    const reloaded = await repo.loadCollection('collection-1');
    expect(reloaded).not.toBeNull();
    expect(reloaded?.state.activeTargetPlayerId).toBe('persist-000');
    expect(reloaded?.state.claimedSetIds).toEqual([]);
    expect(reloaded?.pulls).toHaveLength(2);
    expect(reloaded?.commands).toHaveLength(3);
  });

  it('returns stored outcomes for identical retries without double effects', async () => {
    resetIndexedDb();
    const db = new TestDatabase(testDatabaseName('collection-retry'));
    const repo = new DexieCollectionRepository(db);
    const state = await repo.initializeCollection({
      collectionId: 'collection-1',
      rootSeed: '0'.repeat(32),
      catalogHash: HASH,
      progressionHash: HASH,
      createdAtIso: '2026-01-01T00:00:00.000Z',
    });
    const welcomeCommand = commandFor(
      state,
      'claim-welcome',
      { acquiredAtIso: '2026-01-01T00:00:00.000Z' },
      'cmd-welcome',
    );
    const welcome = await repo.applyCollectionCommand({
      command: welcomeCommand,
      ...collectionArgs(),
      recordedAtIso: '2026-01-01T00:00:00.000Z',
    });
    await expect(
      repo.applyCollectionCommand({
        command: welcomeCommand,
        ...collectionArgs(),
        recordedAtIso: '2026-01-01T00:00:00.000Z',
      }),
    ).resolves.toMatchObject({ duplicate: true });
    const reloaded = await repo.loadCollection('collection-1');
    expect(reloaded?.pulls).toHaveLength(1);
    expect(welcome.state.balances.Coins).toBe(3000);
  });

  it('rejects a stale target preview and accepts the refreshed one', async () => {
    resetIndexedDb();
    const db = new TestDatabase(testDatabaseName('collection-stale'));
    const repo = new DexieCollectionRepository(db);
    const state = await repo.initializeCollection({
      collectionId: 'collection-1',
      rootSeed: '0'.repeat(32),
      catalogHash: HASH,
      progressionHash: HASH,
      createdAtIso: '2026-01-01T00:00:00.000Z',
    });
    const welcomeCommand = commandFor(
      state,
      'claim-welcome',
      { acquiredAtIso: '2026-01-01T00:00:00.000Z' },
      'cmd-welcome',
    );
    const welcome = await repo.applyCollectionCommand({
      command: welcomeCommand,
      ...collectionArgs(),
      recordedAtIso: '2026-01-01T00:00:00.000Z',
    });
    const first = commandFor(
      welcome.state,
      'set-target-player',
      { playerId: 'persist-000' },
      'cmd-target-1',
    );
    const afterFirst = await repo.applyCollectionCommand({
      command: first,
      ...collectionArgs(),
      recordedAtIso: '2026-01-01T00:00:00.000Z',
    });
    const stale = commandFor(
      welcome.state,
      'open-pack',
      { packId: 'tip-off', acquiredAtIso: '2026-01-01T00:00:00.000Z' },
      'cmd-stale',
    );
    await expect(
      repo.applyCollectionCommand({
        command: stale,
        ...collectionArgs(),
        recordedAtIso: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(CollectionCommandStaleError);
    const fresh = commandFor(
      afterFirst.state,
      'open-pack',
      { packId: 'tip-off', acquiredAtIso: '2026-01-01T00:00:00.000Z' },
      'cmd-fresh',
    );
    const accepted = await repo.applyCollectionCommand({
      command: fresh,
      ...collectionArgs(),
      recordedAtIso: '2026-01-01T00:00:00.000Z',
    });
    expect(accepted.pull).not.toBeNull();
    expect(accepted.state.balances.Coins).toBe(2900);
  });

  it('claims a set once with an Exchange ledger entry that folds to the balance', async () => {
    resetIndexedDb();
    const db = new TestDatabase(testDatabaseName('collection-set-claim'));
    const repo = new DexieCollectionRepository(db);
    const set = CATALOG.sets[0];
    if (set === undefined) throw new Error('fixture set missing');
    await seedCollectionRows(db, {
      collectionId: 'collection-1',
      ownedCardIds: set.memberCardIds,
    });
    const loaded = await repo.loadCollection('collection-1');
    if (loaded === null) throw new Error('collection missing');
    const state = loaded.state;
    const claimCommand = commandFor(
      state,
      'claim-set-reward',
      { setId: set.setId, claimedAtIso: '2026-01-01T00:00:00.000Z' },
      'cmd-claim',
    );
    const claim = await repo.applyCollectionCommand({
      command: claimCommand,
      ...collectionArgs(),
      recordedAtIso: '2026-01-01T00:00:00.000Z',
    });
    expect(claim.setReceipt?.amount).toBe(2000);
    expect(claim.state.balances.Exchange).toBe(2000);
    const reloaded = await repo.loadCollection('collection-1');
    expect(reloaded?.state.claimedSetIds).toEqual([set.setId]);
    expect(reloaded?.state.balances.Exchange).toBe(2000);
    expect(reloaded?.ledger).toHaveLength(1);
    const repeat = commandFor(
      claim.state,
      'claim-set-reward',
      { setId: set.setId, claimedAtIso: '2026-01-01T00:00:00.000Z' },
      'cmd-claim-2',
    );
    await expect(
      repo.applyCollectionCommand({
        command: repeat,
        ...collectionArgs(),
        recordedAtIso: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'set-already-claimed' });
  });

  it('migrates a v1 collection row to v2 without losing records', async () => {
    resetIndexedDb();
    const name = testDatabaseName('collection-v1-migration');
    const legacy = new Dexie(name);
    legacy.version(19).stores(HOOP_RUSH_DATABASE_STORES);
    await legacy.open();
    const firstCard = CATALOG.cards[0];
    if (firstCard === undefined) throw new Error('fixture catalog too small');
    const v1State = {
      schemaVersion: 1,
      collectionVersion: 'collection-v1',
      catalogVersion: 'collection-catalog-v1',
      economyVersion: 'collection-economy-v1',
      collectionId: 'collection-1',
      rootSeed: '0'.repeat(32),
      revision: 1,
      digest: 'f'.repeat(32),
      claimedWelcome: true,
      owned: [
        {
          cardId: firstCard.cardId,
          acquiredPullSequence: 0,
          acquiredSlotIndex: 0,
          acquiredAtIso: '2026-01-01T00:00:00.000Z',
        },
      ],
      balances: { Coins: 3000, Exchange: 0 },
      nextPullSequence: 1,
    };
    await legacy.table('collectionState').put({
      collectionId: 'collection-1',
      saveSchemaVersion: COLLECTION_SAVE_V1_VERSION,
      state: v1State,
      catalogHash: HASH,
      updatedAtIso: '2026-01-01T00:00:00.000Z',
    });
    await legacy.table('collectionOwnership').put({
      collectionId: 'collection-1',
      cardId: firstCard.cardId,
      owned: v1State.owned[0],
    });
    await legacy.table('collectionPulls').put({
      collectionId: 'collection-1',
      pullSequence: 0,
      pull: {
        pullSequence: 0,
        kind: 'welcome',
        packRulesVersion: 'collection-pack-rules-v1',
        economyVersion: 'collection-economy-v1',
        catalogVersion: 'collection-catalog-v1',
        catalogHash: HASH,
        commandId: 'cmd-welcome',
        seedPath: ['collection', 'starter'],
        slots: [
          {
            slotIndex: 0,
            cardId: firstCard.cardId,
            rarity: firstCard.rarity,
            kept: true,
            conversionAmount: 0,
          },
        ],
      },
    });
    await legacy.table('collectionLedger').put({
      collectionId: 'collection-1',
      transactionId: `txn-${'1'.repeat(32)}`,
      entry: {
        transactionId: `txn-${'1'.repeat(32)}`,
        commandId: 'cmd-welcome',
        pullSequence: 0,
        currency: 'Coins',
        amount: 3000,
        reason: 'welcome-grant',
      },
    });
    legacy.close();

    const db = new HoopRushDatabase(name);
    const repo = new DexieCollectionRepository(db);
    const loaded = await repo.loadCollection('collection-1');
    expect(loaded).not.toBeNull();
    expect(loaded?.state.schemaVersion).toBe(COLLECTION_STATE_SCHEMA_VERSION);
    expect(loaded?.state.activeTargetPlayerId).toBeNull();
    expect(loaded?.state.claimedSetIds).toEqual([]);
    expect(loaded?.state.progressionHash).toBeNull();
    expect(loaded?.state.owned).toHaveLength(1);
    expect(loaded?.state.balances.Coins).toBe(3000);
    expect(loaded?.pulls).toHaveLength(1);
    expect(loaded?.state.digest).not.toBe('f'.repeat(32));
    db.close();
  });

  it('completes a challenge game atomically with reward ledger and clear state', async () => {
    resetIndexedDb();
    const db = new TestDatabase(testDatabaseName('collection-challenge'));
    const repo = new DexieCollectionRepository(db);
    const rules = buildCollectionGameRulesFixture();
    const difficulties = buildCollectionDifficultyProfiles();
    const objectives = collectionObjectiveDefinitionsFromRules(rules);
    const definition = PROGRESSION.challenges[0];
    if (definition === undefined) throw new Error('fixture challenge missing');
    await seedCollectionRows(db, {
      collectionId: 'collection-1',
      ownedCardIds: CATALOG.cards.map((card) => card.cardId),
      balances: { Coins: 0, Exchange: 0 },
    });
    const loadedPlay = await repo.ensurePlayState({
      collectionId: 'collection-1',
      catalog: CATALOG,
      catalogHash: HASH,
      recordedAtIso: '2026-01-01T00:00:00.000Z',
    });
    const prepare = collectionGameCommandSchema.parse({
      schemaVersion: 1,
      commandVersion: 'collection-game-command-v2',
      commandId: 'game-prepare',
      collectionId: 'collection-1',
      expectedRevision: loadedPlay.playState.revision,
      expectedDigest: loadedPlay.playState.digest,
      command: 'prepare-challenge-game',
      challengeId: definition.challengeId,
      objectiveId: null,
    });
    const prepared = await repo.applyCollectionGameCommand({
      command: prepare,
      catalog: CATALOG,
      catalogHash: HASH,
      profile: DEFAULT_ERA_SIM_PROFILE,
      profileHash: HASH,
      rulesHash: HASH,
      cpuWeights: EMPTY_WEIGHTS,
      difficultyProfiles: difficulties,
      objectiveDefinitions: objectives,
      progression: PROGRESSION,
      progressionHash: HASH,
      recordedAtIso: '2026-01-01T00:00:00.000Z',
    });
    expect(prepared.prepared).not.toBeNull();
    const pending = prepared.playState.pendingGame;
    if (pending === null || pending.gameVersion !== 'collection-game-v3') {
      throw new Error('challenge game was not prepared');
    }
    const simulated = simulateCollectionGame(pending, CATALOG, DEFAULT_ERA_SIM_PROFILE);
    const accept = collectionGameCommandSchema.parse({
      schemaVersion: 1,
      commandVersion: 'collection-game-command-v2',
      commandId: 'game-accept',
      collectionId: 'collection-1',
      expectedRevision: prepared.playState.revision,
      expectedDigest: prepared.playState.digest,
      command: 'accept-challenge-game-result',
      gameId: pending.gameId,
      result: simulated.result,
      events: simulated.events,
      completedAtIso: '2026-01-01T00:00:00.000Z',
    });
    const accepted = await repo.applyCollectionGameCommand({
      command: accept,
      catalog: CATALOG,
      catalogHash: HASH,
      profile: DEFAULT_ERA_SIM_PROFILE,
      profileHash: HASH,
      rulesHash: HASH,
      cpuWeights: EMPTY_WEIGHTS,
      difficultyProfiles: difficulties,
      objectiveDefinitions: objectives,
      progression: PROGRESSION,
      progressionHash: HASH,
      recordedAtIso: '2026-01-01T00:00:00.000Z',
    });
    expect(accepted.record?.gameVersion).toBe('collection-game-v3');
    expect(accepted.record?.gameId).toBe(pending.gameId);
    const reloadedPlay = await repo.loadPlayState('collection-1');
    expect(reloadedPlay?.playState.pendingGame).toBeNull();
    const reloadedCollection = await repo.loadCollection('collection-1');
    expect(reloadedCollection).not.toBeNull();
    const rewardEntries = accepted.ledgerEntries.length;
    expect(reloadedCollection?.ledger).toHaveLength(rewardEntries);
    expect(reloadedCollection?.gameRecords).toHaveLength(1);
    const playerWin =
      simulated.result.winner === 'home' && simulated.result.outcome === 'completed';
    expect(reloadedPlay?.playState.clearedChallengeIds).toEqual(
      playerWin ? [definition.challengeId] : [],
    );
    const duplicate = await repo.applyCollectionGameCommand({
      command: accept,
      catalog: CATALOG,
      catalogHash: HASH,
      profile: DEFAULT_ERA_SIM_PROFILE,
      profileHash: HASH,
      rulesHash: HASH,
      cpuWeights: EMPTY_WEIGHTS,
      difficultyProfiles: difficulties,
      objectiveDefinitions: objectives,
      progression: PROGRESSION,
      progressionHash: HASH,
      recordedAtIso: '2026-01-01T00:00:00.000Z',
    });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.record?.gameId).toBe(pending.gameId);
  });
});
