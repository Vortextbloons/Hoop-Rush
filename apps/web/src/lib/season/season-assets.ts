import {
  loadEraSimulationProfile,
  loadJsonAsset,
  loadSeasonDraftCatalog as loadPackagedSeasonDraftCatalog,
  parseProjectionModelArtifact,
  parseSeasonDraftCatalog,
  seasonFreeAgencyIndexSchema,
  seasonLeagueSchema,
  seasonRosterTargetsSchema,
  seasonScheduleSchema,
  type EraSimulationProfile,
  type ProjectionModelArtifact,
  type SeasonDraftCatalog,
  type SeasonFreeAgencyIndex,
  type SeasonHomeCourtProfile,
  type SeasonLeague,
  type SeasonRosterTargets,
  type SeasonSchedule,
} from '@hoop-rush/data-contracts';
import { SEASON_HOME_COURT_PROFILE } from '@hoop-rush/engine';
import { getManifest } from '$lib/data';
import { clearMemoizedLoaders, memoized, resolveAssetUrl } from '$lib/asset-url';
import { readCachedAsset, writeCachedAsset } from '$lib/pool-cache';
export interface SeasonArtifactUrls {
  catalogUrl: string;
  catalogHash: string;
  profileUrl: string;
  profileHash: string;
  modelUrl?: string;
  modelHash?: string;
}
const FIXED_SEASON_ERA = '2010s';
async function fetchVerified<T>(
  url: string,
  contentHash: string,
  parse: (value: unknown) => T,
): Promise<T> {
  return loadJsonAsset(url, {
    label: 'season asset',
    expectedHash: contentHash,
    parse,
  });
}
export function loadSeasonLeague(): Promise<SeasonLeague> {
  return memoized('season/league', async () => {
    const manifest = await getManifest();
    const entry = manifest.season?.league;
    if (!entry) throw new Error('The season league artifact is unavailable.');
    return fetchVerified(resolveAssetUrl(entry.url), entry.contentHash, (value: unknown) =>
      seasonLeagueSchema.parse(value),
    );
  });
}
export function loadSeasonSchedule(): Promise<SeasonSchedule> {
  return memoized('season/schedule', async () => {
    const manifest = await getManifest();
    const entry = manifest.season?.schedule;
    if (!entry) throw new Error('The season schedule artifact is unavailable.');
    return fetchVerified(resolveAssetUrl(entry.url), entry.contentHash, (value: unknown) =>
      seasonScheduleSchema.parse(value),
    );
  });
}
export function loadSeasonDraftCatalog(): Promise<SeasonDraftCatalog> {
  return memoized('season/draft-catalog', async () => {
    const manifest = await getManifest();
    const entry = manifest.season?.draftCatalog;
    if (!entry) throw new Error('The season draft catalog artifact is unavailable.');
    const cached = await readCachedAsset(entry.contentHash, parseSeasonDraftCatalog);
    if (cached !== null) return cached;
    const catalog = await loadPackagedSeasonDraftCatalog(
      resolveAssetUrl(entry.url),
      entry.contentHash,
    );
    void writeCachedAsset(entry.contentHash, catalog);
    return catalog;
  });
}
export function loadSeasonRosterTargets(): Promise<SeasonRosterTargets> {
  return memoized('season/roster-targets', async () => {
    const manifest = await getManifest();
    const entry = manifest.season?.rosterTargets;
    if (!entry) throw new Error('The season roster-targets artifact is unavailable.');
    return fetchVerified(resolveAssetUrl(entry.url), entry.contentHash, (value: unknown) =>
      seasonRosterTargetsSchema.parse(value),
    );
  });
}
export function loadSeasonEraProfile(): Promise<EraSimulationProfile> {
  return memoized('season/era-profile', async () => {
    const manifest = await getManifest();
    const entry = manifest.eraSimulationProfiles.find((p) => p.eraId === FIXED_SEASON_ERA);
    if (!entry) throw new Error('The 2010s era simulation profile is unavailable.');
    return loadEraSimulationProfile(resolveAssetUrl(entry.url), entry.contentHash);
  });
}
export function loadSeasonFreeAgencyIndex(): Promise<SeasonFreeAgencyIndex> {
  return memoized('season/free-agency-index', async () => {
    const manifest = await getManifest();
    const entry = manifest.season?.freeAgencyIndex;
    if (!entry) throw new Error('The season free-agency index artifact is unavailable.');
    const cached = await readCachedAsset(entry.contentHash, (value: unknown) =>
      seasonFreeAgencyIndexSchema.parse(value),
    );
    if (cached !== null) return cached;
    const index = await fetchVerified(
      resolveAssetUrl(entry.url),
      entry.contentHash,
      (value: unknown) => seasonFreeAgencyIndexSchema.parse(value),
    );
    void writeCachedAsset(entry.contentHash, index);
    return index;
  });
}
export function loadSeasonFreeAgencyTargets(): Promise<SeasonRosterTargets> {
  return loadSeasonRosterTargets();
}
export function loadSeasonHomeCourtProfile(): Promise<SeasonHomeCourtProfile> {
  return Promise.resolve({ ...SEASON_HOME_COURT_PROFILE });
}
export function seasonArtifactUrls(): Promise<SeasonArtifactUrls> {
  return memoized('season/artifact-urls', async () => {
    const manifest = await getManifest();
    const catalog = manifest.season?.draftCatalog;
    const profile = manifest.eraSimulationProfiles.find((p) => p.eraId === FIXED_SEASON_ERA);
    if (!catalog || !profile) throw new Error('Season worker artifacts are unavailable.');
    const model = manifest.projection?.model;
    return {
      catalogUrl: resolveAssetUrl(catalog.url),
      catalogHash: catalog.contentHash,
      profileUrl: resolveAssetUrl(profile.url),
      profileHash: profile.contentHash,
      ...(model !== undefined
        ? { modelUrl: resolveAssetUrl(model.url), modelHash: model.contentHash }
        : {}),
    };
  });
}
export function loadSeasonProjectionModel(): Promise<ProjectionModelArtifact> {
  return memoized('projection/model', async () => {
    const manifest = await getManifest();
    const entry = manifest.projection?.model;
    if (!entry) throw new Error('The projection model artifact is unavailable.');
    return fetchVerified(resolveAssetUrl(entry.url), entry.contentHash, (value: unknown) =>
      parseProjectionModelArtifact(value),
    );
  });
}
export function clearSeasonAssetCaches(): void {
  clearMemoizedLoaders();
}
