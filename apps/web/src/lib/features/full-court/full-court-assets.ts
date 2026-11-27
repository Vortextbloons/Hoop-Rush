import {
  seasonDraftCatalogIdentityHash,
  type CapRushCatalogSource,
  type EraSimulationProfile,
  type HoopRushManifest,
  type OpponentBracket,
  type SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import { capRushLeagueFieldOf, type CapRushLeagueField } from '@hoop-rush/engine';
import { cachedAssets } from '#lib/assets/cached-assets.js';
import { loadDraftCatalog } from '#lib/data-assets.js';
import { loadRunPreamble } from '#lib/run-preamble.js';

export interface FullCourtAssets {
  readonly catalog: SeasonDraftCatalog;
  readonly catalogSource: CapRushCatalogSource;
  /** Byte hash of the packaged catalog asset, pinned by health profiles. */
  readonly catalogAssetHash: string;
  readonly field: readonly CapRushLeagueField[];
  readonly profile: EraSimulationProfile;
}

export interface FullCourtAssetLoaders {
  loadCatalog: () => Promise<SeasonDraftCatalog>;
  loadPreamble: () => Promise<{
    manifest: HoopRushManifest;
    profile: EraSimulationProfile;
    bracket: OpponentBracket;
  }>;
}

const defaultLoadCatalog: FullCourtAssetLoaders['loadCatalog'] = () => loadDraftCatalog();
const defaultLoadPreamble: FullCourtAssetLoaders['loadPreamble'] = () =>
  loadRunPreamble((manifest) => manifest.capRushBracket);

const defaultAssets = cachedAssets(() =>
  loadFullCourtAssetsUncached(defaultLoadCatalog, defaultLoadPreamble),
);

/**
 * Full Court drafts from the shared verified catalog and plays Cap Rush's
 * 30-franchise field, so it reads the same packaged assets with the same
 * identity hashes. The unlocked season is built from this result and then
 * frozen by `lockFullCourtRegularSeason`.
 *
 * Injected loaders bypass the module cache so tests and callers can observe
 * each load.
 */
export function loadFullCourtAssets(
  loaders: Partial<FullCourtAssetLoaders> = {},
): Promise<FullCourtAssets> {
  if (loaders.loadCatalog !== undefined || loaders.loadPreamble !== undefined) {
    return loadFullCourtAssetsUncached(
      loaders.loadCatalog ?? defaultLoadCatalog,
      loaders.loadPreamble ?? defaultLoadPreamble,
    );
  }
  return defaultAssets.load();
}

async function loadFullCourtAssetsUncached(
  loadCatalog: FullCourtAssetLoaders['loadCatalog'],
  loadPreamble: FullCourtAssetLoaders['loadPreamble'],
): Promise<FullCourtAssets> {
  const [catalog, preamble] = await Promise.all([loadCatalog(), loadPreamble()]);
  const catalogEntry = preamble.manifest.draftCatalog;
  if (catalogEntry === undefined || preamble.manifest.capRushBracket === undefined) {
    throw new Error('The Full Court data assets are unavailable.');
  }
  const catalogSource: CapRushCatalogSource = {
    catalogVersion: catalog.catalogVersion,
    catalogHash: seasonDraftCatalogIdentityHash(catalogEntry),
    dataVersion: catalog.dataVersion,
    ratingsVersion: catalog.ratingsVersion,
    playerVersionIdVersion: catalog.playerVersionIdVersion,
    positionNormalizationVersion: catalog.positionNormalizationVersion,
  };
  return {
    catalog,
    catalogSource,
    catalogAssetHash: catalogEntry.contentHash,
    field: capRushLeagueFieldOf(preamble.bracket),
    profile: preamble.profile,
  };
}
