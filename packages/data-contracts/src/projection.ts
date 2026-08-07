import { z } from 'zod';
import type { EraSimulationProfile } from './era-sim-profile.ts';
import { contentHashSchema, eraIdSchema, playerIdSchema, seedSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { PROJECTION_MODEL_VERSION, PROJECTION_SCHEMA_VERSION } from './season-versions.ts';
import type { SimulationPlayer } from './simulation.ts';
import { simulationPlayerSchema } from './simulation.ts';

/**
 * Base-five possession projection contracts (projection milestone). A base
 * projection is a deterministic, calculation-only estimate of one legal
 * `G, G, F, F, C` lineup against a versioned neutral reference for an era:
 * the exact expected values of the possession engine's pure probability
 * functions, aggregated without any random draw. The projector never
 * samples; it is seedless and byte-identical for identical inputs. The
 * same base projector serves every Season unit — Season code never
 * recreates lineup-performance formulas.
 *
 * The reference lineups live in the versioned `ProjectionModelArtifact`
 * (projection-model-v1), derived at build time from era-level population
 * aggregates. No Overall-derived value is used anywhere.
 */

/** Canonical projection slot order (G, G, F, F, C with positional identity). */
export const PROJECTION_SLOTS = ['G1', 'G2', 'F1', 'F2', 'C'] as const;
export const projectionSlotSchema = z.enum(PROJECTION_SLOTS);
export type ProjectionSlot = z.infer<typeof projectionSlotSchema>;

/** Matchup archetype references (spec: neutral, perimeter, interior, pressure, size/switch). */
export const PROJECTION_MATCHUP_ARCHETYPES = [
  'neutral',
  'perimeter',
  'interior',
  'pressure',
  'size-switch',
] as const;
export const projectionMatchupArchetypeSchema = z.enum(PROJECTION_MATCHUP_ARCHETYPES);
export type ProjectionMatchupArchetype = z.infer<typeof projectionMatchupArchetypeSchema>;

/**
 * One versioned synthetic reference five. Players are population aggregates
 * in canonical slot order (G1, G2, F1, F2, C) with no player-specific
 * bonuses, identity modifiers, or exceptions.
 */
export const projectionReferenceFiveSchema = z.object({
  referenceId: z.string().min(1).max(64),
  archetype: projectionMatchupArchetypeSchema,
  eraId: eraIdSchema,
  /** SHA-256 content hash of the five-player snapshot (build-time). */
  referenceHash: contentHashSchema,
  players: z.tuple([
    simulationPlayerSchema,
    simulationPlayerSchema,
    simulationPlayerSchema,
    simulationPlayerSchema,
    simulationPlayerSchema,
  ]),
});
export type ProjectionReferenceFive = z.infer<typeof projectionReferenceFiveSchema>;

/** Normalization baselines for one projected component (0-100 scale). */
export const projectionComponentScaleSchema = z.object({
  /** Component value at the neutral population midpoint (maps to ~50). */
  baseline: z.number(),
  /** Unit change in the raw component that moves the normalized score one point. */
  perPoint: z.number().positive(),
  /** Hard floor for the normalized score (0-100). */
  min: z.number().min(0).max(100),
  /** Hard ceiling for the normalized score (0-100). */
  max: z.number().min(0).max(100),
  /** Whether higher raw values are better. */
  higherIsBetter: z.boolean(),
});
export type ProjectionComponentScale = z.infer<typeof projectionComponentScaleSchema>;

/** Weakness severity. Critical weaknesses reject a candidate; others reduce rank. */
export const projectionWeaknessSeveritySchema = z.enum(['critical', 'major', 'minor']);
export type ProjectionWeaknessSeverity = z.infer<typeof projectionWeaknessSeveritySchema>;

/** One identified projection weakness: code, severity, threshold, value, evidence. */
export const projectionWeaknessSchema = z.object({
  code: z.string().min(1).max(64),
  severity: projectionWeaknessSeveritySchema,
  /** The component threshold this weakness triggered. */
  threshold: z.number(),
  /** The measured component value that violated the threshold. */
  value: z.number(),
  /** Human-readable evidence strings naming the recorded facts. */
  evidence: z.array(z.string().min(1)).min(1),
});
export type ProjectionWeakness = z.infer<typeof projectionWeaknessSchema>;

/** Frozen weakness policy table inside the model artifact. */
export const projectionWeaknessPolicySchema = z.object({
  code: z.string().min(1).max(64),
  severity: projectionWeaknessSeveritySchema,
  /** Component threshold; the direction of the violation is artifact-defined. */
  threshold: z.number(),
  /** Ranking penalty weight (used as weight x severity^2). */
  weight: z.number().min(0),
  /** Measured value must be at most this for max-side components, or at least
   * this for min-side components (the check direction is recorded per code). */
  minSide: z.boolean(),
  /** Short explanatory template for evidence lines. */
  message: z.string().min(1).max(256),
});
export type ProjectionWeaknessPolicy = z.infer<typeof projectionWeaknessPolicySchema>;

/**
 * Bounded candidate-search policy (projection-model-v1). Search is seeded
 * only for reproducible candidate ordering and tie-breaking; it never
 * changes base projection math.
 */
export const projectionSearchPolicySchema = z.object({
  seedNamespace: z.string().min(1).max(64),
  /** Partial roster beams kept per search lens. */
  partialBeamsPerLens: z.number().int().positive(),
  /** Complete roster candidates kept per pool or human build. */
  completeCandidates: z.number().int().positive(),
  /** Legal starting fives considered per roster. */
  startingFives: z.number().int().positive(),
  /** Legal closing fives considered per roster. */
  closingFives: z.number().int().positive(),
  /** Bench hierarchies considered per roster (presets + templates + orders). */
  benchHierarchies: z.number().int().positive(),
  /** Additional minute templates beyond the three official presets. */
  minuteTemplates: z.number().int().positive(),
  /** Single-player contingency removals: all. */
  singleRemovals: z.literal('all'),
  /** Pair-removal stress cases per roster. */
  pairRemovals: z.number().int().positive(),
  /** Node budgets per search phase. */
  nodeBudgets: z.object({
    partial: z.number().int().positive(),
    complete: z.number().int().positive(),
    rotation: z.number().int().positive(),
  }),
  /** Weight of the close-game rotation trace when combining normal and close traces. */
  closeScenarioWeight: z.number().min(0).max(1),
});
export type ProjectionSearchPolicy = z.infer<typeof projectionSearchPolicySchema>;

/** Monotonic sanity gate: improving a raw component must never worsen its projection. */
export const projectionMonotonicGateSchema = z.object({
  code: z.string().min(1).max(64),
  /** Raw component that improves. */
  driver: z.string().min(1).max(64),
  /** Projected component that must not worsen. */
  output: z.string().min(1).max(64),
  description: z.string().min(1).max(256),
});
export type ProjectionMonotonicGate = z.infer<typeof projectionMonotonicGateSchema>;

/** Frozen calibration cohort definitions inside the model artifact. */
export const projectionCohortPolicySchema = z.object({
  calibrationGames: z.number().int().positive(),
  validationGames: z.number().int().positive(),
  heldOutGames: z.number().int().positive(),
  /** Seed ranges per cohort; disjoint by construction. */
  calibrationSeedFrom: seedSchema,
  calibrationSeedTo: seedSchema,
  validationSeedFrom: seedSchema,
  validationSeedTo: seedSchema,
  heldOutSeedFrom: seedSchema,
  heldOutSeedTo: seedSchema,
});
export type ProjectionCohortPolicy = z.infer<typeof projectionCohortPolicySchema>;

/**
 * The versioned `projection-model-v1` artifact: per-era neutral and archetype
 * references, normalization scales, ranking group weights, weakness policy,
 * search policy, cohort definitions, and monotonic gates. Calibration may
 * tune only the calibration cohort; validation selects a frozen model
 * release; the held-out cohort never rewrites coefficients.
 */
export const projectionModelArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  modelVersion: z.literal(PROJECTION_MODEL_VERSION),
  dataVersion: z.string().min(1).max(64),
  ratingsVersion: z.string().min(1).max(64),
  /** Era profile version per era (matches the era-sim artifact profileVersion). */
  eraProfileVersions: z.record(eraIdSchema, z.string().min(1).max(64)),
  references: z
    .record(
      eraIdSchema,
      z.object({
        neutral: projectionReferenceFiveSchema,
        archetypes: z
          .array(projectionReferenceFiveSchema)
          .min(PROJECTION_MATCHUP_ARCHETYPES.length - 1)
          .max(PROJECTION_MATCHUP_ARCHETYPES.length - 1),
      }),
    )
    .refine((references) => Object.keys(references).length >= 1, {
      message: 'the model must carry at least one era reference set',
    }),
  /** 0-100 normalization for every named projected component. */
  scales: z.record(z.string().min(1).max(64), projectionComponentScaleSchema),
  /** Composite-score weights per named component group (tuned by calibration). */
  componentWeights: z.record(z.string().min(1).max(64), z.number().min(0)),
  /** Composite ranking group weights. */
  weights: z.object({
    basketballMean: z.literal(0.4),
    rotationMean: z.literal(0.35),
    robustnessMean: z.literal(0.25),
  }),
  weaknesses: z.array(projectionWeaknessPolicySchema),
  search: projectionSearchPolicySchema,
  cohorts: projectionCohortPolicySchema,
  monotonicGates: z.array(projectionMonotonicGateSchema).min(1),
});
export type ProjectionModelArtifact = z.infer<typeof projectionModelArtifactSchema>;

/**
 * The deterministic expected ledger of one side over a fixed number of
 * possessions (per 100). Every rate is the exact expectation over the
 * possession engine's pure probability functions; nothing is sampled.
 */
export const projectionLedgerSchema = z.object({
  /** Baseline possessions (always 100; rates are pace-free by construction). */
  possessions: z.literal(100),
  turnoverRate: z.number().min(0).max(1),
  nonShootingFoulRate: z.number().min(0).max(1),
  /** Share of possessions ending in a shot attempt. */
  shotRate: z.number().min(0).max(1),
  fieldGoalAttempts: z.number().min(0).max(100),
  fieldGoalMakes: z.number().min(0).max(100),
  twoPointAttempts: z.number().min(0).max(100),
  twoPointMakes: z.number().min(0).max(100),
  threePointAttempts: z.number().min(0).max(100),
  threePointMakes: z.number().min(0).max(100),
  freeThrowAttempts: z.number().min(0).max(300),
  freeThrowMakes: z.number().min(0).max(300),
  fieldGoalPct: z.number().min(0).max(1),
  twoPointPct: z.number().min(0).max(1),
  threePointPct: z.number().min(0).max(1),
  effectiveFieldGoalPct: z.number().min(0).max(1),
  trueShootingPct: z.number().min(0).max(1),
  /** Free-throw attempts per field-goal attempt. */
  freeThrowRate: z.number().min(0).max(5),
  /** Total expected points per 100 possessions (the rating). */
  points: z.number().min(0).max(200),
  offensiveReboundRate: z.number().min(0).max(1),
  defensiveReboundRate: z.number().min(0).max(1),
  offensiveRebounds: z.number().min(0).max(100),
  defensiveRebounds: z.number().min(0).max(100),
  turnovers: z.number().min(0).max(100),
  assists: z.number().min(0).max(100),
  steals: z.number().min(0).max(100),
  blocks: z.number().min(0).max(100),
  fouls: z.number().min(0).max(100),
  /** Expected second-chance points from offensive rebounds (bounded analytic
   * continuation; never a possession loop). */
  secondChancePoints: z.number().min(0).max(100),
});
export type ProjectionLedger = z.infer<typeof projectionLedgerSchema>;

/** Turnover causes: expected split between live-ball steals and other turnovers. */
export const projectionTurnoverCausesSchema = z.object({
  stealShare: z.number().min(0).max(1),
  nonStealShare: z.number().min(0).max(1),
  expectedSteals: z.number().min(0).max(100),
  expectedOther: z.number().min(0).max(100),
});
export type ProjectionTurnoverCauses = z.infer<typeof projectionTurnoverCausesSchema>;

/** Spacing score: team spacing, expected shot-quality lift, contest-adjusted. */
export const projectionSpacingSchema = z.object({
  /** Normalized 0-100 spacing score. */
  score: z.number().min(0).max(100),
  /** Raw teamSpacing value from the possession engine. */
  raw: z.number(),
  /** Expected shot-quality lift from the action/zone distribution. */
  shotQualityLift: z.number().min(-0.1).max(0.1),
  /** Expected contest penalty applied by the defense. */
  expectedContest: z.number().min(-0.2).max(0.2),
});
export type ProjectionSpacing = z.infer<typeof projectionSpacingSchema>;

/** Creation score and its concentration facts. */
export const projectionCreationSchema = z.object({
  /** Normalized 0-100 creation score. */
  score: z.number().min(0).max(100),
  /** Expected initiator share per slot (sums to 1). */
  initiatorShare: z.record(projectionSlotSchema, z.number().min(0).max(1)),
  /** Share of creation mass carried by the top initiator. */
  primaryShare: z.number().min(0).max(1),
  /** Share of creation mass carried by the top two initiators. */
  topTwoShare: z.number().min(0).max(1),
  /** Normalized action diversity (0-100). */
  actionDiversity: z.number().min(0).max(100),
  /** Expected assist opportunities per 100. */
  assistOpportunity: z.number().min(0).max(100),
  /** Expected passes per 100 (share of initiations that pass). */
  passOpportunity: z.number().min(0).max(100),
});
export type ProjectionCreation = z.infer<typeof projectionCreationSchema>;

/** Defensive coverage of one side. */
export const projectionDefenseSchema = z.object({
  /** Normalized 0-100 defensive coverage score. */
  score: z.number().min(0).max(100),
  /** Expected defender pressure applied to the offense. */
  pressure: z.number(),
  perimeterCoverage: z.number().min(0).max(100),
  interiorCoverage: z.number().min(0).max(100),
  rimProtection: z.number().min(0).max(100),
  stealOpportunity: z.number().min(0).max(100),
  blockOpportunity: z.number().min(0).max(100),
  /** Expected foul exposure (higher is worse). */
  foulExposure: z.number().min(0).max(100),
  defensiveRebounding: z.number().min(0).max(100),
  /** Expected opponent shot quality against this lineup (higher is worse). */
  expectedOpponentShotQuality: z.number(),
});
export type ProjectionDefense = z.infer<typeof projectionDefenseSchema>;

/** Action distribution (shares summing to 1 across all actions). */
export const projectionActionDistributionSchema = z.record(
  z.string().min(1).max(32),
  z.number().min(0).max(1),
);
export type ProjectionActionDistribution = z.infer<typeof projectionActionDistributionSchema>;

/** Zone distribution (shares summing to 1 across shot zones). */
export const projectionZoneDistributionSchema = z.record(
  z.string().min(1).max(32),
  z.number().min(0).max(1),
);
export type ProjectionZoneDistribution = z.infer<typeof projectionZoneDistributionSchema>;

/** Per-slot shooter distribution (shares summing to 1). */
export const projectionShooterDistributionSchema = z.record(
  projectionSlotSchema,
  z.number().min(0).max(1),
);
export type ProjectionShooterDistribution = z.infer<typeof projectionShooterDistributionSchema>;

/** Per-player contribution inside a base projection. */
export const projectionPlayerContributionSchema = z.object({
  slot: projectionSlotSchema,
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema.nullable(),
  displayName: z.string().min(1).max(96),
  /** Share of shot attempts taken. */
  usageShare: z.number().min(0).max(1),
  /** Share of initiations led. */
  initiatorShare: z.number().min(0).max(1),
  /** Normalized creation contribution. */
  creationShare: z.number().min(0).max(100),
  /** Spacing contribution (raw teamSpacing contribution). */
  spacingContribution: z.number(),
  expectedShots: z.number().min(0).max(100),
  expectedMakes: z.number().min(0).max(100),
  expectedPoints: z.number().min(0).max(100),
  expectedAssists: z.number().min(0).max(100),
  expectedTurnovers: z.number().min(0).max(100),
  expectedRebounds: z.number().min(0).max(100),
  expectedFouls: z.number().min(0).max(100),
  /** Normalized defensive contribution. */
  defensiveContribution: z.number().min(0).max(100),
});
export type ProjectionPlayerContribution = z.infer<typeof projectionPlayerContributionSchema>;

/** One canonical lineup entry recorded for audit. */
export const projectionLineupEntrySchema = z.object({
  slot: projectionSlotSchema,
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema.nullable(),
  displayName: z.string().min(1).max(96),
  positions: z.array(z.string().min(1).max(8)),
});
export type ProjectionLineupEntry = z.infer<typeof projectionLineupEntrySchema>;

/** One side of a base projection: the full expected ledger. */
export const projectionSideSchema = z.object({
  ledger: projectionLedgerSchema,
  spacing: projectionSpacingSchema,
  creation: projectionCreationSchema,
  defense: projectionDefenseSchema,
  turnoverCauses: projectionTurnoverCausesSchema,
  actions: projectionActionDistributionSchema,
  zones: projectionZoneDistributionSchema,
  shooters: projectionShooterDistributionSchema,
  players: z.array(projectionPlayerContributionSchema).length(5),
});
export type ProjectionSide = z.infer<typeof projectionSideSchema>;

/** The complete base-five projection output. */
export const baseFiveProjectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    modelVersion: z.literal(PROJECTION_MODEL_VERSION),
    referenceId: z.string().min(1).max(64),
    /** SHA-256 content hash of the model artifact that supplied the reference. */
    referenceHash: contentHashSchema,
    eraId: eraIdSchema,
    eraProfileVersion: z.string().min(1).max(64),
    dataVersion: z.string().min(1).max(64),
    normalizationVersion: z.literal(PROJECTION_SCHEMA_VERSION),
    /** Seedless digest of the validated input (32-hex). */
    inputDigest: z.string().regex(/^[0-9a-f]{32}$/),
    /** Canonical audit digest of the full projection (32-hex). */
    digest: z.string().regex(/^[0-9a-f]{32}$/),
    /** Canonical slot-ordered lineup snapshot. */
    lineup: z.array(projectionLineupEntrySchema).length(5),
    /** This lineup's offense against the neutral reference defense. */
    offense: projectionSideSchema,
    /** The neutral reference offense against this lineup's defense. */
    defense: projectionSideSchema,
    ratings: z.object({
      /** Projected offensive rating = offense.ledger.points. */
      offensiveRating: z.number().min(0).max(200),
      /** Projected defensive rating allowed = defense.ledger.points. */
      defensiveRatingAllowed: z.number().min(0).max(200),
      /** offensiveRating - defensiveRatingAllowed. */
      netRating: z.number().min(-200).max(200),
      expectedPossessions: z.number().positive(),
    }),
    weaknesses: z.array(projectionWeaknessSchema),
  })
  .superRefine((projection, ctx) => {
    if (projection.ratings.offensiveRating !== projection.offense.ledger.points) {
      ctx.addIssue({
        code: 'custom',
        message: 'offensiveRating must equal the offense ledger points',
      });
    }
    if (projection.ratings.defensiveRatingAllowed !== projection.defense.ledger.points) {
      ctx.addIssue({
        code: 'custom',
        message: 'defensiveRatingAllowed must equal the defense ledger points',
      });
    }
    if (
      projection.ratings.netRating !==
      projection.ratings.offensiveRating - projection.ratings.defensiveRatingAllowed
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'netRating must equal offensiveRating minus defensiveRatingAllowed',
      });
    }
    const offensePlayers = projection.offense.players;
    const defensePlayers = projection.defense.players;
    for (let index = 0; index < 5; index += 1) {
      if (offensePlayers[index]?.slot !== defensePlayers[index]?.slot) {
        ctx.addIssue({ code: 'custom', message: 'offense and defense slots must align' });
        break;
      }
    }
  });
export type BaseFiveProjection = z.infer<typeof baseFiveProjectionSchema>;

/** Base projector input: one legal five with explicit slot assignments. */
export interface ProjectionPlayerInput {
  player: SimulationPlayer;
  slot: ProjectionSlot;
}

export interface BaseFiveProjectionInput {
  lineup: readonly [
    ProjectionPlayerInput,
    ProjectionPlayerInput,
    ProjectionPlayerInput,
    ProjectionPlayerInput,
    ProjectionPlayerInput,
  ];
  eraProfile: EraSimulationProfile;
  model: ProjectionModelArtifact;
  /** Neutral reference id; defaults to the model's neutral reference for the era. */
  referenceId?: string;
}
