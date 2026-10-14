import { join } from 'node:path';
import { z } from 'zod';
import { hoopRushManifestSchema } from '@hoop-rush/data-contracts';
import { PUBLIC_DATA } from '../config.ts';
import { readJsonLoose, writeJsonRetry } from '../json.ts';

export function manifestPath(): string {
  return join(PUBLIC_DATA, 'manifest.json');
}

export const MANIFEST_PATH = manifestPath();

const manifestEraSchema = z.looseObject({
  eraId: z.string(),
  label: z.string().optional(),
  fromSeasonKey: z.string(),
  toSeasonKey: z.string(),
});
export const manifestPoolEntrySchema = z.looseObject({
  franchiseId: z.string(),
  eraId: z.string(),
  url: z.string(),
  contentHash: z.string(),
});
const manifestAssetRefSchema = z.looseObject({
  url: z.string(),
  contentHash: z.string(),
});
export const manifestSimProfileSchema = z.looseObject({
  eraId: z.string(),
});
export type ManifestSimIndexEntry = {
  eraId: string;
  url: string;
  contentHash: string;
};
export const importerManifestSchema = z.looseObject({
  schemaVersion: z.number(),
  dataVersion: z.string(),
  modernFranchiseSlots: z.array(z.unknown()).optional(),
  franchiseLineage: z.array(z.unknown()).optional(),
  eras: z.array(manifestEraSchema),
  pools: z.array(manifestPoolEntrySchema).optional(),
  availability: z.array(z.unknown()).optional(),
  eraSimulationProfiles: z.array(z.unknown()).optional(),
  bracket: manifestAssetRefSchema.optional(),
  playersIndex: manifestAssetRefSchema.optional(),
  rosterDetails: manifestAssetRefSchema.optional(),
  draftCatalog: manifestAssetRefSchema.optional(),
  collection: z
    .looseObject({
      catalog: manifestAssetRefSchema,
      index: manifestAssetRefSchema,
      packTargets: manifestAssetRefSchema.optional(),
    })
    .optional(),
  assets: z
    .looseObject({
      source: z.string().optional(),
      cacheVersion: z.string().optional(),
    })
    .optional(),
});
export type Manifest = z.infer<typeof importerManifestSchema>;

export function writeManifestValidated(path: string, manifest: Manifest): void {
  const validated = hoopRushManifestSchema.safeParse(manifest);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    throw new Error(
      `manifest fails validation: ${issue?.path.join('.') || '(root)'} ${issue?.message ?? 'unknown'}`,
    );
  }
  writeJsonRetry(path, manifest, true);
}

const poolManifestEraSchema = z.looseObject({
  eraId: z.string(),
  label: z.string(),
  fromSeasonKey: z.string(),
  toSeasonKey: z.string(),
});
const poolManifestSchema = importerManifestSchema.extend({
  eras: z.array(poolManifestEraSchema),
  pools: z.array(manifestPoolEntrySchema),
});
export type EraEntry = z.infer<typeof poolManifestEraSchema>;
export type PoolIndexEntry = z.infer<typeof manifestPoolEntrySchema>;
export type PoolManifest = z.infer<typeof poolManifestSchema>;

export function loadManifest(): PoolManifest {
  const raw = readJsonLoose(manifestPath());
  const parsed = poolManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`invalid manifest: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  return parsed.data;
}
