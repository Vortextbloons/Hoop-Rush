import { seasonDraftCatalogSchema, type SeasonDraftCatalog } from '../season-draft-catalog.ts';
import { loadJsonAsset } from './load-json.ts';

/** Validate an unknown draft catalog value at a runtime boundary. */
export function parseSeasonDraftCatalog(value: unknown): SeasonDraftCatalog {
  return seasonDraftCatalogSchema.parse(value);
}

/**
 * Fetch, hash-verify, and validate the packaged Season Run draft catalog.
 * When `expectedHash` is provided (manifest content hash), the response bytes
 * must match before the catalog is parsed.
 */
export function loadSeasonDraftCatalog(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<SeasonDraftCatalog> {
  return loadJsonAsset(url, {
    label: 'draft catalog',
    expectedHash,
    parse: parseSeasonDraftCatalog,
    init,
  });
}
