import { z } from 'zod';
import { franchiseIdSchema, seedSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { seasonRosterSchema, seasonOwnershipSchema } from './season-roster.ts';
import { seasonMinutePolicyStrategySchema, seasonRotationSchema } from './season-rotation.ts';
import {
  SEASON_AI_VERSION,
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROTATION_VERSION,
} from './season-versions.ts';
export const seasonStrengthBandSchema = z.enum(['contender', 'playoff', 'average', 'weaker']);
export type SeasonStrengthBand = z.infer<typeof seasonStrengthBandSchema>;
export const seasonAiIdentitySchema = z.enum([
  'star-chaser',
  'depth-builder',
  'defense-first',
  'shooting-first',
  'continuity',
  'active-trader',
]);
export type SeasonAiIdentity = z.infer<typeof seasonAiIdentitySchema>;
export const seasonRosterRoleSchema = z.enum([
  'primary-creation',
  'secondary-creation',
  'perimeter-shooting',
  'rim-finishing-interior-scoring',
  'perimeter-defense',
  'interior-defense',
  'offensive-rebounding',
  'defensive-rebounding',
]);
export type SeasonRosterRole = z.infer<typeof seasonRosterRoleSchema>;
export const seasonAiAssignmentSchema = z.object({
  franchiseId: franchiseIdSchema,
  band: seasonStrengthBandSchema,
  identity: seasonAiIdentitySchema,
});
export type SeasonAiAssignment = z.infer<typeof seasonAiAssignmentSchema>;
export const seasonRosterProjectionSummarySchema = z.object({
  modelVersion: z.string().min(1).max(64),
  selectedNetRating: z.number(),
  bestNetRating: z.number().nullable(),
  selectedIsBest: z.boolean(),
  searchDigest: seasonCheckpointDigestSchema,
});
export const seasonMinutePlanSummarySchema = z.object({
  policyVersion: z.literal(SEASON_MINUTE_POLICY_VERSION),
  strategy: seasonMinutePolicyStrategySchema,
  riskAdjustedScore: z.number().min(0).max(1),
  quality: z.number().min(0).max(1),
  maxStarterStrainBasisPoints: z.number().min(0).max(10000),
  starterStrainBand: z.enum(['fresh', 'ready', 'tired', 'heavy']),
  benchRelief: z.number().min(0).max(1),
  fatigueBands: z.object({
    fresh: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    tired: z.number().int().nonnegative(),
    heavy: z.number().int().nonnegative(),
  }),
  horizonGames: z.number().int().positive(),
  heavyStrain: z.boolean(),
});
export type SeasonMinutePlanSummary = z.infer<typeof seasonMinutePlanSummarySchema>;
export const seasonRosterEvaluationSchema = z.object({
  franchiseId: franchiseIdSchema,
  band: seasonStrengthBandSchema,
  identity: seasonAiIdentitySchema,
  strengthScore: z.number().min(0).max(100),
  roleScores: z.record(seasonRosterRoleSchema, z.number().min(0).max(100)),
  rolesCovered: z.array(seasonRosterRoleSchema),
  overallReport: z.number().min(0).max(100).nullable(),
  projectionSummary: seasonRosterProjectionSummarySchema.optional(),
  minutePlanSummary: seasonMinutePlanSummarySchema.optional(),
});
export type SeasonRosterEvaluation = z.infer<typeof seasonRosterEvaluationSchema>;
export const seasonGenerationDiagnosticsSchema = z.object({
  seed: seedSchema,
  aiVersion: z.literal(SEASON_AI_VERSION),
  rosterGenerationVersion: z.literal(SEASON_ROSTER_GENERATION_VERSION),
  teamsGenerated: z.number().int().nonnegative(),
  teamsRepaired: z.number().int().nonnegative(),
  backtracks: z.number().int().nonnegative(),
  nodesVisited: z.number().int().nonnegative(),
  nodeBudget: z.number().int().positive(),
  failedTeams: z.array(franchiseIdSchema),
  unmetConstraints: z.array(z.string().min(1).max(256)),
});
export type SeasonGenerationDiagnostics = z.infer<typeof seasonGenerationDiagnosticsSchema>;
export const seasonAiAnchorSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  qualifyingRole: seasonRosterRoleSchema,
  percentileTier: z.literal('elite'),
  roleScore: z.number().min(0).max(100),
  percentileThreshold: z.number().min(0).max(100),
  seedPath: z.array(z.string()).min(1),
});
export type SeasonAiAnchor = z.infer<typeof seasonAiAnchorSchema>;
export const seasonAiPoolSchema = z
  .object({
    franchiseId: franchiseIdSchema,
    band: seasonStrengthBandSchema,
    identity: seasonAiIdentitySchema,
    playerVersionIds: z.array(playerVersionIdSchema).length(20),
    anchors: z.array(seasonAiAnchorSchema),
    selections: z.array(playerVersionIdSchema).length(10),
    allocationSeedPaths: z.array(z.array(z.string()).min(1)).length(10),
    repairCount: z.number().int().nonnegative(),
  })
  .superRefine((pool, ctx) => {
    const members = new Set<string>();
    for (const version of pool.playerVersionIds) {
      if (members.has(version)) {
        ctx.addIssue({
          code: 'custom',
          message: `pool ${pool.franchiseId} holds duplicate version ${version}`,
        });
      }
      members.add(version);
    }
    const selected = new Set<string>();
    for (const version of pool.selections) {
      if (!members.has(version)) {
        ctx.addIssue({
          code: 'custom',
          message: `pool ${pool.franchiseId} selection ${version} is outside the pool`,
        });
      }
      if (selected.has(version)) {
        ctx.addIssue({
          code: 'custom',
          message: `pool ${pool.franchiseId} selection list holds duplicate version ${version}`,
        });
      }
      selected.add(version);
    }
    for (const anchor of pool.anchors) {
      if (!members.has(anchor.playerVersionId)) {
        ctx.addIssue({
          code: 'custom',
          message: `pool ${pool.franchiseId} anchor ${anchor.playerVersionId} is outside the pool`,
        });
      }
    }
  });
export type SeasonAiPool = z.infer<typeof seasonAiPoolSchema>;
export const seasonLeagueGenerationResultSchema = z.object({
  schemaVersion: z.literal(2),
  seed: seedSchema,
  aiVersion: z.literal(SEASON_AI_VERSION),
  rosterGenerationVersion: z.literal(SEASON_ROSTER_GENERATION_VERSION),
  rotationVersion: z.literal(SEASON_ROTATION_VERSION),
  rosters: z.array(seasonRosterSchema).length(30),
  ownership: z.array(seasonOwnershipSchema).length(300),
  rotations: z.array(seasonRotationSchema).length(30),
  aiAssignments: z.array(seasonAiAssignmentSchema).length(30),
  aiPools: z.array(seasonAiPoolSchema).min(28).max(29),
  evaluations: z.array(seasonRosterEvaluationSchema).length(30),
  diagnostics: seasonGenerationDiagnosticsSchema,
  digest: seasonCheckpointDigestSchema,
});
export type SeasonLeagueGenerationResult = z.infer<typeof seasonLeagueGenerationResultSchema>;
export const seasonRosterCalibrationRunSchema = z.object({
  seed: seedSchema,
  teams: z.array(
    z.object({
      franchiseId: franchiseIdSchema,
      band: seasonStrengthBandSchema,
      identity: seasonAiIdentitySchema,
      strengthScore: z.number().min(0).max(100),
      rolesCovered: z.number().int().min(0).max(8),
      roleIds: z.array(seasonRosterRoleSchema),
    }),
  ),
  pools: z.array(seasonAiPoolSchema).min(28).max(29).optional(),
  repairs: z.number().int().nonnegative(),
  backtracks: z.number().int().nonnegative(),
  nodesVisited: z.number().int().nonnegative(),
  failed: z.boolean(),
  diagnostics: seasonGenerationDiagnosticsSchema.nullable(),
});
export type SeasonRosterCalibrationRun = z.infer<typeof seasonRosterCalibrationRunSchema>;
export const seasonScoreRangeSchema = z.object({
  range: z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]),
  median: z.number().min(0).max(100),
});
export type SeasonScoreRange = z.infer<typeof seasonScoreRangeSchema>;
export const seasonMeasuredBandSchema = seasonScoreRangeSchema.extend({
  eliteShare: z.number().min(0).max(1),
  strongShare: z.number().min(0).max(1),
  usefulShare: z.number().min(0).max(1),
});
export type SeasonMeasuredBand = z.infer<typeof seasonMeasuredBandSchema>;
export const seasonRosterTargetsSchema = z.object({
  schemaVersion: z.literal(2),
  targetsVersion: z.literal(SEASON_ROSTER_TARGETS_VERSION),
  policy: z.object({
    bandQuotas: z.object({
      solo: z.object({
        contender: z.literal(4),
        playoff: z.literal(8),
        average: z.literal(10),
        weaker: z.literal(7),
      }),
      duo: z.object({
        contender: z.literal(4),
        playoff: z.literal(8),
        average: z.literal(9),
        weaker: z.literal(7),
      }),
    }),
    guaranteedAnchors: z.object({
      contender: z.literal(2),
      playoff: z.literal(1),
      average: z.literal(0),
      weaker: z.literal(0),
    }),
    extraEliteRollProbability: z.object({
      contender: z.literal(0.65),
      playoff: z.literal(0.35),
      average: z.literal(0.2),
      weaker: z.literal(0.08),
    }),
    tierRanges: z.object({
      contender: z.object({
        elite: z.tuple([z.literal(2), z.literal(4)]),
        strong: z.tuple([z.literal(5), z.literal(8)]),
        useful: z.tuple([z.literal(6), z.literal(10)]),
      }),
      playoff: z.object({
        elite: z.tuple([z.literal(1), z.literal(2)]),
        strong: z.tuple([z.literal(4), z.literal(7)]),
        useful: z.tuple([z.literal(7), z.literal(10)]),
      }),
      average: z.object({
        elite: z.tuple([z.literal(0), z.literal(1)]),
        strong: z.tuple([z.literal(3), z.literal(6)]),
        useful: z.tuple([z.literal(8), z.literal(11)]),
      }),
      weaker: z.object({
        elite: z.tuple([z.literal(0), z.literal(1)]),
        strong: z.tuple([z.literal(1), z.literal(4)]),
        useful: z.tuple([z.literal(7), z.literal(10)]),
      }),
    }),
    identityPriorityRoles: z.object({
      'star-chaser': z.array(seasonRosterRoleSchema).min(1),
      'shooting-first': z.array(seasonRosterRoleSchema).min(1),
      'defense-first': z.array(seasonRosterRoleSchema).min(1),
      'depth-builder': z.array(seasonRosterRoleSchema).min(1),
      continuity: z.array(seasonRosterRoleSchema).min(1),
      'active-trader': z.array(seasonRosterRoleSchema).min(1),
    }),
    roleCoverageThreshold: z.literal(35),
    completionTargets: z.object({
      guards: z.literal(4),
      forwards: z.literal(4),
      centers: z.literal(3),
    }),
    poolSize: z.literal(20),
    rosterSize: z.literal(10),
    percentileTiers: z.object({
      elite: z.literal(0.9),
      strong: z.literal(0.75),
      useful: z.literal(0.5),
    }),
    bandPoolScoreCaps: z.object({
      contender: z.literal(100),
      playoff: z.literal(92),
      average: z.literal(84),
      weaker: z.literal(74),
    }),
    maxPoolStrengthOutliers: z.literal(4),
    maxRosterStrengthOutliers: z.literal(2),
    nodeBudgets: z.object({
      anchorMatching: z.literal(20000),
      poolRepair: z.literal(40000),
      rosterSelection: z.literal(600000),
    }),
  }),
  calibration: z.object({
    calibrationSeedCount: z.number().int().positive(),
    validationSeedCount: z.number().int().positive(),
    generatedAtIso: z.iso.datetime(),
    aiVersion: z.literal(SEASON_AI_VERSION),
    rosterGenerationVersion: z.literal(SEASON_ROSTER_GENERATION_VERSION),
    gates: z.object({
      failureRateMax: z.literal(0),
      minBandSeparation: z.literal(3),
      anchorFulfillmentMin: z.literal(1),
      extraEliteRateTolerance: z.literal(0.05),
      heldOutPassShare: z.literal(0.95),
      orderInvarianceFailuresMax: z.literal(0),
      superTeamIncidenceMax: z.literal(0.08),
    }),
  }),
  measured: z.object({
    bands: z.object({
      contender: seasonMeasuredBandSchema,
      playoff: seasonMeasuredBandSchema,
      average: seasonMeasuredBandSchema,
      weaker: seasonMeasuredBandSchema,
    }),
    identities: z.record(seasonAiIdentitySchema, seasonScoreRangeSchema),
    anchorFulfillment: z.number().min(0).max(1),
    extraEliteRate: z.number().min(0).max(1),
    superTeamIncidence: z.number().min(0).max(1),
    poolLegalityFailures: z.number().int().nonnegative(),
    selectionFailures: z.number().int().nonnegative(),
    generationFailures: z.number().int().nonnegative(),
  }),
});
export type SeasonRosterTargets = z.infer<typeof seasonRosterTargetsSchema>;
