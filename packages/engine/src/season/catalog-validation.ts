import { seasonDraftCatalogSchema, type SeasonDraftCatalog } from '@hoop-rush/data-contracts';

/**
 * Schema-validates a draft catalog once per object identity. Catalogs are
 * treated as immutable packaged data: replay loops and calibration cohorts
 * pass the same object hundreds of times, and re-validating all 7,933+
 * candidates on every command would dominate the runtime. Validation is a
 * pure function of the input, so memoizing by identity never changes results.
 */
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
