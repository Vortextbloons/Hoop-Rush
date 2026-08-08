import { z } from 'zod';
import { eraIdSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import {
  PROJECTION_MODEL_VERSION,
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_PROJECTION_TARGETS_VERSION,
  SEASON_PROJECTION_VERSION,
} from './season-versions.ts';
import { baseFiveProjectionSchema, projectionWeaknessSchema } from './projection.ts';
import { seasonMinutePolicyStrategySchema } from './season-rotation.ts';
import type { EraSimulationProfile } from './era-sim-profile.ts';
import type { ProjectionModelArtifact } from './projection.ts';
import type { SeasonRotation } from './season-rotation.ts';

/**
 * Season projection contracts (season-projection-v1): the deterministic
 * composition of the base projector over a ten-player roster, a legal
 * rotation, representative units, target minutes, contingency scenarios,
 * and matchup archetypes. Every unique legal five is projected through the
 * base projector (cached by canonical key); Season code never duplicates
 * lineup-performance formulas.
 */

/** Unit kinds the Season projector can produce. */
export const seasonProjectionUnitKindSchema = z.enum([
  'starting',
  'closing',
  'trace',
  'bench-heavy',
  'contingency',
  'matchup',
]);
export type SeasonProjectionUnitKind = z.infer<typeof seasonProjectionUnitKindSchema>;

/** One representative unit and its planned weight. */
export const seasonProjectionUnitSchema = z.object({
  /** Canonical unit id, e.g. `starters`, `closing`, `trace-12`, `bench-heavy`,
   * `contingency-pv-…`, `matchup-perimeter`. */
  unitId: z.string().min(1).max(128),
  kind: seasonProjectionUnitKindSchema,
  /** Five distinct rostered player versions in legal G, G, F, F, C order. */
  players: z.array(playerVersionIdSchema).length(5),
  /** Planned minute share (0..1); scenario-only units carry 0. */
  weight: z.number().min(0).max(1),
  /** The full base projection of this unit. */
  base: baseFiveProjectionSchema,
});
export type SeasonProjectionUnit = z.infer<typeof seasonProjectionUnitSchema>;

/** Target-versus-trace minute facts for one rostered player. */
export const seasonProjectionMinuteRowSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  /** Configured target minutes (0..48, int). */
  targetMinutes: z.number().int().min(0).max(48),
  /** Planner-trace actual minutes. */
  traceMinutes: z.number().min(0).max(48),
  /** Absolute target-versus-trace deviation. */
  deviation: z.number().min(0).max(48),
});
export type SeasonProjectionMinuteRow = z.infer<typeof seasonProjectionMinuteRowSchema>;

/** Weighted Season projection metrics. */
export const seasonProjectionMetricsSchema = z.object({
  /** Unit-weight-averaged ratings. */
  offensiveRating: z.number().min(0).max(200),
  defensiveRatingAllowed: z.number().min(0).max(200),
  netRating: z.number().min(-200).max(200),
  /** Quality of named unit groups (normalized 0-100 or net-rating terms). */
  startingQuality: z.number(),
  mixedQuality: z.number(),
  benchQuality: z.number(),
  closingQuality: z.number(),
  /** Total absolute target-versus-trace minute deviation. */
  minuteDeviation: z.number().min(0),
  /** Creation continuity across units (0-100; higher = more stable). */
  creationContinuity: z.number().min(0).max(100),
  /** Spacing continuity across units (0-100). */
  spacingContinuity: z.number().min(0).max(100),
  /** Minimum unit net rating. */
  minimumUnitStrength: z.number(),
  /** Weighted-average unit net rating. */
  weightedUnitStrength: z.number(),
  /** Offensive/defensive balance (0-100; 100 = perfectly balanced). */
  balance: z.number().min(0).max(100),
  /** Legal positional coverage (0-100). */
  positionalCoverage: z.number().min(0).max(100),
  /** Foul resilience after high-foul-exposure removals (0-100). */
  foulResilience: z.number().min(0).max(100),
  /** Contingency depth after every single-player removal (0-100). */
  contingencyDepth: z.number().min(0).max(100),
  /** Mean matchup robustness across archetype references (net-rating terms). */
  matchupMean: z.number(),
  /** Worst-case matchup robustness (net-rating terms). */
  matchupWorstCase: z.number(),
  /** Role redundancy using second-best player and unit per role (0-100). */
  redundancy: z.number().min(0).max(100),
});
export type SeasonProjectionMetrics = z.infer<typeof seasonProjectionMetricsSchema>;

/** Fatigue band of a plan's worst starter strain (minute-policy-v1). */
export const seasonProjectionFatigueBandSchema = z.enum(['fresh', 'ready', 'tired', 'heavy']);
export type SeasonProjectionFatigueBand = z.infer<typeof seasonProjectionFatigueBandSchema>;

/**
 * Minute-policy plan facts (minute-policy-v1) attached to a Season
 * projection when the caller supplies minute-plan load input: the frozen
 * policy that produced the rotation's target minutes, its projected quality
 * and net rating, the block-end starter strain facts, bench relief, fatigue
 * band counts over the ten rostered players, and the risk-adjusted score.
 */
export const seasonProjectionPlanFactsSchema = z.object({
  /** The frozen minute-policy contract that produced the target minutes. */
  policyVersion: z.literal(SEASON_MINUTE_POLICY_VERSION),
  /** The strategy recorded on the rotation's minute policy. */
  strategy: seasonMinutePolicyStrategySchema,
  /** The projection's weighted net rating (metrics.netRating). */
  projectedNetRating: z.number(),
  /** Quality of the named unit groups (metrics terms). */
  unitQuality: z.object({
    starting: z.number(),
    closing: z.number(),
    bench: z.number(),
  }),
  /** Worst starter end-of-block fatigue (basis points, 0..10,000). */
  starterStrainAfterBlock: z.number().min(0).max(10000),
  /** Band of the worst starter strain. */
  starterStrainBand: seasonProjectionFatigueBandSchema,
  /** Bench relief share of projected quality (0..1). */
  benchRelief: z.number().min(0).max(1),
  /** Fatigue band counts over the ten rostered players after the block. */
  fatigueBands: z.object({
    fresh: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    tired: z.number().int().nonnegative(),
    heavy: z.number().int().nonnegative(),
  }),
  /** Risk-adjusted score in 0..1 (neutral single-rotation normalization). */
  riskAdjustedScore: z.number().min(0).max(1),
  /** Horizon over which the fatigue facts were projected (games). */
  horizonGames: z.number().int().positive(),
  /** True when any rostered player projects to the Heavy band. */
  heavyStrain: z.boolean(),
});
export type SeasonProjectionPlanFacts = z.infer<typeof seasonProjectionPlanFactsSchema>;

/** The complete Season projection output. */
export const seasonProjectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.literal(SEASON_PROJECTION_VERSION),
    modelVersion: z.literal(PROJECTION_MODEL_VERSION),
    eraId: eraIdSchema,
    eraProfileVersion: z.string().min(1).max(64),
    dataVersion: z.string().min(1).max(64),
    /** Canonical digest of the roster + rotation input (32-hex). */
    inputDigest: seasonCheckpointDigestSchema,
    /** Canonical audit digest (32-hex). */
    digest: seasonCheckpointDigestSchema,
    /** All representative units; weighted units sum their weights to 1. */
    units: z.array(seasonProjectionUnitSchema).min(1),
    minutes: z.array(seasonProjectionMinuteRowSchema).length(10),
    metrics: seasonProjectionMetricsSchema,
    weaknesses: z.array(projectionWeaknessSchema),
    /**
     * Minute-policy plan facts, present only when the caller supplied
     * minute-plan load input (minute-policy-v1).
     */
    planFacts: seasonProjectionPlanFactsSchema.optional(),
  })
  .superRefine((projection, ctx) => {
    const weighted = projection.units.filter((unit) => unit.weight > 0);
    if (weighted.length > 0) {
      const total = weighted.reduce((sum, unit) => sum + unit.weight, 0);
      if (Math.abs(total - 1) > 1e-6) {
        ctx.addIssue({
          code: 'custom',
          message: `weighted unit shares must sum to 1 (got ${String(total)})`,
        });
      }
    }
    const minuteVersions = new Set<string>();
    for (const row of projection.minutes) {
      if (minuteVersions.has(row.playerVersionId)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate minute row for ${row.playerVersionId}`,
        });
      }
      minuteVersions.add(row.playerVersionId);
    }
    for (const unit of projection.units) {
      const unitVersions = new Set<string>();
      for (const version of unit.players) {
        if (unitVersions.has(version)) {
          ctx.addIssue({
            code: 'custom',
            message: `unit ${unit.unitId} repeats ${version}`,
          });
        }
        unitVersions.add(version);
        if (!minuteVersions.has(version)) {
          ctx.addIssue({
            code: 'custom',
            message: `unit ${unit.unitId} uses non-rostered version ${version}`,
          });
        }
      }
    }
  });
export type SeasonProjection = z.infer<typeof seasonProjectionSchema>;

/** Season projector input: exactly ten rostered players. */
export interface SeasonProjectionPlayerInput {
  /** The catalog candidate-derived player (validation identical to the game
   * adapter; anchors optional with possession-engine missing-data semantics). */
  player: import('./simulation.ts').SimulationPlayer;
}

/** Per-player minute-plan load facts for the plan facts computation. */
export interface SeasonProjectionMinutePlanPlayerInput {
  playerVersionId: string;
  /** 45..95 stamina rating (season-stamina-v1). */
  staminaRating: number;
  /** 45..95 durability rating (durability-v1). */
  durability: number;
  /** 0..10,000 current fatigue basis points. */
  fatigueBasisPoints: number;
  /** 0..10,000 current recent-load basis points. */
  recentLoadBasisPoints: number;
}

export interface SeasonProjectionInput {
  /** Exactly ten players. */
  roster: readonly SeasonProjectionPlayerInput[];
  rotation: SeasonRotation;
  eraProfile: EraSimulationProfile;
  model: ProjectionModelArtifact;
  /**
   * Optional minute-plan load input (minute-policy-v1): when present, the
   * projection attaches `planFacts` computed from the rotation's own target
   * minutes and this load. Inputs stay plain interfaces; no Zod schema.
   */
  minutePlan?: {
    players: ReadonlyArray<SeasonProjectionMinutePlanPlayerInput>;
    /** Upcoming-block horizon in games (1..10). */
    horizonGames: number;
  };
}

/**
 * Frozen `season-projection-targets-v1` artifact: calibration cohort and
 * envelope gates for Season projections measured against the
 * rotation-capable Season game controller. Validation never rewrites
 * `measured`; calibration writes it only for the calibration cohort.
 */
export const seasonProjectionTargetsSchema = z.object({
  schemaVersion: z.literal(1),
  targetsVersion: z.literal(SEASON_PROJECTION_TARGETS_VERSION),
  cohorts: z.object({
    calibrationRosters: z.number().int().positive(),
    validationRosters: z.number().int().positive(),
    heldOutRosters: z.number().int().positive(),
    gamesPerRoster: z.number().int().positive(),
  }),
  gates: z.object({
    /** Max mean absolute net-rating error over the calibration cohort. */
    netRatingMaeMax: z.number().positive(),
    /** Max absolute net-rating bias. */
    netRatingBiasMax: z.number().positive(),
    /** Minimum Spearman correlation between projected and simulated unit orderings. */
    unitOrderingSpearmanMin: z.number().min(-1).max(1),
    /** Minimum share of pair orderings the projection must get right. */
    pairwiseOrderingAccuracyMin: z.number().min(0).max(1),
    /** Minimum monotonic gate pass share (all must pass). */
    monotonicPassShareMin: z.number().min(0).max(1),
    /** Share of held-out rosters whose ratings must stay inside envelopes. */
    heldOutPassShare: z.number().min(0).max(1),
  }),
  /** Calibration writes these; validation never rewrites them. */
  measured: z.object({
    netRatingMae: z.number().nonnegative(),
    netRatingBias: z.number(),
    unitOrderingSpearman: z.number().min(-1).max(1),
    pairwiseOrderingAccuracy: z.number().min(0).max(1),
    monotonicFailures: z.number().int().nonnegative(),
    heldOutPassRate: z.number().min(0).max(1),
  }),
});
export type SeasonProjectionTargets = z.infer<typeof seasonProjectionTargetsSchema>;
