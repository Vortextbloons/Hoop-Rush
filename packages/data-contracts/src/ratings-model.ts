import { z } from 'zod';
export const ratingArchetypeSchema = z.enum([
  'primaryCreator',
  'secondaryCreator',
  'scoringGuard',
  'movementSpacer',
  'twoWayWing',
  'connector',
  'interiorFinisher',
  'stretchBig',
  'rebounder',
  'defensiveAnchor',
]);
export type RatingArchetype = z.infer<typeof ratingArchetypeSchema>;
const archetypeMembershipFields = {
  primaryCreator: z.number().min(0).max(1),
  secondaryCreator: z.number().min(0).max(1),
  scoringGuard: z.number().min(0).max(1),
  movementSpacer: z.number().min(0).max(1),
  twoWayWing: z.number().min(0).max(1),
  connector: z.number().min(0).max(1),
  interiorFinisher: z.number().min(0).max(1),
  stretchBig: z.number().min(0).max(1),
  rebounder: z.number().min(0).max(1),
  defensiveAnchor: z.number().min(0).max(1),
} as const;
export const archetypeMembershipsSchema = z
  .object(archetypeMembershipFields)
  .strict()
  .refine(
    (memberships) =>
      Math.abs(Object.values(memberships).reduce((sum, value) => sum + value, 0) - 1) < 0.00001,
    'archetype memberships must sum to one',
  );
export type ArchetypeMemberships = z.infer<typeof archetypeMembershipsSchema>;
export const nonlinearComponentsSchema = z.object({
  creation: z.number(),
  penetration: z.number(),
  shootingGravity: z.number(),
  scalableScoring: z.number(),
  switchability: z.number(),
  rimProtection: z.number(),
  possessionControl: z.number(),
  synergyBonus: z.number().min(0).max(5),
  weaknessPenalty: z.number().min(-6).max(0),
  weaknesses: z.object({
    turnoverLiability: z.number().min(0).max(6),
    inefficientUsage: z.number().min(0).max(6),
    defensiveTargeting: z.number().min(0).max(6),
    spacingLimitation: z.number().min(0).max(6),
    foulRisk: z.number().min(0).max(6),
    deficientRebounding: z.number().min(0).max(6),
  }),
});
export type NonlinearComponents = z.infer<typeof nonlinearComponentsSchema>;
export const productionEvidenceSchema = z.object({
  score: z.number().min(0).max(100),
  weight: z.number().min(0).max(1),
  confidence: z.enum(['high', 'medium', 'low']),
  sampleGames: z.number().int().nonnegative(),
  sampleMinutes: z.number().nonnegative(),
  shrinkage: z.number().min(0).max(1),
});
export type ProductionEvidence = z.infer<typeof productionEvidenceSchema>;
export const calibratedImpactSchema = z.object({
  adjustment: z.number().min(-6).max(6),
  confidence: z.number().min(0).max(1),
  sampleCount: z.number().int().nonnegative(),
  artifactVersion: z.string().min(1).max(64),
});
export type CalibratedImpact = z.infer<typeof calibratedImpactSchema>;
export const ratingProfileSchema = z.object({
  schemaVersion: z.literal(2),
  modelVersion: z.string().min(1).max(64),
  memberships: archetypeMembershipsSchema,
  baseScore: z.number().min(0).max(100),
  nonlinear: nonlinearComponentsSchema,
  production: productionEvidenceSchema,
  calibratedImpact: calibratedImpactSchema,
  canonicalOverall: z.number().int().min(0).max(100),
  rawOverallScore: z.number().min(-10).max(120),
  overallPercentile: z.number().min(0).max(1).optional(),
  overallCohortVersion: z.string().min(1).max(64).optional(),
  offenseRating: z.number().int().min(0).max(100),
  defenseRating: z.number().int().min(0).max(100),
});
export type RatingProfile = z.infer<typeof ratingProfileSchema>;
export const ratingsModelArtifactSchema = z.object({
  schemaVersion: z.literal(2),
  modelVersion: z.string().min(1).max(64),
  ratingsVersion: z.string().min(1).max(64),
  benchmarkVersion: z.string().min(1).max(64),
  seedVersion: z.string().min(1).max(64),
  confidenceTargetSamplesPerContext: z.number().int().positive(),
  sampleCountPerContext: z.number().int().positive(),
  contexts: z.array(z.enum(['weak', 'average', 'strong', 'interior-heavy', 'perimeter-heavy'])),
  mapping: z.object({
    impactPerNetRating: z.number(),
    impactPerWinProbability: z.number(),
    impactPerEfficiency: z.number(),
    impactPerDefensiveEfficiency: z.number(),
    impactPerTurnovers: z.number(),
    impactPerRebound: z.number(),
    impactPerShotQuality: z.number(),
    shrinkageGames: z.number().positive(),
  }),
  playerAdjustments: z
    .record(
      z.string().min(1),
      z.object({
        adjustment: z.number().min(-6).max(6),
        confidence: z.number().min(0).max(1),
        sampleCount: z.number().int().nonnegative(),
        metrics: z
          .object({
            netRating: z.number(),
            winProbability: z.number(),
            offensiveEfficiency: z.number(),
            defensiveEfficiency: z.number(),
            turnovers: z.number(),
            rebounds: z.number(),
            shotQuality: z.number(),
          })
          .optional(),
      }),
    )
    .optional(),
  distributionTargets: z.object({
    exceptionalMin: z.number().min(95).max(100),
    mvpMin: z.number().min(90).max(100),
    rotationMax: z.number().min(0).max(95),
  }),
  regressionGates: z.array(
    z.object({
      playerId: z.string().min(1),
      min: z.number().min(0).max(100),
      max: z.number().min(0).max(100),
    }),
  ),
  generatedAt: z.iso.datetime(),
});
export type RatingsModelArtifact = z.infer<typeof ratingsModelArtifactSchema>;
