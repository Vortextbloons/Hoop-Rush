import { seasonDraftCatalogSchema, type SeasonDraftCatalog } from '../season-draft-catalog.ts';
import { loadJsonAsset } from './load-json.ts';

export function parseSeasonDraftCatalog(value: unknown): SeasonDraftCatalog {
  return seasonDraftCatalogSchema.parse(value);
}

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
