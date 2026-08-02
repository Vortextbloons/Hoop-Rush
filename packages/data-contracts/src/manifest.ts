import { z } from 'zod';
import { contentHashSchema, eraIdSchema, franchiseIdSchema } from './ids.js';
import { franchiseLineageEntrySchema } from './franchise.js';
import { eraDefSchema } from './eras.js';

/**
 * The single build-time manifest the browser loads first (spec/02). It maps
 * (franchiseId, eraId) directly to compact pool assets and carries franchise
 * lineage, era definitions, and asset URL configuration.
 */

export const assetConfigSchema = z.object({
  /** NBA CDN headshot template; {playerExternalId} is substituted at runtime. */
  headshotUrlTemplate: z.string().url().nullable(),
  /** Optional fallback headshot template; {altIds.bbref} is substituted when set. */
  headshotUrlTemplateSecondary: z.string().url().nullable(),
  /** NBA CDN logo template; {teamExternalId} is substituted at runtime. */
  logoUrlTemplate: z.string().url().nullable(),
  /** Optional fallback logo template; {teamAbbreviation} is substituted when set. */
  logoUrlTemplateSecondary: z.string().url().nullable(),
  /** Source attribution for image assets. */
  source: z.string().min(1).max(256),
  /** Cache-busting version for asset URLs. */
  cacheVersion: z.string().min(1).max(64),
});
export type AssetConfig = z.infer<typeof assetConfigSchema>;

export const poolIndexEntrySchema = z.object({
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  /** Relative or absolute URL of the compact FranchiseEraPool asset. */
  url: z.string().min(1).max(512),
  /** SHA-256 content hash of the referenced asset. */
  contentHash: contentHashSchema,
});
export type PoolIndexEntry = z.infer<typeof poolIndexEntrySchema>;

export const simProfileIndexEntrySchema = z.object({
  eraId: eraIdSchema,
  /** Relative or absolute URL of the EraSimulationProfile asset. */
  url: z.string().min(1).max(512),
  /** SHA-256 content hash of the referenced asset. */
  contentHash: contentHashSchema,
});
export type SimProfileIndexEntry = z.infer<typeof simProfileIndexEntrySchema>;

export const opponentIndexEntrySchema = z.object({
  /** Relative or absolute URL of the OpponentBracket artifact. */
  url: z.string().min(1).max(512),
  /** SHA-256 content hash of the referenced artifact. */
  contentHash: contentHashSchema,
});
export type OpponentIndexEntry = z.infer<typeof opponentIndexEntrySchema>;

export const playersIndexAssetSchema = z.object({
  /** Relative or absolute URL of the global players index artifact. */
  url: z.string().min(1).max(512),
  /** SHA-256 content hash of the referenced artifact. */
  contentHash: contentHashSchema,
});
export type PlayersIndexAsset = z.infer<typeof playersIndexAssetSchema>;

export const hoopRushManifestSchema = z.object({
  schemaVersion: z.literal(1),
  dataVersion: z.string().min(1).max(64),
  franchiseLineage: z.array(franchiseLineageEntrySchema),
  eras: z.array(eraDefSchema),
  /** Empty until the M1 packaging pipeline publishes pools. */
  pools: z.array(poolIndexEntrySchema),
  /** Versioned era simulation profiles (M2+), indexed by era. */
  eraSimulationProfiles: z.array(simProfileIndexEntrySchema),
  /** The single frozen opponent bracket (M3+), loaded and cached as a unit. */
  bracket: opponentIndexEntrySchema.optional(),
  /** Global players index (free-form sandbox), loaded and cached as a unit. */
  playersIndex: playersIndexAssetSchema.optional(),
  assets: assetConfigSchema,
});
export type HoopRushManifest = z.infer<typeof hoopRushManifestSchema>;
