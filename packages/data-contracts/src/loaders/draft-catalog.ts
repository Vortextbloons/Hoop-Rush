import { seasonDraftCatalogSchema, type SeasonDraftCatalog } from '../season-draft-catalog.ts';
import { loadAsset } from './index.ts';
export function parseSeasonDraftCatalog(value: unknown): SeasonDraftCatalog {
    return seasonDraftCatalogSchema.parse(value);
}
export function loadSeasonDraftCatalog(url: string, expectedHash?: string, init?: RequestInit): Promise<SeasonDraftCatalog> {
    return loadAsset(url, seasonDraftCatalogSchema, 'draft catalog', expectedHash, init);
}
