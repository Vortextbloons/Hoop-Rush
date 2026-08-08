import {
  loadEraSimulationProfile,
  loadJsonAsset,
  loadSeasonDraftCatalog as loadPackagedSeasonDraftCatalog,
  parseProjectionModelArtifact,
  parseSeasonDraftCatalog,
  seasonLeagueSchema,
  seasonRosterTargetsSchema,
  seasonScheduleSchema,
  type EraSimulationProfile,
  type ProjectionModelArtifact,
  type SeasonDraftCatalog,
  type SeasonHomeCourtProfile,
  type SeasonLeague,
  type SeasonRosterTargets,
  type SeasonSchedule,
} from '@hoop-rush/data-contracts';
import { SEASON_HOME_COURT_PROFILE } from '@hoop-rush/engine';
import { getManifest } from '$lib/data';
import { clearMemoizedLoaders, memoized, resolveAssetUrl } from '$lib/asset-url';
import { readCachedAsset, writeCachedAsset } from '$lib/pool-cache';

/**
 * PROVISIONAL IMPLEMENTATION — OWNED BY THE LEAD.
 *
 * The lead implements this file in parallel with the M2.3 UI; these exported
 * signatures are FROZEN and must not change. This provisional version lets the
 * screens build and e2e run before the lead's implementation lands; replace
 * the bodies freely (hash-verify + parse semantics should stay identical).
 *
 * Frozen exports:
 *   loadSeasonLeague(): Promise<SeasonLeague>
 *   loadSeasonSchedule(): Promise<SeasonSchedule>
 *   loadSeasonDraftCatalog(): Promise<SeasonDraftCatalog>
 *   loadSeasonEraProfile(): Promise<EraSimulationProfile>   (fixed 2010s)
 *   loadSeasonHomeCourtProfile(): Promise<SeasonHomeCourtProfile>
 *   seasonArtifactUrls(): Promise<SeasonArtifactUrls>       (worker input)
 */

export interface SeasonArtifactUrls {
  catalogUrl: string;
  catalogHash: string;
  profileUrl: string;
  profileHash: string;
  /** Projection milestone: the versioned projection model artifact (absent
   * when the manifest predates the milestone). */
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
    init: { cache: 'no-store' },
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
    // The catalog is immutable and content-addressed; a validated copy in
    // IndexedDB spares a ~10.2 MB re-download and re-parse per reload.
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

/**
 * The fixed season home-court profile. The engine's tuned constant is
 * authoritative (season-home-court-v1); the packaged
 * `season/home-court-targets.json` artifact is the calibration evidence and
 * is validated by the CLI `season home-court calibrate --validate` command.
 */
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

/**
 * Projection milestone: loads the versioned projection model artifact
 * (projection-model-v1) through the hashed asset pipeline, memoized per
 * manifest hash. Throws when the manifest predates the milestone.
 */
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

/** @internal Resets memoized loaders between unit tests. */
export function clearSeasonAssetCaches(): void {
  clearMemoizedLoaders();
}
