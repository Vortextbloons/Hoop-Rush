import { z } from 'zod';
import { franchiseIdSchema, seedSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { seasonRosterSchema, seasonOwnershipSchema } from './season-roster.ts';
import { seasonMinutePolicyStrategySchema, seasonRotationSchema } from './season-rotation.ts';
import {
  SEASON_AI_V2,
  SEASON_AI_VERSION,
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_ROSTER_GENERATION_V2,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_TARGETS_V2,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROTATION_VERSION,
} from './season-versions.ts';

/**
 * Season Run AI league generation contracts (spec/2.0/03, M2.1, M2.4
 * roster-generation-v2). Decision identities alter documented scoring
 * weights only; franchise identity never changes ratings, odds, or player
 * eligibility, and Overall has no pick authority (it appears only as a
 * report field). Generation is seeded, deterministic, and versioned, with
 * repair/backtracking diagnostics that are never relaxed on failure.
 *
 * roster-generation-v2 (M2.4) proceeds through one recorded 20-player
 * `SeasonAiPool` per AI franchise (29 solo, 28 duo; human franchises get
 * none). Each pool records its band + identity, 20 distinct candidates, the
 * matched `anchors`, the final ten selections, per-selection allocation
 * seed paths (reproduction), and a `repairCount`. A pool player's tier is
 * its highest tier across all eight roles: elite = score >= the role's p90
 * threshold in at least one role; else strong = >= p75; else useful = >=
 * p50; else depth. Thresholds are nearest-rank per role over the canonically
 * sorted (by playerVersionId) non-human candidates; ties are included. A
 * super team is an average-/weaker-band selected roster whose strengthScore
 * exceeds the contender band's measured median; superTeamIncidence = such
 * rosters / (average + weaker rosters). extraEliteRate = the share of AI
 * teams that received an extra elite anchor beyond the band's guarantees.
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

export const seasonAiAssignmentSchema = z.object({
  franchiseId: franchiseIdSchema,
  band: seasonStrengthBandSchema,
  identity: seasonAiIdentitySchema,
});
export type SeasonAiAssignment = z.infer<typeof seasonAiAssignmentSchema>;

/**
 * Compact projection summary (projection milestone, optional): the
 * projection-ranked facts recorded for a generated roster when the AI
 * generation runs with projection dependencies (shadow mode). Persisted
 * summaries are compact by design; full candidate reports stay CLI artifacts.
 */
export const seasonRosterProjectionSummarySchema = z.object({
  /** projection-model-v1 artifact version that produced the summary. */
  modelVersion: z.string().min(1).max(64),
  /** The selected roster's weighted net rating. */
  selectedNetRating: z.number(),
  /** The best projection-ranked candidate in the pool (null when the search
   * found no complete legal candidate). */
  bestNetRating: z.number().nullable(),
  /** Whether the selected roster equals the projection-best candidate. */
  selectedIsBest: z.boolean(),
  /** Canonical digest of the projection search audit (32-hex). */
  searchDigest: seasonCheckpointDigestSchema,
});

/**
 * Compact minute-plan summary (projection milestone, optional): the
 * risk-adjusted minute-policy facts recorded for a generated roster when the
 * per-team minute-plan optimizer runs (minute-policy-v1). Persisted on the
 * evaluation so a saved run identifies the strategy, risk score, starter
 * strain, bench relief, fatigue projection, and horizon that produced the
 * rotation's target minutes.
 */
export const seasonMinutePlanSummarySchema = z.object({
  policyVersion: z.literal(SEASON_MINUTE_POLICY_VERSION),
  strategy: seasonMinutePolicyStrategySchema,
  /** Risk-adjusted score in 0..1 (quality, then strain, then relief). */
  riskAdjustedScore: z.number().min(0).max(1),
  /** Minute-weighted projected quality in 0..1 (ratings-derived). */
  quality: z.number().min(0).max(1),
  /** Worst-case starter fatigue after the block (basis points). */
  maxStarterStrainBasisPoints: z.number().min(0).max(10000),
  /** Band of the worst starter strain. */
  starterStrainBand: z.enum(['fresh', 'ready', 'tired', 'heavy']),
  /** Bench relief share in 0..1. */
  benchRelief: z.number().min(0).max(1),
  /** Fatigue band counts over the ten rostered players after the block. */
  fatigueBands: z.object({
    fresh: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    tired: z.number().int().nonnegative(),
    heavy: z.number().int().nonnegative(),
  }),
  /** The horizon (games) the plan projected over. */
  horizonGames: z.number().int().positive(),
  /** True when any rostered player projects to the Heavy band. */
  heavyStrain: z.boolean(),
});
export type SeasonMinutePlanSummary = z.infer<typeof seasonMinutePlanSummarySchema>;

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
  /** Projection milestone (optional): compact shadow-mode projection facts. */
  projectionSummary: seasonRosterProjectionSummarySchema.optional(),
  /** Projection milestone (optional): compact minute-plan facts. */
  minutePlanSummary: seasonMinutePlanSummarySchema.optional(),
});
export type SeasonRosterEvaluation = z.infer<typeof seasonRosterEvaluationSchema>;

/** Generation diagnostics; present on success and on exhaustion. */
export const seasonGenerationDiagnosticsSchema = z.object({
  seed: seedSchema,
  aiVersion: z.union([z.literal(SEASON_AI_V2), z.literal(SEASON_AI_VERSION)]),
  rosterGenerationVersion: z.union([
    z.literal(SEASON_ROSTER_GENERATION_V2),
    z.literal(SEASON_ROSTER_GENERATION_VERSION),
  ]),
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
 * One matched guaranteed/extra elite anchor (roster-generation-v2): the
 * highest-priority pool player whose role score cleared the nearest-rank
 * p90 threshold of its qualifying role. `percentileThreshold` records that
 * role's p90 threshold and `seedPath` the derivation path that chose the
 * anchor.
 */
export const seasonAiAnchorSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  qualifyingRole: seasonRosterRoleSchema,
  percentileTier: z.literal('elite'),
  /** 0-100 anchor role score (its qualifying role). */
  roleScore: z.number().min(0).max(100),
  /** The qualifying role's nearest-rank p90 threshold over non-human candidates. */
  percentileThreshold: z.number().min(0).max(100),
  seedPath: z.array(z.string()).min(1),
});
export type SeasonAiAnchor = z.infer<typeof seasonAiAnchorSchema>;

/**
 * One generated 20-player pool for an AI franchise (roster-generation-v2):
 * exactly 20 distinct candidate versions, the matched anchors, the final ten
 * selections (a subset of the pool), one allocation seed path per selection
 * (reproduction), and the number of repairs the pool needed. Human
 * franchises get no pool.
 */
export const seasonAiPoolSchema = z
  .object({
    franchiseId: franchiseIdSchema,
    band: seasonStrengthBandSchema,
    identity: seasonAiIdentitySchema,
    playerVersionIds: z.array(playerVersionIdSchema).length(20),
    anchors: z.array(seasonAiAnchorSchema),
    selections: z.array(playerVersionIdSchema).length(10),
    /** One seed path per selection, in selection order. */
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

/**
 * The atomically produced league generation result: 30 rosters, 300 ownership
 * rows, 30 legal rotations, AI assignments, strength evaluations, the
 * recorded roster-generation-v2 AI pools, diagnostics, and a canonical
 * generation digest. Schema 2 (M2.4) adds the `aiPools` array: one pool per
 * AI franchise (29 solo, 28 duo), each franchise at most once.
 */
export const seasonLeagueGenerationResultSchema = z.object({
  schemaVersion: z.literal(2),
  seed: seedSchema,
  aiVersion: z.union([z.literal(SEASON_AI_V2), z.literal(SEASON_AI_VERSION)]),
  rosterGenerationVersion: z.union([
    z.literal(SEASON_ROSTER_GENERATION_V2),
    z.literal(SEASON_ROSTER_GENERATION_VERSION),
  ]),
  rotationVersion: z.literal(SEASON_ROTATION_VERSION),
  rosters: z.array(seasonRosterSchema).length(30),
  ownership: z.array(seasonOwnershipSchema).length(300),
  rotations: z.array(seasonRotationSchema).length(30),
  aiAssignments: z.array(seasonAiAssignmentSchema).length(30),
  /** M2.4 roster-generation-v2: one pool per AI franchise (29 solo, 28 duo). */
  aiPools: z.array(seasonAiPoolSchema).min(28).max(29),
  evaluations: z.array(seasonRosterEvaluationSchema).length(30),
  diagnostics: seasonGenerationDiagnosticsSchema,
  /** Canonical digest of the result (engine season/digest). */
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
  /** M2.4: recorded pool facts the new gates audit. */
  pools: z.array(seasonAiPoolSchema).min(28).max(29).optional(),
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

/** Per-band measured distribution plus the elite/strong/useful shares. */
export const seasonMeasuredBandSchema = seasonScoreRangeSchema.extend({
  /** Share of rosters whose top tier is elite (0..1). */
  eliteShare: z.number().min(0).max(1),
  /** Share of rosters whose top tier is strong (0..1). */
  strongShare: z.number().min(0).max(1),
  /** Share of rosters whose top tier is useful (0..1). */
  usefulShare: z.number().min(0).max(1),
});
export type SeasonMeasuredBand = z.infer<typeof seasonMeasuredBandSchema>;

/**
 * The frozen `roster-targets-v2` artifact (M2.4): the calibration policy
 * every roster-generation-v2 cohort must satisfy, the verification gates,
 * and the measured facts calibration writes (validation never rewrites
 * `measured`). v2 replaces the v1 artifact; v1 is never produced or read.
 *
 * Definitions: a pool player's tier is its highest tier across all eight
 * roles (elite = score >= p90 threshold in >= 1 role; else strong = >= p75;
 * else useful = >= p50; else depth). Thresholds are nearest-rank per role
 * over canonically sorted non-human candidates; ties are included. A super
 * team is an average-/weaker-band selected roster whose strengthScore
 * exceeds the contender band's measured median; superTeamIncidence = such
 * rosters / (average + weaker rosters). extraEliteRate = the share of AI
 * teams with an extra elite anchor beyond the band's guarantees.
 *
 * Calibration tuning (frozen at the v2 freeze): band separation is
 * anchor-driven — contenders carry two guaranteed elite anchors, playoffs
 * one, average/weaker none — and the max-per-role roster strengthScore
 * compresses the lower bands into the catalog's wide mid-pack, so
 * `minBandSeparation` measures the contender-to-weaker median gap and the
 * ordering gate only requires the contender median to lead every other band.
 * Gate values were frozen from the 256+64 calibration cohort evidence.
 */
export const seasonRosterTargetsSchema = z.object({
  schemaVersion: z.literal(2),
  targetsVersion: z.union([
    z.literal(SEASON_ROSTER_TARGETS_V2),
    z.literal(SEASON_ROSTER_TARGETS_VERSION),
  ]),
  policy: z.object({
    /** Band quotas by human-participant count (solo 29 / duo 28 AI teams). */
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
    /** Guaranteed elite anchors per band, delivered before any extra rolls. */
    guaranteedAnchors: z.object({
      contender: z.literal(2),
      playoff: z.literal(1),
      average: z.literal(0),
      weaker: z.literal(0),
    }),
    /** Probability an AI team beyond its guarantee receives an extra elite anchor. */
    extraEliteRollProbability: z.object({
      contender: z.literal(0.65),
      playoff: z.literal(0.35),
      average: z.literal(0.2),
      weaker: z.literal(0.08),
    }),
    /** Inclusive roster tier-count ranges per band ([min, max] per tier). */
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
    /** Role priority lists per identity; depth-builder/continuity/active-trader use all eight roles. */
    identityPriorityRoles: z.object({
      'star-chaser': z.array(seasonRosterRoleSchema).min(1),
      'shooting-first': z.array(seasonRosterRoleSchema).min(1),
      'defense-first': z.array(seasonRosterRoleSchema).min(1),
      'depth-builder': z.array(seasonRosterRoleSchema).min(1),
      continuity: z.array(seasonRosterRoleSchema).min(1),
      'active-trader': z.array(seasonRosterRoleSchema).min(1),
    }),
    /** Minimum required share (percent) of the pool's candidate depth by role tier. */
    roleCoverageThreshold: z.literal(35),
    /** Roster completion targets (guards/forwards/centers). */
    completionTargets: z.object({
      guards: z.literal(4),
      forwards: z.literal(4),
      centers: z.literal(3),
    }),
    /** Pool size (exactly 20 distinct candidates) and selected roster size. */
    poolSize: z.literal(20),
    rosterSize: z.literal(10),
    /** Nearest-rank percentile thresholds per tier. */
    percentileTiers: z.object({
      elite: z.literal(0.9),
      strong: z.literal(0.75),
      useful: z.literal(0.5),
    }),
    /** Pool strength caps per band (pool players above the cap are strength outliers). */
    bandPoolScoreCaps: z.object({
      contender: z.literal(100),
      playoff: z.literal(92),
      average: z.literal(84),
      weaker: z.literal(74),
    }),
    /** Maximum strength outliers a pool may hold. */
    maxPoolStrengthOutliers: z.literal(4),
    /** Maximum strength outliers a selected roster may hold. */
    maxRosterStrengthOutliers: z.literal(2),
    /** Seeded-search node budgets (anchor matching, pool repair, roster selection). */
    nodeBudgets: z.object({
      anchorMatching: z.literal(20_000),
      poolRepair: z.literal(40_000),
      /**
       * Frozen from the 256+64 calibration cohort: the bounded best-ten
       * fallback must handle pools whose coverage forces a deep search
       * (600_000/29 teams ≈ 20 690 nodes per team; the budget is a rare-path
       * cap, not a per-league cost).
       */
      rosterSelection: z.literal(600_000),
    }),
  }),
  calibration: z.object({
    calibrationSeedCount: z.number().int().positive(),
    validationSeedCount: z.number().int().positive(),
    generatedAtIso: z.iso.datetime(),
    aiVersion: z.union([z.literal(SEASON_AI_V2), z.literal(SEASON_AI_VERSION)]),
    rosterGenerationVersion: z.union([
      z.literal(SEASON_ROSTER_GENERATION_V2),
      z.literal(SEASON_ROSTER_GENERATION_VERSION),
    ]),
    /** Verification gates every subsequent audit and cohort must satisfy. */
    gates: z.object({
      /** Share of generated leagues that may fail generation: none. */
      failureRateMax: z.literal(0),
      /**
       * Contender median minus weaker median, in strength points. Frozen
       * from the 256+64 calibration cohort: the max-per-role roster
       * strengthScore compresses the lower bands into the catalog's wide
       * mid-pack, so the achievable contender-to-weaker gap is ~3.5-4.
       */
      minBandSeparation: z.literal(3),
      /** Share of guaranteed anchors that must be delivered. */
      anchorFulfillmentMin: z.literal(1),
      /** Tolerated deviation of the measured extraEliteRate from the rolled expectation. */
      extraEliteRateTolerance: z.literal(0.05),
      /** Share of held-out seeds whose per-band medians must stay in range. */
      heldOutPassShare: z.literal(0.95),
      /** Order-invariance failures allowed: none. */
      orderInvarianceFailuresMax: z.literal(0),
      /**
       * Maximum share of average/weaker rosters that may exceed the
       * contender median. Frozen from the 256+64 cohort (measured 5-7%).
       */
      superTeamIncidenceMax: z.literal(0.08),
    }),
  }),
  /** Calibration writes these; validation never rewrites them. */
  measured: z.object({
    bands: z.object({
      contender: seasonMeasuredBandSchema,
      playoff: seasonMeasuredBandSchema,
      average: seasonMeasuredBandSchema,
      weaker: seasonMeasuredBandSchema,
    }),
    identities: z.record(seasonAiIdentitySchema, seasonScoreRangeSchema),
    /** Share of guaranteed anchors delivered (0..1). */
    anchorFulfillment: z.number().min(0).max(1),
    /** Share of AI teams with an extra elite anchor beyond guarantees (0..1). */
    extraEliteRate: z.number().min(0).max(1),
    /** Super teams / (average + weaker rosters) (0..1). */
    superTeamIncidence: z.number().min(0).max(1),
    poolLegalityFailures: z.number().int().nonnegative(),
    selectionFailures: z.number().int().nonnegative(),
    generationFailures: z.number().int().nonnegative(),
  }),
});
export type SeasonRosterTargets = z.infer<typeof seasonRosterTargetsSchema>;
