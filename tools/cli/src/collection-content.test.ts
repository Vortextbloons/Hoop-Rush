import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  collectionCatalogSchema,
  collectionIndexSchema,
  COLLECTION_CATALOG_VERSION,
} from '@hoop-rush/data-contracts';
import { resolveCollectionCard } from '@hoop-rush/engine';
import { COLLECTION_SPECIALS } from './collection-specials.ts';
import { launchPackDefinitions, rarityForOverall } from './gen-collection-catalog.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = resolve(HERE, '../../../apps/web/static/data/collection/catalog.json');
const INDEX_PATH = resolve(HERE, '../../../apps/web/static/data/collection/index.json');

describe('collection launch content', () => {
  it('assigns base rarity from source overall bands', () => {
    expect(rarityForOverall(60)).toBe('Ember');
    expect(rarityForOverall(71)).toBe('Ember');
    expect(rarityForOverall(72)).toBe('Eruption');
    expect(rarityForOverall(84)).toBe('Eruption');
    expect(rarityForOverall(85)).toBe('Apex');
    expect(rarityForOverall(89)).toBe('Apex');
    expect(rarityForOverall(90)).toBe('Titan');
    expect(rarityForOverall(94)).toBe('Titan');
    expect(rarityForOverall(95)).toBe('Eclipse');
    expect(rarityForOverall(98)).toBe('Eclipse');
    expect(rarityForOverall(99)).toBe('Immortal');
    expect(rarityForOverall(100)).toBe('Immortal');
  });

  it('freezes twelve authored specials', () => {
    expect(COLLECTION_SPECIALS).toHaveLength(12);
    const byFamily = new Map<string, number>();
    for (const special of COLLECTION_SPECIALS) {
      byFamily.set(special.family, (byFamily.get(special.family) ?? 0) + 1);
    }
    expect(byFamily.get('Sharpshooter')).toBe(4);
    expect(byFamily.get('Lockdown')).toBe(4);
    expect(byFamily.get('Floor General')).toBe(4);
  });

  it('defines five launch packs with frozen prices', () => {
    const packs = launchPackDefinitions();
    expect(packs.map((pack) => pack.packId)).toEqual([
      'tip-off',
      'fast-break',
      'full-court',
      'main-event',
      'spotlight',
    ]);
    expect(packs.map((pack) => pack.slots.length)).toEqual([1, 3, 5, 10, 1]);
    expect(packs.map((pack) => pack.priceAmount)).toEqual([100, 300, 500, 1000, 2000]);
  });

  it('resolves generated specials through engine inputs', () => {
    const catalog = collectionCatalogSchema.parse(
      JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as unknown,
    );
    expect(catalog.catalogVersion).toBe(COLLECTION_CATALOG_VERSION);
    expect(catalog.cards).toHaveLength(7933 + 12);
    const index = collectionIndexSchema.parse(
      JSON.parse(readFileSync(INDEX_PATH, 'utf8')) as unknown,
    );
    expect(index.cards).toHaveLength(catalog.cards.length);
    for (const authored of COLLECTION_SPECIALS) {
      const card = catalog.cards.find(
        (entry) =>
          entry.family === authored.family &&
          entry.sourcePlayerVersionId === authored.sourcePlayerVersionId,
      );
      expect(card).toBeDefined();
      if (card === undefined) continue;
      expect(card.rarity).toBe(authored.rarity);
      expect(card.ratingOverlay).toEqual(authored.ratingOverlay);
      const resolved = resolveCollectionCard(card, card);
      for (const [key, delta] of Object.entries(authored.ratingOverlay)) {
        const ratingKey = key as keyof typeof card.detailedRatings;
        const want = Math.min(100, Math.max(0, card.detailedRatings[ratingKey] + delta));
        expect(resolved.ratings[ratingKey]).toBe(want);
      }
      expect(resolved.playerId).toBe(card.playerId);
      expect(card.positions).toEqual(
        catalog.cards.find(
          (entry) => entry.cardId !== card.cardId && entry.playerId === card.playerId,
        )?.positions ?? card.positions,
      );
    }
  });
});
