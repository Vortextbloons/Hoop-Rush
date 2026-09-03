import { projectionModelArtifactSchema, type ProjectionModelArtifact } from '../projection.ts';
import { loadAsset } from './index.ts';
export function parseProjectionModelArtifact(value: unknown): ProjectionModelArtifact {
    return projectionModelArtifactSchema.parse(value);
}
export function loadProjectionModelArtifact(url: string, expectedHash?: string, init?: RequestInit): Promise<ProjectionModelArtifact> {
    return loadAsset(url, projectionModelArtifactSchema, 'projection model', expectedHash, init);
}
