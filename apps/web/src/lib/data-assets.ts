import {
  parseProjectionModelArtifact,
  parseSeasonDraftCatalog,
  type ProjectionModelArtifact,
  type SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import { loadManifestAsset } from '#lib/manifest-assets.js';

export function loadDraftCatalog(): Promise<SeasonDraftCatalog> {
  return loadManifestAsset({
    key: 'season/draft-catalog',
    label: 'draft catalog',
    parse: parseSeasonDraftCatalog,
    find: (manifest) => manifest.draftCatalog ?? null,
    missingMessage: 'The season draft catalog artifact is unavailable.',
  });
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
