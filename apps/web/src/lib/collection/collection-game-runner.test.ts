import { describe, expect, it } from 'vitest';
import {
  COLLECTION_GAME_WORKER_WIRE_VERSION,
  type CollectionActiveTeam,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionGameWorkerCompleteMessage,
  type CollectionPreparedGameUnion,
} from '@hoop-rush/data-contracts';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCollectionDifficultyProfiles,
  buildCollectionFixtureCard,
  buildCollectionFixtureCatalog,
  buildCollectionGameRulesFixture,
} from '@hoop-rush/test-fixtures';
import {
  collectionGameEventDigest,
  collectionGameResultDigest,
  collectionObjectiveDefinitionsFromRules,
  initializeCollectionActiveTeam,
  prepareCollectionBasicGameV2,
  simulateCollectionGame,
} from '@hoop-rush/engine';
import { runCollectionGame } from './collection-game-runner';

const HASH = 'a'.repeat(64);
const RARITIES: CollectionCatalogCard['rarity'][] = [
  'Ember',
  'Eruption',
  'Apex',
  'Titan',
  'Eclipse',
  'Immortal',
];
const POSITIONS: CollectionCatalogCard['positions'][] = [['PG'], ['SG'], ['SF'], ['PF'], ['C']];

function buildCatalog(): CollectionCatalog {
  const cards: CollectionCatalogCard[] = [];
  for (let i = 0; i < 24; i += 1) {
    cards.push(
      buildCollectionFixtureCard(`v2-${String(i).padStart(3, '0')}`, {
        playerId: `v2-${String(i).padStart(3, '0')}` as CollectionCatalogCard['playerId'],
        positions: POSITIONS[i % POSITIONS.length] ?? ['PG'],
        rarity: RARITIES[i % RARITIES.length] ?? 'Ember',
        summarySource: {
          overallRating: 60 + (i % 12),
          offenseRating: 60 + (i % 12),
          defenseRating: 60,
        },
      }),
    );
  }
  return buildCollectionFixtureCatalog({
    cards,
    sets: [
      {
        setId: 'sharpshooter-set',
        title: 'Envelope',
        memberCardIds: [cards[0]?.cardId as string, cards[1]?.cardId as string],
      },
    ],
  });
}

function buildPrepared(catalog: CollectionCatalog): CollectionPreparedGameUnion {
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  const team: CollectionActiveTeam = initializeCollectionActiveTeam(
    catalog.cards.slice(0, 12).map((card) => card.cardId),
    (cardId) => byId.get(cardId),
  );
  const rules = buildCollectionGameRulesFixture();
  const difficulty = buildCollectionDifficultyProfiles().find(
    (candidate) => candidate.difficultyId === 'pro',
  );
  if (difficulty === undefined) throw new Error('missing pro difficulty profile');
  return prepareCollectionBasicGameV2({
    collectionId: 'collection-test',
    rootSeed: '0'.repeat(32),
    gameSequence: 0,
    ownedCardIds: new Set(catalog.cards.map((card) => card.cardId)),
    team,
    catalog,
    difficulty,
    objectiveDefinitions: collectionObjectiveDefinitionsFromRules(rules),
    selectedObjectiveId: null,
    clearedDifficultyIds: [],
    profileVersion: DEFAULT_ERA_SIM_PROFILE.profileVersion,
    profileHash: HASH,
    catalogHash: HASH,
    rulesHash: HASH,
  });
}

function buildComplete(
  prepared: CollectionPreparedGameUnion,
  catalog: CollectionCatalog,
  requestId: string,
): CollectionGameWorkerCompleteMessage {
  const { result, events } = simulateCollectionGame(prepared, catalog, DEFAULT_ERA_SIM_PROFILE);
  return {
    wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
    type: 'collection-game-complete',
    requestId,
    gameId: prepared.gameId,
    result,
    events,
    eventDigest: collectionGameEventDigest(events),
    resultDigest: collectionGameResultDigest(result),
  };
}

class FakeCollectionWorker {
  posted: unknown[] = [];
  terminated = 0;
  private listeners = new Map<string, Array<(event: MessageEvent<unknown>) => void>>();
  postMessage(data: unknown): void {
    this.posted.push(data);
  }
  addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== listener),
    );
  }
  terminate(): void {
    this.terminated += 1;
  }
  emit(data: unknown): void {
    for (const listener of [...(this.listeners.get('message') ?? [])]) {
      listener({ data } as MessageEvent<unknown>);
    }
  }
}

const FUZZ_PAYLOADS: unknown[] = [
  undefined,
  null,
  42,
  'wire-noise',
  [],
  {},
  { type: 'collection-game-complete' },
  { wireVersion: 999, type: 'nope', requestId: 'req-fuzz' },
  {
    wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
    type: 'collection-game-complete',
    requestId: 'req-fuzz',
  },
  {
    wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
    type: 'collection-game-complete',
    requestId: 42,
    gameId: 'cg-1',
  },
  {
    wireVersion: 'v0',
    type: 'collection-game-error',
    requestId: 'req-fuzz',
    gameId: null,
    code: 'internal',
    message: 'boom',
    seed: null,
  },
];

describe('collection game runner worker envelope', () => {
  it('ignores warm-acks and foreign requestIds, then resolves on a well-formed complete', async () => {
    const catalog = buildCatalog();
    const prepared = buildPrepared(catalog);
    const worker = new FakeCollectionWorker();
    const promise = runCollectionGame({
      prepared,
      catalogUrl: 'https://example.test/catalog.json',
      catalogHash: HASH,
      profileUrl: 'https://example.test/profile.json',
      profileHash: HASH,
      requestId: 'req-envelope-1',
      createWorker: () => worker as unknown as Worker,
    });
    worker.emit({
      wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
      type: 'collection-game-warm-ack',
      requestId: 'req-envelope-1',
    });
    worker.emit({
      wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
      type: 'collection-game-error',
      requestId: 'req-someone-else',
      gameId: null,
      code: 'internal',
      message: 'not ours',
      seed: null,
    });
    worker.emit(buildComplete(prepared, catalog, 'req-envelope-1'));
    const message = await promise;
    expect(message.type).toBe('collection-game-complete');
    expect(message.gameId).toBe(prepared.gameId);
    expect(worker.terminated).toBe(1);
  });

  it('rejects worker error messages instead of hanging', async () => {
    const catalog = buildCatalog();
    const prepared = buildPrepared(catalog);
    const worker = new FakeCollectionWorker();
    const promise = runCollectionGame({
      prepared,
      catalogUrl: 'https://example.test/catalog.json',
      catalogHash: HASH,
      profileUrl: 'https://example.test/profile.json',
      profileHash: HASH,
      requestId: 'req-envelope-2',
      createWorker: () => worker as unknown as Worker,
    });
    worker.emit({
      wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
      type: 'collection-game-error',
      requestId: 'req-envelope-2',
      gameId: null,
      code: 'internal',
      message: 'worker exploded',
      seed: null,
    });
    await expect(promise).rejects.toThrow('worker exploded');
    expect(worker.terminated).toBe(1);
  });

  it.each(FUZZ_PAYLOADS.map((payload, index) => ({ payload, index })))(
    'rejects unparsable envelope $index instead of hanging forever',
    async ({ payload }) => {
      const catalog = buildCatalog();
      const prepared = buildPrepared(catalog);
      const worker = new FakeCollectionWorker();
      const promise = runCollectionGame({
        prepared,
        catalogUrl: 'https://example.test/catalog.json',
        catalogHash: HASH,
        profileUrl: 'https://example.test/profile.json',
        profileHash: HASH,
        requestId: 'req-fuzz',
        createWorker: () => worker as unknown as Worker,
      });
      worker.emit(payload);
      await expect(promise).rejects.toThrow(/outside the worker wire schema/);
      expect(worker.terminated).toBe(1);
    },
  );
});
