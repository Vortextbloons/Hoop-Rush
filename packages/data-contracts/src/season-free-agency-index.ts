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
import {
  SEASON_FREE_AGENCY_INDEX_VERSION,
  SEASON_FREE_AGENCY_INDEX_VERSION_V1,
} from './season-versions.ts';
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
  minimumInfluence: z.number().int().min(1).max(3),
  supportedRoles: z.array(seasonFreeAgencyRoleExpectationSchema).min(1).max(3),
  strengths: z.array(z.string().min(1).max(160)).max(8),
  limitations: z.array(z.string().min(1).max(160)).max(8),
  durabilityRating: z.number().int().min(45).max(95),
  minutesPerGame: z.number().min(0).max(60),
  availability: z.object({
    healthy: z.boolean(),
    notes: z.string().max(256),
  }),
  catalogRef: z.object({
    catalogVersion: z.string().min(1).max(64),
    dataVersion: z.string().min(1).max(64),
    candidateIndex: z.number().int().nonnegative(),
  }),
  derivationEvidence: z.string().min(1).max(256),
  exclusionEvidence: z.string().max(256),
});
export type SeasonFreeAgencyIndexEntry = z.infer<typeof seasonFreeAgencyIndexEntrySchema>;
export const seasonFreeAgencyIndexSchema = z
  .object({
    schemaVersion: z.literal(1),
    indexVersion: z.union([
      z.literal(SEASON_FREE_AGENCY_INDEX_VERSION),
      z.literal(SEASON_FREE_AGENCY_INDEX_VERSION_V1),
    ]),
    dataVersion: z.string().min(1).max(64),
    catalogRef: z.object({
      catalogVersion: z.string().min(1).max(64),
      contentHash: contentHashSchema,
      candidateCount: z.number().int().nonnegative(),
    }),
    candidates: z.array(seasonFreeAgencyIndexEntrySchema).min(1),
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
