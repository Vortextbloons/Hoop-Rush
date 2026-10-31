import { projectionModelArtifactSchema, type ProjectionModelArtifact } from '../projection.ts';
export function parseProjectionModelArtifact(value: unknown): ProjectionModelArtifact {
  return projectionModelArtifactSchema.parse(value);
}
