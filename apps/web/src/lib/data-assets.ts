import {
  parseProjectionModelArtifact,
  capRushRosterMetadataSchema,
  type CapRushRosterMetadata,
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

export function loadCapRushRosterMetadata(): Promise<CapRushRosterMetadata> {
  return loadManifestAsset({
    key: 'cap-rush/roster-metadata',
    label: 'Cap Rush roster metadata',
    parse: (value: unknown) => capRushRosterMetadataSchema.parse(value),
    find: (manifest) => manifest.capRushRosterMetadata ?? null,
    missingMessage: 'The Cap Rush roster metadata is unavailable.',
  });
}
