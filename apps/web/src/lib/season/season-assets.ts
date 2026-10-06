import {
  parseEraSimulationProfile,
  parseProjectionModelArtifact,
  parseSeasonDraftCatalog,
  seasonFreeAgencyIndexSchema,
  seasonLeagueSchema,
  seasonRosterTargetsSchema,
  seasonScheduleSchema,
  seasonSponsorsIndexSchema,
  type SeasonSponsorsIndex,
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
import { clearMemoizedLoaders, memoized, resolveAssetUrl } from '$lib/asset-url';
import { clearManifestAssetCaches, getManifest, loadManifestAsset } from '$lib/manifest-assets';
export interface SeasonArtifactUrls {
  catalogUrl: string;
  catalogHash: string;
  profileUrl: string;
  profileHash: string;
  modelUrl?: string;
  modelHash?: string;
}
const FIXED_SEASON_ERA = '2010s';

export function loadSeasonLeague(): Promise<SeasonLeague> {
  return loadManifestAsset({
    key: 'season/league',
    label: 'season asset',
    parse: (value: unknown) => seasonLeagueSchema.parse(value),
    find: (manifest) => manifest.season?.league ?? null,
    missingMessage: 'The season league artifact is unavailable.',
  });
}

export function loadSeasonSchedule(): Promise<SeasonSchedule> {
  return loadManifestAsset({
    key: 'season/schedule',
    label: 'season asset',
    parse: (value: unknown) => seasonScheduleSchema.parse(value),
    find: (manifest) => manifest.season?.schedule ?? null,
    missingMessage: 'The season schedule artifact is unavailable.',
  });
}

export function loadSeasonDraftCatalog(): Promise<SeasonDraftCatalog> {
  return loadManifestAsset({
    key: 'season/draft-catalog',
    label: 'draft catalog',
    parse: parseSeasonDraftCatalog,
    find: (manifest) => manifest.season?.draftCatalog ?? null,
    missingMessage: 'The season draft catalog artifact is unavailable.',
  });
}

export function loadSeasonRosterTargets(): Promise<SeasonRosterTargets> {
  return loadManifestAsset({
    key: 'season/roster-targets',
    label: 'season asset',
    parse: (value: unknown) => seasonRosterTargetsSchema.parse(value),
    find: (manifest) => manifest.season?.rosterTargets ?? null,
    missingMessage: 'The season roster-targets artifact is unavailable.',
  });
}

export function loadSeasonEraProfile(): Promise<EraSimulationProfile> {
  return loadManifestAsset({
    key: 'season/era-profile',
    label: 'era simulation profile',
    parse: parseEraSimulationProfile,
    find: (manifest) =>
      manifest.eraSimulationProfiles.find((p) => p.eraId === FIXED_SEASON_ERA) ?? null,
    missingMessage: 'The 2010s era simulation profile is unavailable.',
  });
}

export function loadSeasonFreeAgencyIndex(): Promise<SeasonFreeAgencyIndex> {
  return loadManifestAsset({
    key: 'season/free-agency-index',
    label: 'season asset',
    parse: (value: unknown) => seasonFreeAgencyIndexSchema.parse(value),
    find: (manifest) => manifest.season?.freeAgencyIndex ?? null,
    missingMessage: 'The season free-agency index artifact is unavailable.',
  });
}

export function loadSeasonFreeAgencyTargets(): Promise<SeasonRosterTargets> {
  return loadSeasonRosterTargets();
}

export function loadSeasonHomeCourtProfile(): Promise<SeasonHomeCourtProfile> {
  return Promise.resolve({ ...SEASON_HOME_COURT_PROFILE });
}

export function loadSponsorsIndex(): Promise<SeasonSponsorsIndex | null> {
  return loadManifestAsset({
    key: 'season/sponsors-index',
    label: 'season asset',
    parse: (value: unknown) => seasonSponsorsIndexSchema.parse(value),
    find: (manifest) => manifest.season?.sponsorsIndex ?? null,
    missingMessage: 'The season sponsors index artifact is unavailable.',
    optional: true,
  });
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
  return loadManifestAsset({
    key: 'projection/model',
    label: 'season asset',
    parse: (value: unknown) => parseProjectionModelArtifact(value),
    find: (manifest) => manifest.projection?.model ?? null,
    missingMessage: 'The projection model artifact is unavailable.',
  });
}

export function clearSeasonAssetCaches(): void {
  clearMemoizedLoaders();
  clearManifestAssetCaches('season/');
  clearManifestAssetCaches('projection/');
}
