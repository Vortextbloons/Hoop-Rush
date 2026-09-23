import { describe, expect, it } from 'vitest';
import { buildCollectionFixtureCard } from '@hoop-rush/test-fixtures';
import { collectionIndexEntrySchema } from '@hoop-rush/data-contracts';
import { collectionCardViewOf } from './collection-card-view.ts';

describe('collectionCardViewOf', () => {
  it('uses catalog source ratings without changing them and keeps catalog-only cards browsable', () => {
    const card = buildCollectionFixtureCard('fixture-pg', {
      summarySource: { overallRating: 76, offenseRating: 81, defenseRating: 69 },
    });
    const entry = collectionIndexEntrySchema.parse({
      cardId: card.cardId,
      playerId: card.playerId,
      playerExternalId: card.playerExternalId,
      displayName: card.displayName,
      seasonKey: card.seasonKey,
      franchiseId: card.franchiseId,
      eraId: card.eraId,
      rarity: card.rarity,
      family: card.family,
      positions: card.positions,
      overall: 76,
    });
    const view = collectionCardViewOf({ entry, catalogCard: card, owned: false });
    expect(view).toMatchObject({ overall: 76, offense: 81, defense: 69, owned: false });
    expect(view.ratings).toEqual(card.detailedRatings);

    const unavailable = collectionCardViewOf({ entry, catalogCard: null, owned: false });
    expect(unavailable).toMatchObject({
      name: card.displayName,
      overall: 76,
      offense: null,
      defense: null,
    });
  });
});
