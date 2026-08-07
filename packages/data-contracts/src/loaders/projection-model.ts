import { projectionModelArtifactSchema, type ProjectionModelArtifact } from '../projection.ts';
import { loadJsonAsset } from './load-json.ts';

/** Validate an unknown projection model artifact at a runtime boundary. */
export function parseProjectionModelArtifact(value: unknown): ProjectionModelArtifact {
  return projectionModelArtifactSchema.parse(value);
}

/**
 * Fetch, hash-verify, and validate the packaged projection model artifact
 * (projection-model-v1). When `expectedHash` is provided (manifest content
 * hash), the response bytes must match before the artifact is parsed.
 */
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
