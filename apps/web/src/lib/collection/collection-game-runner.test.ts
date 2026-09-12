import { describe, expect, it } from 'vitest';
import {
  COLLECTION_GAME_WORKER_WIRE_VERSION,
  collectionGameWorkerMessageSchema,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionGameEvent,
  type CollectionPreparedGameUnion,
  type CollectionRarity,
} from '@hoop-rush/data-contracts';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCollectionDifficultyProfile,
  buildCollectionFixtureCard,
  buildCollectionFixtureCatalog,
  buildCollectionGameRulesFixture,
} from '@hoop-rush/test-fixtures';
import {
  collectionObjectiveDefinitionsFromRules,
  initializeCollectionActiveTeam,
  prepareCollectionBasicGameV2,
} from '@hoop-rush/engine';
import { runFakeCollectionGame } from './fake-collection-game-runner.ts';
import { runCollectionGame } from './collection-game-runner.ts';

const REQUEST_ID = 'runner-test-1';

class FakeWorker extends EventTarget {
  terminated = false;
  private readonly respond: () => unknown;
  constructor(respond: () => unknown) {
    super();
    this.respond = respond;
  }
  postMessage(): void {
    queueMicrotask(() => {
      if (this.terminated) return;
      this.dispatchEvent(new MessageEvent('message', { data: this.respond() }));
    });
  }
  terminate(): void {
    this.terminated = true;
  }
}

function fixturePreparedGame(): {
  prepared: CollectionPreparedGameUnion;
  catalog: CollectionCatalog;
} {
  const rarities: CollectionRarity[] = [
    'Ember',
    'Eruption',
    'Apex',
    'Titan',
    'Eclipse',
    'Immortal',
  ];
  const positions: Array<CollectionCatalogCard['positions']> = [
    ['PG'],
    ['SG'],
    ['SF'],
    ['PF'],
    ['C'],
  ];
  const cards: CollectionCatalogCard[] = [];
  for (let i = 0; i < 36; i += 1) {
    cards.push(
      buildCollectionFixtureCard(`runner-${String(i).padStart(2, '0')}`, {
        playerId: `runner-${String(i).padStart(2, '0')}` as CollectionCatalogCard['playerId'],
        positions: positions[i % positions.length] ?? ['PG'],
        rarity: rarities[i % rarities.length] ?? 'Ember',
        summarySource: { overallRating: 60, offenseRating: 60, defenseRating: 60 },
      }),
    );
  }
  const catalog = buildCollectionFixtureCatalog({
    cards,
    sets: [
      {
        setId: 'sharpshooter-set',
        title: 'Runner',
        memberCardIds: [cards[0]?.cardId as string, cards[1]?.cardId as string],
      },
    ],
  });
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  const owned = catalog.cards.slice(0, 6).map((card) => card.cardId);
  const team = initializeCollectionActiveTeam(owned, (cardId) => byId.get(cardId));
  const prepared = prepareCollectionBasicGameV2({
    collectionId: 'collection-1',
    rootSeed: '0'.repeat(32),
    gameSequence: 0,
    ownedCardIds: new Set(owned),
    team,
    catalog,
    difficulty: buildCollectionDifficultyProfile('street'),
    objectiveDefinitions: collectionObjectiveDefinitionsFromRules(
      buildCollectionGameRulesFixture(),
    ),
    selectedObjectiveId: null,
    clearedDifficultyIds: [],
    profileVersion: DEFAULT_ERA_SIM_PROFILE.profileVersion,
    profileHash: 'a'.repeat(64),
    catalogHash: 'b'.repeat(64),
    rulesHash: 'c'.repeat(64),
  });
  return { prepared, catalog };
}

function legacyMessage(gameId: string): unknown {
  const events: CollectionGameEvent[] = [
    {
      eventOrder: 0,
      kind: 'final',
      period: 1,
      secondsRemaining: 0,
      homeScore: 2,
      awayScore: 0,
      winner: 'home',
    },
  ];
  return collectionGameWorkerMessageSchema.parse({
    wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
    type: 'collection-game-complete',
    requestId: REQUEST_ID,
    gameId,
    result: {
      gameVersion: 'collection-game-v1',
      gameId,
      gameSequence: 0,
      catalogVersion: 'collection-catalog-v1',
      rulesVersion: 'collection-game-rules-v1',
      engineVersion: 'test-engine',
      profileVersion: 'test-profile',
      winner: 'home',
      outcome: 'forfeit',
      losingTeamId: 'collection-cpu',
      trigger: 'no-legal-five-tipoff',
      homeScore: 2,
      awayScore: 0,
    },
    events,
    eventDigest: '0'.repeat(32),
    resultDigest: '1'.repeat(32),
  });
}

function runWithWorker(
  prepared: CollectionPreparedGameUnion,
  createWorker: () => Worker,
): ReturnType<typeof runCollectionGame> {
  return runCollectionGame({
    prepared,
    catalogUrl: '/data/collection/catalog.json',
    catalogHash: prepared.catalogHash,
    profileUrl: '/data/eras/2020s.json',
    profileHash: prepared.profileHash,
    requestId: REQUEST_ID,
    createWorker,
  });
}

describe('collection game runner', () => {
  it('resolves the matching v2 result from the wire envelope', async () => {
    const { prepared, catalog } = fixturePreparedGame();
    const response = await runFakeCollectionGame(
      prepared,
      catalog,
      DEFAULT_ERA_SIM_PROFILE,
      REQUEST_ID,
    );
    const worker = new FakeWorker(() => response);
    const message = await runWithWorker(prepared, () => worker as unknown as Worker);
    expect(message.gameId).toBe(prepared.gameId);
    expect(message.result.gameVersion).toBe('collection-game-v2');
    expect(worker.terminated).toBe(true);
  });

  it('rejects a result whose version does not match the prepared game', async () => {
    const { prepared } = fixturePreparedGame();
    const worker = new FakeWorker(() => legacyMessage(prepared.gameId));
    await expect(runWithWorker(prepared, () => worker as unknown as Worker)).rejects.toThrow(
      'different game version',
    );
  });

  it('rejects a result for a different game id', async () => {
    const { prepared, catalog } = fixturePreparedGame();
    const response = await runFakeCollectionGame(
      prepared,
      catalog,
      DEFAULT_ERA_SIM_PROFILE,
      REQUEST_ID,
    );
    const worker = new FakeWorker(() => ({ ...response, gameId: `game-${'f'.repeat(32)}` }));
    await expect(runWithWorker(prepared, () => worker as unknown as Worker)).rejects.toThrow(
      'different game',
    );
  });

  it('rejects a worker error message', async () => {
    const { prepared } = fixturePreparedGame();
    const worker = new FakeWorker(() =>
      collectionGameWorkerMessageSchema.parse({
        wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
        type: 'collection-game-error',
        requestId: REQUEST_ID,
        gameId: prepared.gameId,
        code: 'validation-failure',
        message: 'catalog hash mismatch',
        seed: prepared.seed,
      }),
    );
    await expect(runWithWorker(prepared, () => worker as unknown as Worker)).rejects.toThrow(
      'catalog hash mismatch',
    );
  });
});
