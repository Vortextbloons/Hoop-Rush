import { z } from 'zod';
import { contentHashSchema, eraIdSchema, franchiseIdSchema } from './ids.ts';
import { franchiseLineageSchema, modernFranchiseSlotSchema } from './franchise.ts';
import { eraDefSchema } from './eras.ts';
import { poolAvailabilitySchema } from './provenance.ts';
import { MANIFEST_SCHEMA_VERSION } from './versions.ts';
export const assetConfigSchema = z.object({
  headshotUrlTemplate: z.url().nullable(),
  headshotUrlTemplateSecondary: z.url().nullable(),
  logoUrlTemplate: z.url().nullable(),
  logoUrlTemplateSecondary: z.url().nullable(),
  source: z.string().min(1).max(256),
  cacheVersion: z.string().min(1).max(64),
});
export type AssetConfig = z.infer<typeof assetConfigSchema>;
export const poolIndexEntrySchema = z.object({
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  url: z.string().min(1).max(512),
  contentHash: contentHashSchema,
});
export type PoolIndexEntry = z.infer<typeof poolIndexEntrySchema>;
export const simProfileIndexEntrySchema = z.object({
  eraId: eraIdSchema,
  url: z.string().min(1).max(512),
  contentHash: contentHashSchema,
});
export type SimProfileIndexEntry = z.infer<typeof simProfileIndexEntrySchema>;
export const opponentIndexEntrySchema = z.object({
  url: z.string().min(1).max(512),
  contentHash: contentHashSchema,
});
export type OpponentIndexEntry = z.infer<typeof opponentIndexEntrySchema>;
export const playersIndexAssetSchema = z.object({
  url: z.string().min(1).max(512),
  contentHash: contentHashSchema,
});
export type PlayersIndexAsset = z.infer<typeof playersIndexAssetSchema>;
export const seasonArtifactIndexEntrySchema = z.object({
  url: z.string().min(1).max(512),
  contentHash: contentHashSchema,
});
export type SeasonArtifactIndexEntry = z.infer<typeof seasonArtifactIndexEntrySchema>;
export const hoopRushManifestSchema = z.object({
  schemaVersion: z.union([z.literal(3), z.literal(MANIFEST_SCHEMA_VERSION)]),
  dataVersion: z.string().min(1).max(64),
  modernFranchiseSlots: z.array(modernFranchiseSlotSchema).length(30),
  franchiseLineage: franchiseLineageSchema,
  eras: z.array(eraDefSchema),
  pools: z.array(poolIndexEntrySchema),
  availability: z.array(poolAvailabilitySchema),
  eraSimulationProfiles: z.array(simProfileIndexEntrySchema),
  bracket: opponentIndexEntrySchema.optional(),
  playersIndex: playersIndexAssetSchema.optional(),
  rosterDetails: playersIndexAssetSchema.optional(),
  season: z
    .object({
      league: seasonArtifactIndexEntrySchema,
      schedule: seasonArtifactIndexEntrySchema,
      draftCatalog: seasonArtifactIndexEntrySchema,
      rosterTargets: seasonArtifactIndexEntrySchema,
      freeAgencyIndex: seasonArtifactIndexEntrySchema.optional(),
      freeAgencyTargets: seasonArtifactIndexEntrySchema.optional(),
    })
    .optional(),
  projection: z
    .object({
      model: seasonArtifactIndexEntrySchema,
    })
    .optional(),
  collection: z
    .object({
      catalog: seasonArtifactIndexEntrySchema,
      index: seasonArtifactIndexEntrySchema,
      packTargets: seasonArtifactIndexEntrySchema.optional(),
    })
    .optional(),
  assets: assetConfigSchema,
});
export type HoopRushManifest = z.infer<typeof hoopRushManifestSchema>;
