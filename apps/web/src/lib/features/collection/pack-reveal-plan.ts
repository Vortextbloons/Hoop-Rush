import type {
  CollectionCatalogCard,
  CollectionPullRecord,
  CollectionRarity,
} from '@hoop-rush/data-contracts';

export type PackRevealBeat = 'Pulse' | 'Ignition' | 'Lock' | 'Surge' | 'Reveal' | 'Walkout';

export interface PackRevealClue {
  label: 'Rarity' | 'Era' | 'Franchise' | 'Position' | 'Player';
  value: string;
}

export interface PackRevealCardPlan {
  slotIndex: number;
  cardId: string;
  rarity: CollectionRarity;
  beats: readonly PackRevealBeat[];
  clues: readonly PackRevealClue[];
}

export interface PackRevealPlan {
  packId: string;
  cards: readonly PackRevealCardPlan[];
}

const BEATS: Readonly<Record<CollectionRarity, readonly PackRevealBeat[]>> = {
  Ember: ['Pulse', 'Reveal'],
  Eruption: ['Pulse', 'Surge', 'Reveal'],
  Apex: ['Pulse', 'Ignition', 'Surge', 'Reveal'],
  Titan: ['Pulse', 'Ignition', 'Lock', 'Surge', 'Reveal'],
  Eclipse: ['Pulse', 'Ignition', 'Lock', 'Surge', 'Reveal'],
  Immortal: ['Walkout', 'Reveal'],
};

const CLUE_COUNT: Readonly<Record<CollectionRarity, number>> = {
  Ember: 0,
  Eruption: 1,
  Apex: 2,
  Titan: 3,
  Eclipse: 4,
  Immortal: 5,
};

export function packRevealPlanOf(input: {
  pull: Pick<CollectionPullRecord, 'packId' | 'slots'>;
  catalogCards: readonly CollectionCatalogCard[];
}): PackRevealPlan {
  const cardsById = new Map(input.catalogCards.map((card) => [card.cardId, card]));
  return {
    packId: input.pull.packId ?? 'starter',
    cards: input.pull.slots.map((slot) => {
      const card = cardsById.get(slot.cardId);
      const facts: PackRevealClue[] = [
        { label: 'Rarity', value: slot.rarity },
        ...(card ? [{ label: 'Era' as const, value: card.eraId }] : []),
        ...(card ? [{ label: 'Franchise' as const, value: card.franchiseId }] : []),
        ...(card && card.positions.length > 0
          ? [{ label: 'Position' as const, value: card.positions.join(' / ') }]
          : []),
        ...(card ? [{ label: 'Player' as const, value: card.displayName }] : []),
      ];
      return {
        slotIndex: slot.slotIndex,
        cardId: slot.cardId,
        rarity: slot.rarity,
        beats: BEATS[slot.rarity],
        clues: facts.slice(0, CLUE_COUNT[slot.rarity]),
      };
    }),
  };
}
