import { z } from 'zod';
import { contentHashSchema, playerIdSchema } from './ids.ts';
import {
  positionNormalizationVersionSchema,
  positionSchema,
  positionUnionSchema,
} from './positions.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import {
  seasonFreeAgencyBandSchema,
  seasonFreeAgencyRoleExpectationSchema,
} from './season-free-agency.ts';
import { SEASON_FREE_AGENCY_INDEX_VERSION } from './season-versions.ts';

/**
 * M2.6.5 packaged free-agent eligibility index (spec/2.0/15,
 * free-agency-index-v1). A manifest-hashed compact artifact derived at
 * build time from the VALIDATED draft catalog (never by scanning browser
 * data). It groups eligible versions by real `playerId`; the run selects at
 * most one canonical version per identity through the named seed tree.
 *
 * Eligibility/exclusion rules (frozen by the index contract):
 * - every indexed version carries identity, positions, band, supported
 *   roles, minimum Influence cost, factual strengths/limitations,
 *   durability/availability facts, compact player-slice facts, the catalog
 *   reference, derivation evidence, and exclusion evidence;
 * - elite-tier versions are excluded;
 * - candidates missing any rating, position, simulation, replay, identity,
 *   or presentation fact are excluded;
 * - bands derive from the existing detailed-role and roster-target scoring,
 *   never from Overall alone.
 *
 * The index freezes its version, input hashes, derivation parameters,
 * identity mapping, quality thresholds, and exclusion evidence. The engine
 * reads it as the runtime universe minus owned versions, versions whose
 * real-player identity is already active in the league, and versions signed
 * earlier in the run.
 */

/** One indexed candidate version (identity, facts, and derivation evidence). */
export const seasonFreeAgencyIndexEntrySchema = z.object({
  playerVersionId: playerVersionIdSchema,
  playerId: playerIdSchema,
  displayName: z.string().min(1).max(96),
  positions: z.object({
    primary: positionSchema,
    secondary: z.array(positionSchema).max(4),
    playable: positionUnionSchema,
    normalizationVersion: positionNormalizationVersionSchema,
  }),
  band: seasonFreeAgencyBandSchema,
  /** Minimum Influence commitment: emergency 1; role/development 1-2; featured 2-3. */
  minimumInfluence: z.number().int().min(1).max(3),
  supportedRoles: z.array(seasonFreeAgencyRoleExpectationSchema).min(1).max(3),
  /** Factual strengths, max 8. */
  strengths: z.array(z.string().min(1).max(160)).max(8),
  /** Factual limitations, max 8. */
  limitations: z.array(z.string().min(1).max(160)).max(8),
  durabilityRating: z.number().int().min(45).max(95),
  minutesPerGame: z.number().min(0).max(60),
  availability: z.object({
    healthy: z.boolean(),
    notes: z.string().max(256),
  }),
  /** Reference into the source draft catalog (artifact + candidate index). */
  catalogRef: z.object({
    catalogVersion: z.string().min(1).max(64),
    dataVersion: z.string().min(1).max(64),
    candidateIndex: z.number().int().nonnegative(),
  }),
  /** Why this version is eligible and indexed (recorded facts). */
  derivationEvidence: z.string().min(1).max(256),
  /** Why sibling versions of the same identity are excluded (recorded facts). */
  exclusionEvidence: z.string().max(256),
});
export type SeasonFreeAgencyIndexEntry = z.infer<typeof seasonFreeAgencyIndexEntrySchema>;

/**
 * The compact packaged index. `groupedVersions` maps each identity to its
 * eligible version ids (the runtime groups once, in canonical order);
 * `derivation` freezes the source catalog reference, the input content
 * hashes, and the derivation parameters/quality thresholds so the artifact
 * self-documents and audits can verify it was not hand-edited.
 */
export const seasonFreeAgencyIndexSchema = z
  .object({
    schemaVersion: z.literal(1),
    indexVersion: z.literal(SEASON_FREE_AGENCY_INDEX_VERSION),
    dataVersion: z.string().min(1).max(64),
    /** The draft catalog artifact this index derives from. */
    catalogRef: z.object({
      catalogVersion: z.string().min(1).max(64),
      /** SHA-256 content hash of the source catalog artifact. */
      contentHash: contentHashSchema,
      candidateCount: z.number().int().nonnegative(),
    }),
    /** One entry per eligible candidate version (identity-unique at runtime selection). */
    candidates: z.array(seasonFreeAgencyIndexEntrySchema).min(1),
    /** Eligible versions grouped by real playerId, canonical order. */
    groupedVersions: z.record(playerIdSchema, z.array(playerVersionIdSchema).min(1)),
  })
  .superRefine((index, ctx) => {
    const versions = new Set<string>();
    for (const candidate of index.candidates) {
      if (versions.has(candidate.playerVersionId)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate indexed version ${candidate.playerVersionId}`,
        });
      }
      versions.add(candidate.playerVersionId);
    }
    for (const [playerId, versionIds] of Object.entries(index.groupedVersions)) {
      for (const versionId of versionIds) {
        if (!versions.has(versionId)) {
          ctx.addIssue({
            code: 'custom',
            message: `grouped version ${versionId} has no candidate entry (identity ${playerId})`,
          });
        }
        const entry = index.candidates.find((candidate) => candidate.playerVersionId === versionId);
        if (entry !== undefined && entry.playerId !== playerId) {
          ctx.addIssue({
            code: 'custom',
            message: `grouped identity ${playerId} contains version ${versionId} of identity ${entry.playerId}`,
          });
        }
      }
    }
  });
export type SeasonFreeAgencyIndex = z.infer<typeof seasonFreeAgencyIndexSchema>;
