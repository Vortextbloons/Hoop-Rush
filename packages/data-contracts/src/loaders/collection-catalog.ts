import { collectionCatalogSchema, type CollectionCatalog } from '../collection.ts';

export function parseCollectionCatalog(value: unknown): CollectionCatalog {
  return collectionCatalogSchema.parse(value);
}
