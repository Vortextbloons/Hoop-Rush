import {
  parseProjectionModelArtifact,
  capRushRosterMetadataSchema,
  type CapRushRosterMetadata,
  parseSeasonDraftCatalog,
  parseSeasonPlayoffProfiles,
  applySeasonPlayoffProfiles,
  type HoopRushManifest,
  type ProjectionModelArtifact,
  type SeasonDraftCatalog,
  type SeasonPlayoffProfiles,
} from '@hoop-rush/data-contracts';
import { getManifest, loadManifestAsset } from '#lib/manifest-assets.js';

export function loadDraftCatalog(): Promise<SeasonDraftCatalog> {
  return loadManifestAsset({
    key: 'season/draft-catalog',
    label: 'draft catalog',
    parse: parseSeasonDraftCatalog,
    find: (manifest) => manifest.draftCatalog ?? null,
    missingMessage: 'The season draft catalog artifact is unavailable.',
  });
}

/**
 * Optional split asset: packaged draft/roster artifacts omit playoff evidence,
 * which is only needed once a Cap Rush lineup locks or a roster detail opens.
 * Legacy manifests without the entry resolve to null.
 */
export async function loadPlayoffProfiles(
  manifest?: HoopRushManifest,
): Promise<SeasonPlayoffProfiles | null> {
  const entry = (manifest ?? (await getManifest())).playoffProfiles;
  if (entry === undefined) return null;
  return loadManifestAsset({
    key: `season/playoff-profiles:${entry.contentHash}`,
    entry,
    label: 'playoff profiles',
    parse: parseSeasonPlayoffProfiles,
    find: (manifest) => manifest.playoffProfiles ?? null,
    missingMessage: 'The playoff profiles artifact is unavailable.',
  });
}

let mergedDraftCatalog: Promise<SeasonDraftCatalog> | null = null;

/**
 * The full logical catalog (identity, ratings, and playoff evidence) for
 * consumers that build locked inputs. Cached so catalog-index WeakMaps and
 * resumed Cap Rush runs keep one object identity.
 */
export function loadDraftCatalogWithPlayoffs(): Promise<SeasonDraftCatalog> {
  if (mergedDraftCatalog !== null) return mergedDraftCatalog;
  const promise = Promise.all([loadDraftCatalog(), loadPlayoffProfiles()]).then(
    ([catalog, profiles]) =>
      profiles === null ? catalog : applySeasonPlayoffProfiles(catalog, profiles),
  );
  mergedDraftCatalog = promise;
  promise.catch(() => {
    if (mergedDraftCatalog === promise) mergedDraftCatalog = null;
  });
  return promise;
}

export function clearDraftCatalogMergeCache(): void {
  mergedDraftCatalog = null;
}

export function loadProjectionModel(): Promise<ProjectionModelArtifact> {
  return loadManifestAsset({
    key: 'projection/model',
    label: 'season asset',
    parse: (value: unknown) => parseProjectionModelArtifact(value),
    find: (manifest) => manifest.projection?.model ?? null,
    missingMessage: 'The projection model artifact is unavailable.',
  });
}

export function loadCapRushRosterMetadata(): Promise<CapRushRosterMetadata> {
  return loadManifestAsset({
    key: 'cap-rush/roster-metadata',
    label: 'Cap Rush roster metadata',
    parse: (value: unknown) => capRushRosterMetadataSchema.parse(value),
    find: (manifest) => manifest.capRushRosterMetadata ?? null,
    missingMessage: 'The Cap Rush roster metadata is unavailable.',
  });
}
