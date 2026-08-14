import { projectionModelArtifactSchema, type ProjectionModelArtifact } from '../projection.ts';
import { loadJsonAsset } from './load-json.ts';

export function parseProjectionModelArtifact(value: unknown): ProjectionModelArtifact {
  return projectionModelArtifactSchema.parse(value);
}

export function loadProjectionModelArtifact(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<ProjectionModelArtifact> {
  return loadJsonAsset(url, {
    label: 'projection model',
    expectedHash,
    parse: parseProjectionModelArtifact,
    init,
  });
}
