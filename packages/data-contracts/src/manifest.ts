import { z } from 'zod';
import { contentHashSchema, eraIdSchema, franchiseIdSchema } from './ids.js';
import { franchiseLineageSchema, modernFranchiseSlotSchema } from './franchise.js';
import { eraDefSchema } from './eras.js';
import { poolAvailabilitySchema } from './provenance.js';

/**
 * The single build-time manifest the browser loads first (spec/02, spec/12).
 * It carries the 30 modern franchise slots, the explicit historical lineage
 * segments, the complete franchise-era availability matrix, era definitions,
 * and asset URL configuration. Pool artifacts are advertised only through
 * the availability matrix; unavailable combinations carry a versioned reason
 * and are never discovered by scanning records.
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

export const hoopRushManifestSchema = z.object({
  schemaVersion: z.literal(2),
  dataVersion: z.string().min(1).max(64),
  /** Exactly 30 stable modern franchise slots (selectable + bracket identity). */
  modernFranchiseSlots: z.array(modernFranchiseSlotSchema).length(30),
  /** Explicit historical lineage segments (relocations, renames, founders). */
  franchiseLineage: franchiseLineageSchema,
  eras: z.array(eraDefSchema),
  /** Available pools only; parallel to the availability matrix. */
  pools: z.array(poolIndexEntrySchema),
  /** Complete franchise-era availability matrix (available + unavailable). */
  availability: z.array(poolAvailabilitySchema),
  /** Versioned era simulation profiles (M2+), indexed by era. */
  eraSimulationProfiles: z.array(simProfileIndexEntrySchema),
  /** The single frozen opponent bracket (M3+), loaded and cached as a unit. */
  bracket: opponentIndexEntrySchema.optional(),
  assets: assetConfigSchema,
});
export type HoopRushManifest = z.infer<typeof hoopRushManifestSchema>;
