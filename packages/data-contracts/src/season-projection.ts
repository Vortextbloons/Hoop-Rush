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

export const seasonProjectionUnitKindSchema = z.enum([
  'starting',
  'closing',
  'trace',
  'bench-heavy',
  'contingency',
  'matchup',
]);
export type SeasonProjectionUnitKind = z.infer<typeof seasonProjectionUnitKindSchema>;

export const seasonProjectionUnitSchema = z.object({
  unitId: z.string().min(1).max(128),
  kind: seasonProjectionUnitKindSchema,

  players: z.array(playerVersionIdSchema).length(5),

  weight: z.number().min(0).max(1),

  base: baseFiveProjectionSchema,
});
export type SeasonProjectionUnit = z.infer<typeof seasonProjectionUnitSchema>;

export const seasonProjectionMinuteRowSchema = z.object({
  playerVersionId: playerVersionIdSchema,

  targetMinutes: z.number().int().min(0).max(48),

  traceMinutes: z.number().min(0).max(48),

  deviation: z.number().min(0).max(48),
});
export type SeasonProjectionMinuteRow = z.infer<typeof seasonProjectionMinuteRowSchema>;

export const seasonProjectionMetricsSchema = z.object({
  offensiveRating: z.number().min(0).max(200),
  defensiveRatingAllowed: z.number().min(0).max(200),
  netRating: z.number().min(-200).max(200),

  startingQuality: z.number(),
  mixedQuality: z.number(),
  benchQuality: z.number(),
  closingQuality: z.number(),

  minuteDeviation: z.number().min(0),

  creationContinuity: z.number().min(0).max(100),

  spacingContinuity: z.number().min(0).max(100),

  minimumUnitStrength: z.number(),

  weightedUnitStrength: z.number(),

  balance: z.number().min(0).max(100),

  positionalCoverage: z.number().min(0).max(100),

  foulResilience: z.number().min(0).max(100),

  contingencyDepth: z.number().min(0).max(100),

  matchupMean: z.number(),

  matchupWorstCase: z.number(),

  redundancy: z.number().min(0).max(100),
});
export type SeasonProjectionMetrics = z.infer<typeof seasonProjectionMetricsSchema>;

export const seasonProjectionFatigueBandSchema = z.enum(['fresh', 'ready', 'tired', 'heavy']);
export type SeasonProjectionFatigueBand = z.infer<typeof seasonProjectionFatigueBandSchema>;

export const seasonProjectionPlanFactsSchema = z.object({
  policyVersion: z.literal(SEASON_MINUTE_POLICY_VERSION),

  strategy: seasonMinutePolicyStrategySchema,

  projectedNetRating: z.number(),

  unitQuality: z.object({
    starting: z.number(),
    closing: z.number(),
    bench: z.number(),
  }),

  starterStrainAfterBlock: z.number().min(0).max(10000),

  starterStrainBand: seasonProjectionFatigueBandSchema,

  benchRelief: z.number().min(0).max(1),

  fatigueBands: z.object({
    fresh: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    tired: z.number().int().nonnegative(),
    heavy: z.number().int().nonnegative(),
  }),

  riskAdjustedScore: z.number().min(0).max(1),

  horizonGames: z.number().int().positive(),

  heavyStrain: z.boolean(),
});
export type SeasonProjectionPlanFacts = z.infer<typeof seasonProjectionPlanFactsSchema>;

export const seasonProjectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.literal(SEASON_PROJECTION_VERSION),
    modelVersion: z.literal(PROJECTION_MODEL_VERSION),
    eraId: eraIdSchema,
    eraProfileVersion: z.string().min(1).max(64),
    dataVersion: z.string().min(1).max(64),

    inputDigest: seasonCheckpointDigestSchema,

    digest: seasonCheckpointDigestSchema,

    units: z.array(seasonProjectionUnitSchema).min(1),
    minutes: z.array(seasonProjectionMinuteRowSchema).length(10),
    metrics: seasonProjectionMetricsSchema,
    weaknesses: z.array(projectionWeaknessSchema),

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

export interface SeasonProjectionPlayerInput {
  player: import('./simulation.ts').SimulationPlayer;
}

export interface SeasonProjectionMinutePlanPlayerInput {
  playerVersionId: string;

  staminaRating: number;

  durability: number;

  fatigueBasisPoints: number;

  recentLoadBasisPoints: number;
}

export interface SeasonProjectionInput {
  roster: readonly SeasonProjectionPlayerInput[];
  rotation: SeasonRotation;
  eraProfile: EraSimulationProfile;
  model: ProjectionModelArtifact;

  minutePlan?: {
    players: ReadonlyArray<SeasonProjectionMinutePlanPlayerInput>;

    horizonGames: number;
  };
}

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
    netRatingMaeMax: z.number().positive(),

    netRatingBiasMax: z.number().positive(),

    unitOrderingSpearmanMin: z.number().min(-1).max(1),

    pairwiseOrderingAccuracyMin: z.number().min(0).max(1),

    monotonicPassShareMin: z.number().min(0).max(1),

    heldOutPassShare: z.number().min(0).max(1),
  }),

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
