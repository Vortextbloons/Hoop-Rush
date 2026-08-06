import { z } from 'zod';
import {
  eraIdSchema,
  franchiseIdSchema,
  playerExternalIdSchema,
  playerIdSchema,
  seasonKeySchema,
} from './ids.ts';
import {
  positionNormalizationVersionSchema,
  positionSchema,
  positionUnionSchema,
} from './positions.ts';
import { summaryRatingsSchema } from './player-season.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import {
  PLAYER_VERSION_ID_VERSION,
  SEASON_DRAFT_CATALOG_VERSION,
  SEASON_DURABILITY_VERSION,
  SEASON_STAMINA_VERSION,
} from './season-versions.ts';
import { simulationRatingsSchema, simulationTendenciesSchema } from './simulation.ts';

/**
 * The compact packaged Season Run draft catalog (spec/2.0 M2.1, M2.4,
 * M2.5). Derived at build time from the validated franchise-era pools, so
 * the browser never scans historical datasets: one deduplicated candidate
 * record per `playerVersionId` with every identity, position, summary,
 * physical, simulation-rating, tendency, stamina, and durability field
 * roster scoring needs. Pools reference their members by version id so
 * rolls resolve to candidates directly. Since season-draft-catalog-v2
 * (M2.4) each candidate carries its build-time stamina profile and the
 * catalog records the stamina derivation version; since v3 (M2.5) each
 * candidate also carries its build-time durability rating and the catalog
 * records the durability derivation version.
 */

/** One canonical franchise-era pool and its playerVersionId members. */
export const seasonDraftCatalogPoolSchema = z.object({
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  playerVersionIds: z.array(playerVersionIdSchema).min(1),
});
export type SeasonDraftCatalogPool = z.infer<typeof seasonDraftCatalogPoolSchema>;

/**
 * Build-time stamina profile inside a catalog candidate (season-stamina-v1).
 * Slim by design: the version identity already lives on the candidate, so
 * the game controller expands this into the full `seasonStaminaInputSchema`
 * (adding schemaVersion and playerVersionId) when it builds player inputs.
 */
export const seasonDraftCandidateStaminaSchema = z.object({
  /** 45..95 stamina rating derived from historical MPG (45 = floor). */
  rating: z.number().int().min(45).max(95),
  /** Recorded historical minutes per game, capped at 60. */
  historicalMpg: z.number().min(0).max(60),
  derivationVersion: z.literal(SEASON_STAMINA_VERSION),
});
export type SeasonDraftCandidateStamina = z.infer<typeof seasonDraftCandidateStaminaSchema>;

/**
 * Build-time durability rating inside a catalog candidate (durability-v1,
 * M2.5): `round(clamp(45, 95, 45 + 50 * gamesPlayed / max(1, teamGames)))`
 * from recorded games played and eligibility team games (45 = floor when
 * stats are missing). Feeds the seeded injury-risk formula; never Overall.
 */
export const seasonDraftCandidateDurabilitySchema = z.object({
  /** 45..95 durability rating (45 = floor). */
  rating: z.number().int().min(45).max(95),
  derivationVersion: z.literal(SEASON_DURABILITY_VERSION),
});
export type SeasonDraftCandidateDurability = z.infer<typeof seasonDraftCandidateDurabilitySchema>;

/**
 * One deduplicated candidate record per playerVersionId. Detailed positions,
 * summary ratings, physical data, simulation ratings, tendencies, the M2.4
 * stamina profile, and the M2.5 durability rating are required fields:
 * roster scoring is a pure function of these recorded possession inputs,
 * never of Overall or of anything the browser infers.
 */
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
  /** M2.4: build-time stamina profile (season-stamina-v1). */
  stamina: seasonDraftCandidateStaminaSchema,
  /** M2.5: build-time durability rating (durability-v1). */
  durability: seasonDraftCandidateDurabilitySchema,
});
export type SeasonDraftCandidate = z.infer<typeof seasonDraftCandidateSchema>;

export const seasonDraftCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    /**
     * Catalog artifact contract version (season-draft-catalog-v3 since M2.5
     * added the durability profile; v2 since M2.4 added stamina);
     * independent of the draft rules version.
     */
    catalogVersion: z.literal(SEASON_DRAFT_CATALOG_VERSION),
    dataVersion: z.string().min(1).max(64),
    ratingsVersion: z.string().min(1).max(64),
    positionNormalizationVersion: positionNormalizationVersionSchema,
    playerVersionIdVersion: z.literal(PLAYER_VERSION_ID_VERSION),
    /** M2.4: stamina profile derivation version for every candidate. */
    staminaVersion: z.literal(SEASON_STAMINA_VERSION),
    /** M2.5: durability profile derivation version for every candidate. */
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
