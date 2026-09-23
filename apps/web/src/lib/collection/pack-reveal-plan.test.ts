import { describe, expect, it } from 'vitest';
import { collectionPullSlotResultSchema } from '@hoop-rush/data-contracts';
import { buildCollectionFixtureCard } from '@hoop-rush/test-fixtures';
import { packRevealPlanOf } from './pack-reveal-plan.ts';

describe('packRevealPlanOf', () => {
  it('uses only committed slot and catalog facts with rarity-specific presentation beats', () => {
    const rarities = ['Ember', 'Eruption', 'Apex', 'Titan', 'Eclipse', 'Immortal'] as const;
    const catalogCards = rarities.map((rarity, index) =>
      buildCollectionFixtureCard(`fixture-${String(index)}`, { rarity }),
    );
    const pull = {
      packId: 'main-event' as const,
      slots: catalogCards.map((card, slotIndex) =>
        collectionPullSlotResultSchema.parse({
          slotIndex,
          cardId: card.cardId,
          rarity: rarities[slotIndex],
          kept: true,
          conversionAmount: 0,
        }),
      ),
    };

    const plan = packRevealPlanOf({ pull, catalogCards });

    expect(plan.cards.map((card) => card.clues.length)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(plan.cards.map((card) => card.beats.at(-1))).toEqual([
      'Reveal',
      'Reveal',
      'Reveal',
      'Reveal',
      'Reveal',
      'Reveal',
    ]);
    expect(plan.cards.at(-1)?.beats[0]).toBe('Walkout');
    expect(plan.cards.at(-1)?.clues.at(-1)).toEqual({
      label: 'Player',
      value: catalogCards.at(-1)?.displayName,
    });
    expect(packRevealPlanOf({ pull, catalogCards })).toEqual(plan);
  });
});
