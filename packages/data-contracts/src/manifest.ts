import { z } from 'zod';
import { simulationPlayerSchema } from './simulation.ts';
import { contentHashSchema, eraIdSchema, franchiseIdSchema, seasonKeySchema } from './ids.ts';
import { franchiseLineageSchema, modernFranchiseSlotSchema } from './franchise.ts';
import { eraDefSchema } from './eras.ts';
import { poolAvailabilitySchema } from './provenance.ts';
import { MANIFEST_SCHEMA_VERSION } from './versions.ts';
export const capRushRosterMetadataSchema = z.object({
  fieldHash: contentHashSchema,
  players: z
    .array(
      simulationPlayerSchema.pick({ playerId: true, ratings: true, tendencies: true }).extend({
        teamId: franchiseIdSchema,
        seasonKey: seasonKeySchema,
        overall: z.number().int().min(0).max(100),
      }),
    )
    .length(150),
});
export type CapRushRosterMetadata = z.infer<typeof capRushRosterMetadataSchema>;

export const assetConfigSchema = z.object({
  headshotUrlTemplate: z.url().nullable(),
  headshotUrlTemplateSecondary: z.url().nullable(),
  logoUrlTemplate: z.url().nullable(),
  logoUrlTemplateSecondary: z.url().nullable(),
  source: z.string().min(1).max(256),
  cacheVersion: z.string().min(1).max(64),
});
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
export const seasonArtifactIndexEntrySchema = z.object({
  url: z.string().min(1).max(512),
  contentHash: contentHashSchema,
});
/**
 * The draft catalog is packaged without optional playoff evidence. Its asset
 * hash pins the shipped bytes, while `identityHash` pins the full logical
 * catalog (including split evidence) so seeded saves keep resuming across
 * compatible packaging changes.
 */
export const seasonDraftCatalogAssetSchema = seasonArtifactIndexEntrySchema.extend({
  identityHash: contentHashSchema.optional(),
});
export type SeasonDraftCatalogAsset = z.infer<typeof seasonDraftCatalogAssetSchema>;
/** Logical catalog identity used by version locks; legacy assets fall back to their byte hash. */
export function seasonDraftCatalogIdentityHash<T extends string>(entry: {
  readonly contentHash: T;
  readonly identityHash?: T | undefined;
}): T {
  return entry.identityHash ?? entry.contentHash;
}
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
  capRushBracket: opponentIndexEntrySchema.optional(),
  capRushRosterMetadata: opponentIndexEntrySchema.optional(),
  playersIndex: playersIndexAssetSchema.optional(),
  rosterDetails: playersIndexAssetSchema
    .extend({ playoffProfilesSplit: z.literal(true).optional() })
    .optional(),
  draftCatalog: seasonDraftCatalogAssetSchema.optional(),
  playoffProfiles: seasonArtifactIndexEntrySchema.optional(),
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
      gameRules: seasonArtifactIndexEntrySchema.optional(),
      gameTargets: seasonArtifactIndexEntrySchema.optional(),
      progressionRules: seasonArtifactIndexEntrySchema.optional(),
      progressionTargets: seasonArtifactIndexEntrySchema.optional(),
    })
    .optional(),
  assets: assetConfigSchema,
});
export type HoopRushManifest = z.infer<typeof hoopRushManifestSchema>;
