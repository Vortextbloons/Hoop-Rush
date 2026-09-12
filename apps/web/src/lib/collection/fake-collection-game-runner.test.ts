import { describe, expect, it } from 'vitest';
import {
  COLLECTION_GAME_WORKER_WIRE_VERSION,
  collectionGameWorkerMessageSchema,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionCpuRarityWeights,
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
  prepareCollectionBasicGame,
  prepareCollectionBasicGameV2,
} from '@hoop-rush/engine';
import { runFakeCollectionGame } from './fake-collection-game-runner.ts';

const RARITIES: CollectionRarity[] = ['Ember', 'Eruption', 'Apex', 'Titan', 'Eclipse', 'Immortal'];
const POSITIONS: Array<CollectionCatalogCard['positions']> = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
];
const LEGACY_CPU_WEIGHTS: CollectionCpuRarityWeights = {
  Ember: 70,
  Eruption: 23,
  Apex: 5,
  Titan: 1.7,
  Eclipse: 0.29,
  Immortal: 0.01,
};
const ROOT_SEED = '0'.repeat(32);

function gameCatalog(): CollectionCatalog {
  const cards: CollectionCatalogCard[] = [];
  for (let i = 0; i < 36; i += 1) {
    cards.push(
      buildCollectionFixtureCard(`fake-${String(i).padStart(2, '0')}`, {
        playerId: `fake-${String(i).padStart(2, '0')}` as CollectionCatalogCard['playerId'],
        positions: POSITIONS[i % POSITIONS.length] ?? ['PG'],
        rarity: RARITIES[i % RARITIES.length] ?? 'Ember',
        summarySource: { overallRating: 60, offenseRating: 60, defenseRating: 60 },
      }),
    );
  }
  return buildCollectionFixtureCatalog({
    cards,
    sets: [
      {
        setId: 'sharpshooter-set',
        title: 'Fake',
        memberCardIds: [cards[0]?.cardId as string, cards[1]?.cardId as string],
      },
    ],
  });
}

function fixtureTeam(catalog: CollectionCatalog) {
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  const owned = catalog.cards.slice(0, 6).map((card) => card.cardId);
  return { team: initializeCollectionActiveTeam(owned, (cardId) => byId.get(cardId)), owned };
}

describe('fake collection game runner', () => {
  it('returns a wire-valid v2 complete message for a current prepared game', async () => {
    const catalog = gameCatalog();
    const { team, owned } = fixtureTeam(catalog);
    const rules = buildCollectionGameRulesFixture();
    const prepared = prepareCollectionBasicGameV2({
      collectionId: 'collection-1',
      rootSeed: ROOT_SEED,
      gameSequence: 0,
      ownedCardIds: new Set(owned),
      team,
      catalog,
      difficulty: buildCollectionDifficultyProfile('street'),
      objectiveDefinitions: collectionObjectiveDefinitionsFromRules(rules),
      selectedObjectiveId: null,
      clearedDifficultyIds: [],
      profileVersion: DEFAULT_ERA_SIM_PROFILE.profileVersion,
      profileHash: 'a'.repeat(64),
      catalogHash: 'b'.repeat(64),
      rulesHash: 'c'.repeat(64),
    });
    expect(prepared.gameVersion).toBe('collection-game-v2');

    const message = await runFakeCollectionGame(prepared, catalog, DEFAULT_ERA_SIM_PROFILE);
    const parsed = collectionGameWorkerMessageSchema.parse(message);
    expect(parsed).toMatchObject({
      wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
      type: 'collection-game-complete',
      gameId: prepared.gameId,
    });
    expect(message.result.gameVersion).toBe('collection-game-v2');
    if (message.result.gameVersion === 'collection-game-v2') {
      expect(message.result.rulesVersion).toBe('collection-game-rules-v2');
    }
    expect(message.events.length).toBeGreaterThan(0);
    expect(message.resultDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(message.eventDigest).toMatch(/^[0-9a-f]{32}$/);
  });

  it('returns a legacy v1 result inside the v2 wire envelope for a v1 prepared game', async () => {
    const catalog = gameCatalog();
    const { team, owned } = fixtureTeam(catalog);
    const prepared = prepareCollectionBasicGame({
      collectionId: 'collection-1',
      rootSeed: ROOT_SEED,
      gameSequence: 0,
      ownedCardIds: new Set(owned),
      team,
      catalog,
      cpuWeights: LEGACY_CPU_WEIGHTS,
      profileVersion: DEFAULT_ERA_SIM_PROFILE.profileVersion,
      profileHash: 'a'.repeat(64),
      catalogHash: 'b'.repeat(64),
      rulesHash: 'c'.repeat(64),
    });
    expect(prepared.gameVersion).toBe('collection-game-v1');

    const message = await runFakeCollectionGame(prepared, catalog, DEFAULT_ERA_SIM_PROFILE);
    expect(collectionGameWorkerMessageSchema.parse(message)).toMatchObject({
      wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
      type: 'collection-game-complete',
      gameId: prepared.gameId,
    });
    expect(message.result.gameVersion).toBe('collection-game-v1');
  });
});
