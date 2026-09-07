import { describe, expect, it } from 'vitest';
import { collectionIndexEntrySchema, type CollectionIndexEntry } from '@hoop-rush/data-contracts';
import {
  buildBookItems,
  EMPTY_COLLECTION_FILTERS,
  filterBookItems,
  paginateBookItems,
  sortBookItems,
} from './collection-browser.ts';

function entry(overrides: { cardId: string } & Record<string, unknown>): CollectionIndexEntry {
  return collectionIndexEntrySchema.parse({
    playerId: 'p-1',
    playerExternalId: '101',
    displayName: 'Test Player',
    seasonKey: '1996-97',
    franchiseId: 'lakers',
    eraId: '1990s',
    rarity: 'Ember',
    family: 'Base',
    positions: ['SG'],
    overall: 60,
    ...overrides,
  });
}

const ITEMS = buildBookItems(
  [
    entry({
      cardId: 'card-00000000000000000000000000000001',
      displayName: 'Alpha Guard',
      rarity: 'Apex',
      overall: 87,
      positions: ['SG'],
    }),
    entry({
      cardId: 'card-00000000000000000000000000000002',
      displayName: 'Beta Wing',
      rarity: 'Ember',
      overall: 60,
      positions: ['SF'],
      franchiseId: 'bulls',
    }),
    entry({
      cardId: 'card-00000000000000000000000000000003',
      displayName: 'Gamma Big',
      rarity: 'Titan',
      overall: 91,
      positions: ['C'],
      eraId: '2000s',
      family: 'Lockdown',
    }),
  ],
  new Set(['card-00000000000000000000000000000001']),
  [{ setId: 'lockdown-set', memberCardIds: ['card-00000000000000000000000000000003'] }],
);

describe('collection browser', () => {
  it('combines filters with AND across categories', () => {
    const filtered = filterBookItems(ITEMS, {
      ...EMPTY_COLLECTION_FILTERS,
      search: 'a',
      rarities: ['Ember', 'Apex'],
    });
    expect(filtered.map((item) => item.entry.cardId).sort()).toEqual([
      'card-00000000000000000000000000000001',
      'card-00000000000000000000000000000002',
    ]);
    const owned = filterBookItems(ITEMS, { ...EMPTY_COLLECTION_FILTERS, owned: 'owned' });
    expect(owned.map((item) => item.entry.cardId)).toEqual([
      'card-00000000000000000000000000000001',
    ]);
    const set = filterBookItems(ITEMS, { ...EMPTY_COLLECTION_FILTERS, sets: ['lockdown-set'] });
    expect(set.map((item) => item.entry.cardId)).toEqual(['card-00000000000000000000000000000003']);
  });

  it('matches search case-insensitively and filters within categories with OR', () => {
    const filtered = filterBookItems(ITEMS, { ...EMPTY_COLLECTION_FILTERS, search: 'GAMMA' });
    expect(filtered.map((item) => item.entry.cardId)).toEqual([
      'card-00000000000000000000000000000003',
    ]);
    const multi = filterBookItems(ITEMS, {
      ...EMPTY_COLLECTION_FILTERS,
      franchises: ['lakers', 'bulls'],
    });
    expect(multi).toHaveLength(3);
    const single = filterBookItems(ITEMS, { ...EMPTY_COLLECTION_FILTERS, franchises: ['bulls'] });
    expect(single.map((item) => item.entry.cardId)).toEqual([
      'card-00000000000000000000000000000002',
    ]);
    const none = filterBookItems(ITEMS, { ...EMPTY_COLLECTION_FILTERS, search: 'zzz' });
    expect(none).toEqual([]);
  });

  it('sorts by rarity then overall then card id by default', () => {
    const sorted = sortBookItems(ITEMS, 'default');
    expect(sorted.map((item) => item.entry.cardId)).toEqual([
      'card-00000000000000000000000000000003',
      'card-00000000000000000000000000000001',
      'card-00000000000000000000000000000002',
    ]);
    const byName = sortBookItems(ITEMS, 'name');
    expect(byName.map((item) => item.entry.cardId)).toEqual([
      'card-00000000000000000000000000000001',
      'card-00000000000000000000000000000002',
      'card-00000000000000000000000000000003',
    ]);
  });

  it('paginates at the requested size and clamps', () => {
    const { pageItems, pageCount, page } = paginateBookItems(ITEMS, 2, 2);
    expect(pageCount).toBe(2);
    expect(page).toBe(2);
    expect(pageItems.map((item) => item.entry.cardId)).toEqual([
      'card-00000000000000000000000000000003',
    ]);
    const clamped = paginateBookItems(ITEMS, 9, 2);
    expect(clamped.page).toBe(2);
    const empty = paginateBookItems([], 1, 48);
    expect(empty.pageCount).toBe(1);
    expect(empty.pageItems).toEqual([]);
  });
});
