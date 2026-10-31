import { seasonDraftCatalogSchema, type SeasonDraftCatalog } from '../season-draft-catalog.ts';
export function parseSeasonDraftCatalog(value: unknown): SeasonDraftCatalog {
  return seasonDraftCatalogSchema.parse(value);
}
