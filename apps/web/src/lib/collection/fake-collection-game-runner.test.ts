import { describe, expect, it } from 'vitest';
import {
  COLLECTION_GAME_WORKER_WIRE_VERSION,
  collectionGameWorkerMessageSchema,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionRarity,
} from '@hoop-rush/data-contracts';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCollectionFixtureCard,
  buildCollectionFixtureCatalog,
} from '@hoop-rush/test-fixtures';
import { initializeCollectionActiveTeam, prepareCollectionBasicGame } from '@hoop-rush/engine';
import { runFakeCollectionGame } from './fake-collection-game-runner.ts';

const RARITIES: CollectionRarity[] = ['Ember', 'Eruption', 'Apex', 'Titan', 'Eclipse', 'Immortal'];
const POSITIONS: Array<CollectionCatalogCard['positions']> = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
];

function gameCatalog(): CollectionCatalog {
  const cards: CollectionCatalogCard[] = [];
  for (let i = 0; i < 18; i += 1) {
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

describe('fake collection game runner', () => {
  it('produces a wire-valid audited complete message', async () => {
    const catalog = gameCatalog();
    const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
    const owned = catalog.cards.slice(0, 6).map((card) => card.cardId);
    const team = initializeCollectionActiveTeam(owned, (cardId) => byId.get(cardId));
    const prepared = prepareCollectionBasicGame({
      collectionId: 'collection-1',
      rootSeed: '0'.repeat(32),
      gameSequence: 0,
      ownedCardIds: new Set(owned),
      team,
      catalog,
      cpuWeights: { Ember: 70, Eruption: 23, Apex: 5, Titan: 1.7, Eclipse: 0.29, Immortal: 0.01 },
      profileVersion: DEFAULT_ERA_SIM_PROFILE.profileVersion,
      profileHash: 'a'.repeat(64),
      catalogHash: 'b'.repeat(64),
      rulesHash: 'c'.repeat(64),
    });
    const message = await runFakeCollectionGame(prepared, catalog, DEFAULT_ERA_SIM_PROFILE);
    expect(collectionGameWorkerMessageSchema.parse(message)).toMatchObject({
      wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
      type: 'collection-game-complete',
      gameId: prepared.gameId,
    });
    expect(message.events.length).toBeGreaterThan(0);
    expect(message.resultDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(message.eventDigest).toMatch(/^[0-9a-f]{32}$/);
  });
});
