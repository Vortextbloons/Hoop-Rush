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
import { PLAYER_VERSION_ID_VERSION, SEASON_DRAFT_VERSION } from './season-versions.ts';
import { simulationRatingsSchema, simulationTendenciesSchema } from './simulation.ts';

/**
 * The compact packaged Season Run draft catalog (spec/2.0 M2.1). Derived at
 * build time from the validated franchise-era pools, so the browser never
 * scans historical datasets: one deduplicated candidate record per
 * `playerVersionId` with every identity, position, summary, physical,
 * simulation-rating, and tendency field roster scoring needs. Pools reference
 * their members by version id so rolls resolve to candidates directly.
 */

/** One canonical franchise-era pool and its playerVersionId members. */
export const seasonDraftCatalogPoolSchema = z.object({
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  playerVersionIds: z.array(playerVersionIdSchema).min(1),
});
export type SeasonDraftCatalogPool = z.infer<typeof seasonDraftCatalogPoolSchema>;

/**
 * One deduplicated candidate record per playerVersionId. Detailed positions,
 * summary ratings, physical data, simulation ratings, and tendencies are
 * required fields: roster scoring is a pure function of these recorded
 * possession inputs, never of Overall or of anything the browser infers.
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
});
export type SeasonDraftCandidate = z.infer<typeof seasonDraftCandidateSchema>;

export const seasonDraftCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** Catalog contract version; bumps only with the draft rules themselves. */
    catalogVersion: z.literal(SEASON_DRAFT_VERSION),
    dataVersion: z.string().min(1).max(64),
    ratingsVersion: z.string().min(1).max(64),
    positionNormalizationVersion: positionNormalizationVersionSchema,
    playerVersionIdVersion: z.literal(PLAYER_VERSION_ID_VERSION),
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
