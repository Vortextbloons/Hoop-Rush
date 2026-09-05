import { seasonDraftCatalogSchema, type SeasonDraftCatalog } from '@hoop-rush/data-contracts';
const validatedCatalogs = new WeakMap<SeasonDraftCatalog, SeasonDraftCatalog>();
export function validateDraftCatalog(catalog: SeasonDraftCatalog): SeasonDraftCatalog {
  const cached = validatedCatalogs.get(catalog);
  if (cached !== undefined) return cached;
  const parsed = seasonDraftCatalogSchema.safeParse(catalog);
  if (!parsed.success) {
    throw new Error(`draft catalog is invalid: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  validatedCatalogs.set(catalog, parsed.data);
  return parsed.data;
}
