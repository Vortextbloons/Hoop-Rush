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
import { getBracket, getEraSimulationProfile, getManifest } from '#lib/data.js';
import { loadDraftCatalog } from '#lib/data-assets.js';

export const FULL_COURT_ERA_ID = '2020s';
export const FULL_COURT_LEGACY_ERA_ID = '2010s';

export interface FullCourtAssets {
  readonly catalog: SeasonDraftCatalog;
  readonly catalogSource: CapRushCatalogSource;
  /** Byte hash of the packaged catalog asset, pinned by health profiles. */
  readonly catalogAssetHash: string;
  readonly field: readonly CapRushLeagueField[];
  readonly profile: EraSimulationProfile;
  readonly loadLegacyProfile?: () => Promise<EraSimulationProfile | null>;
}

export interface FullCourtAssetLoaders {
  loadCatalog: () => Promise<SeasonDraftCatalog>;
  loadPreamble: () => Promise<{
    manifest: HoopRushManifest;
    profile: EraSimulationProfile;
    bracket: OpponentBracket;
    legacyProfile?: EraSimulationProfile | null;
  }>;
}

const defaultLoadCatalog: FullCourtAssetLoaders['loadCatalog'] = () => loadDraftCatalog();
const defaultLoadPreamble: FullCourtAssetLoaders['loadPreamble'] = async () => {
  const manifest = await getManifest();
  const profileEntry = manifest.eraSimulationProfiles.find(
    (profile) => profile.eraId === FULL_COURT_ERA_ID,
  );
  if (!profileEntry) {
    throw new Error(`The ${FULL_COURT_ERA_ID} simulation profile is unavailable.`);
  }
  const bracketEntry = manifest.capRushBracket;
  if (!bracketEntry) {
    throw new Error('The Full Court data assets are unavailable.');
  }
  const [profile, bracket] = await Promise.all([
    getEraSimulationProfile(profileEntry),
    getBracket(bracketEntry),
  ]);
  return { manifest, profile, bracket };
};

const defaultLegacyProfile = cachedAssets(async (): Promise<EraSimulationProfile | null> => {
  const manifest = await getManifest();
  const legacyEntry = manifest.eraSimulationProfiles.find(
    (profile) => profile.eraId === FULL_COURT_LEGACY_ERA_ID,
  );
  if (!legacyEntry) return null;
  return getEraSimulationProfile(legacyEntry);
});

const defaultAssets = cachedAssets(() =>
  loadFullCourtAssetsUncached(defaultLoadCatalog, defaultLoadPreamble, () =>
    defaultLegacyProfile.load(),
  ),
);

/**
 * Full Court drafts from the shared verified catalog, simulates under the
 * packaged 2020s era profile, and plays Cap Rush's 30-franchise field.
 * Existing saves created under the legacy 2010s profile resolve through
 * `loadLegacyProfile` when verifying their locked season digest.
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
  loadLegacyProfile?: () => Promise<EraSimulationProfile | null>,
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
  const resolvedLegacyLoader =
    preamble.legacyProfile !== undefined
      ? () => Promise.resolve(preamble.legacyProfile ?? null)
      : loadLegacyProfile;
  return {
    catalog,
    catalogSource,
    catalogAssetHash: catalogEntry.contentHash,
    field: capRushLeagueFieldOf(preamble.bracket),
    profile: preamble.profile,
    ...(resolvedLegacyLoader === undefined ? {} : { loadLegacyProfile: resolvedLegacyLoader }),
  };
}
