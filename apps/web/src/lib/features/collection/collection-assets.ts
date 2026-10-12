import {
  collectionGameRulesSchema,
  collectionProgressionRulesSchema,
  parseCollectionCatalog,
  parseCollectionIndex,
  type CollectionCatalog,
  type CollectionGameRules,
  type CollectionIndex,
  type CollectionProgressionRules,
} from '@hoop-rush/data-contracts';
import { loadManifestAsset } from '$lib/manifest-assets';

export function loadCollectionIndex(): Promise<CollectionIndex> {
  return loadManifestAsset({
    key: 'collection/index',
    label: 'collection index',
    parse: parseCollectionIndex,
    find: (manifest) => manifest.collection?.index ?? null,
    missingMessage: 'The collection index is unavailable.',
  });
}

export function loadCollectionCatalog(): Promise<CollectionCatalog> {
  return loadManifestAsset({
    key: 'collection/catalog',
    label: 'collection catalog',
    parse: parseCollectionCatalog,
    find: (manifest) => manifest.collection?.catalog ?? null,
    missingMessage: 'The collection catalog is unavailable.',
  });
}

export function loadCollectionGameRules(): Promise<CollectionGameRules> {
  return loadManifestAsset({
    key: 'collection/game-rules',
    label: 'collection game rules',
    parse: (value: unknown) => collectionGameRulesSchema.parse(value),
    find: (manifest) => manifest.collection?.gameRules ?? null,
    missingMessage: 'The collection game rules are unavailable.',
    load: async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('The collection game rules are unavailable.');
      return collectionGameRulesSchema.parse(await response.json());
    },
  });
}

export function loadCollectionProgression(): Promise<CollectionProgressionRules> {
  return loadManifestAsset({
    key: 'collection/progression-rules',
    label: 'collection progression rules',
    parse: (value: unknown) => collectionProgressionRulesSchema.parse(value),
    find: (manifest) => manifest.collection?.progressionRules ?? null,
    missingMessage: 'The collection progression rules are unavailable.',
    retryOnHashMismatch: 'always',
  });
}
