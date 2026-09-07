import {
  collectionCatalogSchema,
  collectionIndexSchema,
  type CollectionCatalog,
  type CollectionIndex,
} from '../collection.ts';
import { loadAsset } from './index.ts';

export function parseCollectionCatalog(value: unknown): CollectionCatalog {
  return collectionCatalogSchema.parse(value);
}

export function loadCollectionCatalog(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<CollectionCatalog> {
  return loadAsset(url, collectionCatalogSchema, 'collection catalog', expectedHash, init);
}

export function parseCollectionIndex(value: unknown): CollectionIndex {
  return collectionIndexSchema.parse(value);
}

export function loadCollectionIndex(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<CollectionIndex> {
  return loadAsset(url, collectionIndexSchema, 'collection index', expectedHash, init);
}
