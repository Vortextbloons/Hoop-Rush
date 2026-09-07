import {
  loadCollectionCatalog as loadPackagedCatalog,
  loadCollectionIndex as loadPackagedIndex,
  parseCollectionCatalog,
  parseCollectionIndex,
  type CollectionCatalog,
  type CollectionIndex,
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
