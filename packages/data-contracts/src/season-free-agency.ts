import { z } from 'zod';
import { commandIdSchema, franchiseIdSchema, idSchema, playerIdSchema } from './ids.ts';
import {
  positionNormalizationVersionSchema,
  positionSchema,
  positionUnionSchema,
} from './positions.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_FREE_AGENCY_VERSION } from './season-versions.ts';
export const seasonFreeAgencyBandSchema = z.enum(['featured', 'role', 'development', 'emergency']);
export type SeasonFreeAgencyBand = z.infer<typeof seasonFreeAgencyBandSchema>;
export const seasonFreeAgencyRoleExpectationSchema = z.enum(['rotation', 'depth', 'emergency']);
export type SeasonFreeAgencyRoleExpectation = z.infer<typeof seasonFreeAgencyRoleExpectationSchema>;
export const seasonFreeAgencyCandidateSchema = z.object({
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
export type SeasonFreeAgencyCandidate = z.infer<typeof seasonFreeAgencyCandidateSchema>;
export const seasonFreeAgencyCanonicalSchema = z.object({
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema,
  band: seasonFreeAgencyBandSchema,
  admittedWindowIndex: z.number().int().min(0).max(2),
  seedPath: z.array(z.string()).min(1),
});
export type SeasonFreeAgencyCanonical = z.infer<typeof seasonFreeAgencyCanonicalSchema>;
export const seasonFreeAgencyTargetSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  roleExpectation: seasonFreeAgencyRoleExpectationSchema,
  influence: z.number().int().min(1).max(3),
});
export type SeasonFreeAgencyTarget = z.infer<typeof seasonFreeAgencyTargetSchema>;
export const seasonFreeAgencyDeclarationSchema = z.object({
  franchiseId: franchiseIdSchema,
  windowIndex: z.number().int().min(0).max(2),
  commandId: commandIdSchema,
  targets: z.array(seasonFreeAgencyTargetSchema).min(0).max(2),
});
export type SeasonFreeAgencyDeclaration = z.infer<typeof seasonFreeAgencyDeclarationSchema>;
export const seasonFreeAgencyTraceStepSchema = z.object({
  candidatePlayerVersionId: playerVersionIdSchema,
  franchiseId: franchiseIdSchema,
  criterion: z.enum([
    'legality',
    'role-credibility',
    'need',
    'identity-fit',
    'opportunity',
    'influence',
    'draw',
  ]),
  category: z.string().min(1).max(32),
  citedFacts: z.array(z.string().min(1).max(256)).max(8),
});
export type SeasonFreeAgencyTraceStep = z.infer<typeof seasonFreeAgencyTraceStepSchema>;
export const seasonFreeAgencyResolutionTraceSchema = z.object({
  windowIndex: z.number().int().min(0).max(2),
  seedPath: z.array(z.string()).min(1),
  steps: z.array(seasonFreeAgencyTraceStepSchema),
  firstPriorityWinners: z.array(
    z.object({
      candidatePlayerVersionId: playerVersionIdSchema,
      winnerFranchiseId: franchiseIdSchema,
    }),
  ),
  secondPriorityWinners: z.array(
    z.object({
      candidatePlayerVersionId: playerVersionIdSchema,
      winnerFranchiseId: franchiseIdSchema,
    }),
  ),
  signingFranchiseId: franchiseIdSchema.nullable(),
  signedPlayerVersionId: playerVersionIdSchema.nullable(),
  resolution: z.enum(['signed', 'no-signing']),
});
export type SeasonFreeAgencyResolutionTrace = z.infer<typeof seasonFreeAgencyResolutionTraceSchema>;
export const seasonFreeAgencySigningSchema = z.object({
  signingId: idSchema,
  windowIndex: z.number().int().min(0).max(2),
  franchiseId: franchiseIdSchema,
  playerVersionId: playerVersionIdSchema,
  playerId: playerIdSchema,
  band: seasonFreeAgencyBandSchema,
  roleExpectation: seasonFreeAgencyRoleExpectationSchema,
  influenceCost: z.number().int().min(1).max(3),
  commandId: commandIdSchema,
  seedPath: z.array(z.string()).min(1),
  ledgerEntryId: idSchema,
  transactionId: idSchema,
  appliedAtStateRevision: z.number().int().nonnegative(),
});
export type SeasonFreeAgencySigning = z.infer<typeof seasonFreeAgencySigningSchema>;
export const seasonFreeAgencyWindowStatusSchema = z.enum(['open', 'resolved']);
export type SeasonFreeAgencyWindowStatus = z.infer<typeof seasonFreeAgencyWindowStatusSchema>;
export const seasonFreeAgencyWindowStateSchema = z
  .object({
    windowIndex: z.number().int().min(0).max(2),
    blockIndex: z.number().int().min(2).max(6),
    status: seasonFreeAgencyWindowStatusSchema,
    candidates: z.array(seasonFreeAgencyCandidateSchema).min(1).max(12),
    declarations: z.record(franchiseIdSchema, seasonFreeAgencyDeclarationSchema),
    traces: z.array(seasonFreeAgencyResolutionTraceSchema),
    signings: z.array(seasonFreeAgencySigningSchema),
  })
  .superRefine((window, ctx) => {
    const versions = new Set<string>();
    const identities = new Set<string>();
    const featured = new Set<string>();
    for (const candidate of window.candidates) {
      if (versions.has(candidate.playerVersionId)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate candidate version ${candidate.playerVersionId}`,
        });
      }
      versions.add(candidate.playerVersionId);
      if (identities.has(candidate.playerId)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate candidate identity ${candidate.playerId}`,
        });
      }
      identities.add(candidate.playerId);
      if (candidate.band === 'featured') featured.add(candidate.playerId);
    }
    if (featured.size > 1) {
      ctx.addIssue({
        code: 'custom',
        message: `window must contain at most one featured candidate (found ${String(featured.size)})`,
      });
    }
    for (const signing of window.signings) {
      if (!versions.has(signing.playerVersionId)) {
        ctx.addIssue({
          code: 'custom',
          message: `signing ${signing.playerVersionId} is not a window candidate`,
        });
      }
    }
  });
export type SeasonFreeAgencyWindowState = z.infer<typeof seasonFreeAgencyWindowStateSchema>;
export const seasonFreeAgencyStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    freeAgencyVersion: z.literal(SEASON_FREE_AGENCY_VERSION),
    windows: z.array(seasonFreeAgencyWindowStateSchema).max(3),
    canonicalCandidates: z.record(playerIdSchema, seasonFreeAgencyCanonicalSchema),
    signingCounts: z.record(franchiseIdSchema, z.number().int().min(0).max(3)),
    seasonSpend: z.record(franchiseIdSchema, z.number().int().min(0).max(6)),
  })
  .superRefine((state, ctx) => {
    if (Object.keys(state.signingCounts).length !== 30) {
      ctx.addIssue({
        code: 'custom',
        message: `free-agency signing counts must cover all 30 franchises (found ${String(Object.keys(state.signingCounts).length)})`,
      });
    }
    if (Object.keys(state.seasonSpend).length !== 30) {
      ctx.addIssue({
        code: 'custom',
        message: `free-agency season spend must cover all 30 franchises (found ${String(Object.keys(state.seasonSpend).length)})`,
      });
    }
  });
export type SeasonFreeAgencyState = z.infer<typeof seasonFreeAgencyStateSchema>;
