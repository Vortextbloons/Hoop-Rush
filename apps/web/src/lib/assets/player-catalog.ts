import { parseCollectionCatalog, type CollectionCatalog } from '@hoop-rush/data-contracts';
import { loadManifestAsset } from '#lib/manifest-assets.js';

export function loadPlayerCatalog(): Promise<CollectionCatalog> {
  return loadManifestAsset({
    key: 'collection/catalog',
    label: 'collection catalog',
    parse: parseCollectionCatalog,
    find: (manifest) => manifest.collection?.catalog ?? null,
    missingMessage: 'The collection catalog is unavailable.',
  });
}
