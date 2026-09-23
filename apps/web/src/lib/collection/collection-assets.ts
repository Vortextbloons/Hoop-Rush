import {
  collectionGameRulesSchema,
  collectionProgressionRulesSchema,
  loadAsset,
  loadCollectionCatalog as loadPackagedCatalog,
  loadCollectionIndex as loadPackagedIndex,
  parseCollectionCatalog,
  parseCollectionIndex,
  type CollectionCatalog,
  type CollectionGameRules,
  type CollectionIndex,
  type CollectionProgressionRules,
} from '@hoop-rush/data-contracts';
import { getManifest } from '$lib/data';
import { memoized, resolveAssetUrl } from '$lib/asset-url';
import { readCachedAsset, writeCachedAsset } from '$lib/pool-cache';

export function loadCollectionIndex(): Promise<CollectionIndex> {
  return memoized('collection/index', async () => {
    const manifest = await getManifest();
    const entry = manifest.collection?.index;
    if (!entry) throw new Error('The collection index is unavailable.');
    const cached = await readCachedAsset(entry.contentHash, parseCollectionIndex);
    if (cached !== null) return cached;
    const index = await loadPackagedIndex(resolveAssetUrl(entry.url), entry.contentHash);
    void writeCachedAsset(entry.contentHash, index);
    return index;
  });
}

export function loadCollectionCatalog(): Promise<CollectionCatalog> {
  return memoized('collection/catalog', async () => {
    const manifest = await getManifest();
    const entry = manifest.collection?.catalog;
    if (!entry) throw new Error('The collection catalog is unavailable.');
    const cached = await readCachedAsset(entry.contentHash, parseCollectionCatalog);
    if (cached !== null) return cached;
    const catalog = await loadPackagedCatalog(resolveAssetUrl(entry.url), entry.contentHash);
    void writeCachedAsset(entry.contentHash, catalog);
    return catalog;
  });
}

export function loadCollectionGameRules(): Promise<CollectionGameRules> {
  return memoized('collection/game-rules', async () => {
    const manifest = await getManifest();
    const entry = manifest.collection?.gameRules;
    if (!entry) throw new Error('The collection game rules are unavailable.');
    const parseGameRules = (value: unknown): CollectionGameRules =>
      collectionGameRulesSchema.parse(value);
    const cached = await readCachedAsset(entry.contentHash, parseGameRules);
    if (cached !== null) return cached;
    const response = await fetch(resolveAssetUrl(entry.url));
    if (!response.ok) throw new Error('The collection game rules are unavailable.');
    const rules = collectionGameRulesSchema.parse(await response.json());
    void writeCachedAsset(entry.contentHash, rules);
    return rules;
  });
}

export function loadCollectionProgression(): Promise<CollectionProgressionRules> {
  return memoized('collection/progression-rules', async () => {
    const manifest = await getManifest();
    const entry = manifest.collection?.progressionRules;
    if (!entry) throw new Error('The collection progression rules are unavailable.');
    const parseProgression = (value: unknown): CollectionProgressionRules =>
      collectionProgressionRulesSchema.parse(value);
    const cached = await readCachedAsset(entry.contentHash, parseProgression);
    if (cached !== null) return cached;
    const progression = await loadAsset(
      resolveAssetUrl(entry.url),
      collectionProgressionRulesSchema,
      'collection progression rules',
      entry.contentHash,
    );
    void writeCachedAsset(entry.contentHash, progression);
    return progression;
  });
}
