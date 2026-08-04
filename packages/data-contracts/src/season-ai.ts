import { z } from 'zod';
import { franchiseIdSchema, seedSchema } from './ids.js';
import { seasonRosterSchema, seasonOwnershipSchema } from './season-roster.js';
import { seasonRotationSchema } from './season-rotation.js';
import {
  SEASON_AI_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROTATION_VERSION,
} from './season-versions.js';

/**
 * Season Run AI league generation contracts (spec/2.0/03, M2.1). Decision
 * identities alter documented scoring weights only; franchise identity never
 * changes ratings, odds, or player eligibility, and Overall has no pick
 * authority (it appears only as a report field). Generation is seeded,
 * deterministic, and versioned, with repair/backtracking diagnostics that are
 * never relaxed on failure.
 */

/** Strength band quotas for the remaining AI franchises. */
export const seasonStrengthBandSchema = z.enum(['contender', 'playoff', 'average', 'weaker']);
export type SeasonStrengthBand = z.infer<typeof seasonStrengthBandSchema>;

/** The six AI decision identities. */
export const seasonAiIdentitySchema = z.enum([
  'star-chaser',
  'depth-builder',
  'defense-first',
  'shooting-first',
  'continuity',
  'active-trader',
]);
export type SeasonAiIdentity = z.infer<typeof seasonAiIdentitySchema>;

/** The eight basketball roles every roster must cover. */
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

/** Band + identity assignment for one AI franchise. */
export const seasonAiAssignmentSchema = z.object({
  franchiseId: franchiseIdSchema,
  band: seasonStrengthBandSchema,
  identity: seasonAiIdentitySchema,
});
export type SeasonAiAssignment = z.infer<typeof seasonAiAssignmentSchema>;

/** Per-roster strength evaluation from possession inputs. */
export const seasonRosterEvaluationSchema = z.object({
  franchiseId: franchiseIdSchema,
  band: seasonStrengthBandSchema,
  identity: seasonAiIdentitySchema,
  /** 0-100 strength from the possession-input scoring components. */
  strengthScore: z.number().min(0).max(100),
  roleScores: z.record(seasonRosterRoleSchema, z.number().min(0).max(100)),
  rolesCovered: z.array(seasonRosterRoleSchema),
  /** Report-only: mean packaged overall rating; never a pick authority. */
  overallReport: z.number().min(0).max(100).nullable(),
});
export type SeasonRosterEvaluation = z.infer<typeof seasonRosterEvaluationSchema>;

/** Generation diagnostics; present on success and on exhaustion. */
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

/**
 * The atomically produced league generation result: 30 rosters, 300 ownership
 * rows, 30 legal rotations, AI assignments, strength evaluations, diagnostics,
 * and a canonical generation digest.
 */
export const seasonLeagueGenerationResultSchema = z.object({
  schemaVersion: z.literal(1),
  seed: seedSchema,
  aiVersion: z.literal(SEASON_AI_VERSION),
  rosterGenerationVersion: z.literal(SEASON_ROSTER_GENERATION_VERSION),
  rotationVersion: z.literal(SEASON_ROTATION_VERSION),
  rosters: z.array(seasonRosterSchema).length(30),
  ownership: z.array(seasonOwnershipSchema).length(300),
  rotations: z.array(seasonRotationSchema).length(30),
  aiAssignments: z.array(seasonAiAssignmentSchema).length(30),
  evaluations: z.array(seasonRosterEvaluationSchema).length(30),
  diagnostics: seasonGenerationDiagnosticsSchema,
  /** Canonical digest of the result (engine season/digest). */
  digest: z.string().regex(/^[0-9a-f]{32}$/),
});
export type SeasonLeagueGenerationResult = z.infer<typeof seasonLeagueGenerationResultSchema>;

/** One generated league in a calibration cohort. */
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
  repairs: z.number().int().nonnegative(),
  backtracks: z.number().int().nonnegative(),
  nodesVisited: z.number().int().nonnegative(),
  failed: z.boolean(),
  diagnostics: seasonGenerationDiagnosticsSchema.nullable(),
});
export type SeasonRosterCalibrationRun = z.infer<typeof seasonRosterCalibrationRunSchema>;

/** Fixed calibration percentiles for one band or identity. */
export const seasonScoreRangeSchema = z.object({
  /** Frozen range containing at least 95% of held-out scores. */
  range: z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]),
  median: z.number().min(0).max(100),
});
export type SeasonScoreRange = z.infer<typeof seasonScoreRangeSchema>;

/**
 * The frozen `roster-targets-v1` artifact: calibration-derived score ranges
 * per strength band and identity, role coverage minimum, and the verification
 * gates every subsequent audit and calibration cohort must satisfy.
 */
export const seasonRosterTargetsSchema = z.object({
  schemaVersion: z.literal(1),
  targetsVersion: z.literal(SEASON_ROSTER_TARGETS_VERSION),
  calibration: z.object({
    calibrationSeedCount: z.number().int().positive(),
    validationSeedCount: z.number().int().positive(),
    generatedAtIso: z.iso.datetime(),
    aiVersion: z.literal(SEASON_AI_VERSION),
    rosterGenerationVersion: z.literal(SEASON_ROSTER_GENERATION_VERSION),
  }),
  /** Ordered band ranges; contender median must exceed playoff, etc. */
  bands: z.object({
    contender: seasonScoreRangeSchema,
    playoff: seasonScoreRangeSchema,
    average: seasonScoreRangeSchema,
    weaker: seasonScoreRangeSchema,
  }),
  identities: z.record(seasonAiIdentitySchema, seasonScoreRangeSchema),
  /** Minimum distinct roles every roster must cover (8). */
  roleCoverageMinimum: z.number().int().min(1).max(8),
  /** Minimum share of held-out seeds whose per-band medians stay in range. */
  heldOutPassShare: z.number().min(0).max(1),
  /** All quotas every generated league must satisfy. */
  quotas: z.object({
    soloBands: z.object({
      contender: z.number().int().positive(),
      playoff: z.number().int().positive(),
      average: z.number().int().positive(),
      weaker: z.number().int().positive(),
    }),
    /** Two-human generation removes one team from the largest solo quota. */
    duoBands: z.object({
      contender: z.number().int().positive(),
      playoff: z.number().int().positive(),
      average: z.number().int().positive(),
      weaker: z.number().int().positive(),
    }),
  }),
});
export type SeasonRosterTargets = z.infer<typeof seasonRosterTargetsSchema>;
