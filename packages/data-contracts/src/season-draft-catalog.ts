import { z } from 'zod';
import { eraIdSchema, franchiseIdSchema, playerExternalIdSchema, playerIdSchema, seasonKeySchema, } from './ids.ts';
import { positionNormalizationVersionSchema, positionSchema, positionUnionSchema, } from './positions.ts';
import { summaryRatingsSchema } from './player-season.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { PLAYER_VERSION_ID_VERSION, SEASON_DRAFT_CATALOG_VERSION, SEASON_DURABILITY_VERSION, SEASON_STAMINA_LEGACY_VERSION, SEASON_STAMINA_VERSION, } from './season-versions.ts';
import { reconstructedThreePointProfileSchema, simulationAnchorsSchema, simulationRatingsSchema, simulationTendenciesSchema, } from './simulation.ts';
export const SEASON_DRAFT_CATALOG_V3 = 'season-draft-catalog-v3';
export const seasonDraftCatalogPoolSchema = z.object({
    franchiseId: franchiseIdSchema,
    eraId: eraIdSchema,
    playerVersionIds: z.array(playerVersionIdSchema).min(1),
});
export type SeasonDraftCatalogPool = z.infer<typeof seasonDraftCatalogPoolSchema>;
export const seasonDraftCandidateStaminaSchema = z.object({
    rating: z.number().int().min(45).max(95),
    historicalMpg: z.number().min(0).max(60),
    derivationVersion: z.union([
        z.literal(SEASON_STAMINA_VERSION),
        z.literal(SEASON_STAMINA_LEGACY_VERSION),
    ]),
});
export type SeasonDraftCandidateStamina = z.infer<typeof seasonDraftCandidateStaminaSchema>;
export const seasonDraftCandidateDurabilitySchema = z.object({
    rating: z.number().int().min(45).max(95),
    derivationVersion: z.literal(SEASON_DURABILITY_VERSION),
});
export type SeasonDraftCandidateDurability = z.infer<typeof seasonDraftCandidateDurabilitySchema>;
export const seasonDraftCandidateSchema = z.object({
    playerVersionId: playerVersionIdSchema,
    playerId: playerIdSchema,
    franchiseId: franchiseIdSchema,
    eraId: eraIdSchema,
    seasonKey: seasonKeySchema,
    displayName: z.string().min(1).max(96),
    playerExternalId: playerExternalIdSchema,
    positions: z.object({
        primary: positionSchema,
        secondary: z.array(positionSchema).max(4),
        playable: positionUnionSchema,
        normalizationVersion: positionNormalizationVersionSchema,
    }),
    heightInches: z.number().int().min(60).max(96).nullable(),
    weightLbs: z.number().int().min(120).max(400).nullable(),
    summaryRatings: summaryRatingsSchema,
    detailedRatings: simulationRatingsSchema,
    tendencies: simulationTendenciesSchema,
    stamina: seasonDraftCandidateStaminaSchema,
    durability: seasonDraftCandidateDurabilitySchema,
    anchors: simulationAnchorsSchema.optional(),
    reconstructedThreePoint: reconstructedThreePointProfileSchema.optional(),
});
export type SeasonDraftCandidate = z.infer<typeof seasonDraftCandidateSchema>;
export const seasonDraftCatalogSchema = z
    .object({
    schemaVersion: z.literal(1),
    catalogVersion: z.union([
        z.literal(SEASON_DRAFT_CATALOG_VERSION),
        z.literal(SEASON_DRAFT_CATALOG_V3),
    ]),
    dataVersion: z.string().min(1).max(64),
    ratingsVersion: z.string().min(1).max(64),
    positionNormalizationVersion: positionNormalizationVersionSchema,
    playerVersionIdVersion: z.literal(PLAYER_VERSION_ID_VERSION),
    staminaVersion: z.union([
        z.literal(SEASON_STAMINA_VERSION),
        z.literal(SEASON_STAMINA_LEGACY_VERSION),
    ]),
    durabilityVersion: z.literal(SEASON_DURABILITY_VERSION),
    pools: z.array(seasonDraftCatalogPoolSchema).min(1),
    candidates: z.array(seasonDraftCandidateSchema).min(1),
})
    .superRefine((catalog, ctx) => {
    const seen = new Set<string>();
    for (const candidate of catalog.candidates) {
        if (seen.has(candidate.playerVersionId)) {
            ctx.addIssue({
                code: 'custom',
                message: `duplicate candidate version ${candidate.playerVersionId}`,
            });
        }
        seen.add(candidate.playerVersionId);
        if (catalog.catalogVersion === SEASON_DRAFT_CATALOG_VERSION && !candidate.anchors) {
            ctx.addIssue({
                code: 'custom',
                message: `v4 candidate ${candidate.playerVersionId} is missing the validated anchors`,
            });
        }
    }
    for (const pool of catalog.pools) {
        for (const member of pool.playerVersionIds) {
            if (!seen.has(member)) {
                ctx.addIssue({
                    code: 'custom',
                    message: `pool ${pool.franchiseId}/${pool.eraId} references unknown version ${member}`,
                });
            }
        }
    }
});
export type SeasonDraftCatalog = z.infer<typeof seasonDraftCatalogSchema>;
