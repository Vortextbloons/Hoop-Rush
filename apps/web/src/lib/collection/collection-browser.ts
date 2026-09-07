import type {
  CollectionIndexEntry,
  CollectionRarity,
  CollectionSetId,
} from '@hoop-rush/data-contracts';
import { COLLECTION_RARITY_ORDER } from '@hoop-rush/data-contracts';

export const COLLECTION_PAGE_SIZE = 48;

export interface CollectionFilters {
  search: string;
  franchises: string[];
  eras: string[];
  positions: string[];
  rarities: CollectionRarity[];
  families: string[];
  owned: 'all' | 'owned' | 'unowned';
  sets: CollectionSetId[];
}

export const EMPTY_COLLECTION_FILTERS: CollectionFilters = {
  search: '',
  franchises: [],
  eras: [],
  positions: [],
  rarities: [],
  families: [],
  owned: 'all',
  sets: [],
};

export type CollectionSortId = 'default' | 'name' | 'overall';

export interface CollectionBookItem {
  entry: CollectionIndexEntry;
  owned: boolean;
  setIds: CollectionSetId[];
}

export function buildBookItems(
  entries: readonly CollectionIndexEntry[],
  ownedIds: ReadonlySet<string>,
  sets: ReadonlyArray<{ setId: CollectionSetId; memberCardIds: readonly string[] }>,
): CollectionBookItem[] {
  const setOf = new Map<string, CollectionSetId[]>();
  for (const set of sets) {
    for (const member of set.memberCardIds) {
      const list = setOf.get(member) ?? [];
      list.push(set.setId);
      setOf.set(member, list);
    }
  }
  return entries.map((entry) => ({
    entry,
    owned: ownedIds.has(entry.cardId),
    setIds: setOf.get(entry.cardId) ?? [],
  }));
}

const RARITY_RANK = new Map(COLLECTION_RARITY_ORDER.map((rarity, index) => [rarity, index]));

export function filterBookItems(
  items: readonly CollectionBookItem[],
  filters: CollectionFilters,
): CollectionBookItem[] {
  const search = filters.search.trim().toLowerCase();
  return items.filter((item) => {
    if (search && !item.entry.displayName.toLowerCase().includes(search)) return false;
    if (filters.franchises.length > 0 && !filters.franchises.includes(item.entry.franchiseId)) {
      return false;
    }
    if (filters.eras.length > 0 && !filters.eras.includes(item.entry.eraId)) return false;
    if (
      filters.positions.length > 0 &&
      !item.entry.positions.some((position) => filters.positions.includes(position))
    ) {
      return false;
    }
    if (filters.rarities.length > 0 && !filters.rarities.includes(item.entry.rarity)) return false;
    if (filters.families.length > 0 && !filters.families.includes(item.entry.family)) return false;
    if (filters.owned === 'owned' && !item.owned) return false;
    if (filters.owned === 'unowned' && item.owned) return false;
    if (filters.sets.length > 0 && !item.setIds.some((setId) => filters.sets.includes(setId))) {
      return false;
    }
    return true;
  });
}

export function sortBookItems(
  items: readonly CollectionBookItem[],
  sort: CollectionSortId,
): CollectionBookItem[] {
  const sorted = [...items];
  if (sort === 'name') {
    sorted.sort((a, b) => a.entry.displayName.localeCompare(b.entry.displayName));
    return sorted;
  }
  if (sort === 'overall') {
    sorted.sort(
      (a, b) => b.entry.overall - a.entry.overall || a.entry.cardId.localeCompare(b.entry.cardId),
    );
    return sorted;
  }
  sorted.sort(
    (a, b) =>
      (RARITY_RANK.get(b.entry.rarity) ?? 0) - (RARITY_RANK.get(a.entry.rarity) ?? 0) ||
      b.entry.overall - a.entry.overall ||
      a.entry.cardId.localeCompare(b.entry.cardId),
  );
  return sorted;
}

export function paginateBookItems(
  items: readonly CollectionBookItem[],
  page: number,
  pageSize: number = COLLECTION_PAGE_SIZE,
): { pageItems: CollectionBookItem[]; pageCount: number; page: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const clamped = Math.min(Math.max(1, page), pageCount);
  return {
    pageItems: items.slice((clamped - 1) * pageSize, clamped * pageSize),
    pageCount,
    page: clamped,
  };
}
