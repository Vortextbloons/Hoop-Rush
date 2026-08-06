import { z } from 'zod';
import { THREE_POINT_RECONSTRUCTION_VERSION } from './versions.ts';

/**
 * Versioned conservative three-point reconstruction artifact
 * (spec/12 conservative historical three-point reconstruction).
 *
 * Two regularized binomial logistic models are fit offline, deterministically,
 * over the 1979-80..1983-84 early three-point cohort:
 *
 * - accuracy: 3PM / 3PA from historically available traits;
 * - attemptRate: 3PA / FGA from the same traits.
 *
 * Predictions consume the conservative posterior quantile (accuracy 25th,
 * attempt rate 30th percentile) so reconstructed historical players cannot
 * be credited with shooting they never demonstrated. The artifact carries
 * feature normalization, coefficients, Laplace covariance, priors,
 * confidence thresholds, the derived floor, the rating mapping, and the
 * grouped holdout metrics. It is the audit/reproducibility boundary: the
 * browser simulation consumes only the per-player reconstructed profiles
 * embedded in pool artifacts.
 */

/** Feature normalization mean/std over the fit cohort, per feature. */
export const reconstructionFeatureNormalizationSchema = z.record(
  z.string().min(1).max(64),
  z.object({
    mean: z.number(),
    std: z.number().positive(),
  }),
);

/** Per-position-group reference two-point percentage over the fit cohort. */
export const reconstructionPosition2pSchema = z.object({
  G: z.number().min(0).max(1),
  F: z.number().min(0).max(1),
  C: z.number().min(0).max(1),
});

/** Per-position-group physical medians used to impute missing features. */
export const reconstructionPhysicalDefaultsSchema = z.object({
  G: z.object({
    heightInches: z.number(),
    weightLbs: z.number(),
    age: z.number(),
  }),
  F: z.object({
    heightInches: z.number(),
    weightLbs: z.number(),
    age: z.number(),
  }),
  C: z.object({
    heightInches: z.number(),
    weightLbs: z.number(),
    age: z.number(),
  }),
});

/** Shrinkage priors pooled over the early three-point cohort. */
export const reconstructionPriorsSchema = z.object({
  /** Attempt-weighted early-era three-point percentage. */
  accuracyPrior: z.number().min(0).max(1),
  /** Equivalent prior attempts behind the accuracy prior. */
  accuracyPriorAttempts: z.number().positive(),
  /** Attempt-weighted early-era 3PA/FGA. */
  attemptRatePrior: z.number().min(0).max(1),
  /** Equivalent prior field-goal attempts behind the attempt-rate prior. */
  attemptRatePriorTrials: z.number().positive(),
  /** Position-group free-throw priors used to stabilize the FT features. */
  ftPriors: reconstructionPosition2pSchema,
});

/** One regularized binomial logistic model (intercept + ridge coefficients). */
export const reconstructionModelSchema = z.object({
  intercept: z.number(),
  /** Coefficients keyed by standardized feature name (intercept excluded). */
  coefficients: z.record(z.string().min(1).max(64), z.number()),
  /**
   * Laplace posterior covariance (X'WX + lambda*I)^-1 at convergence, rows
   * ordered [intercept, ...featureNames]. Enables posterior quantiles without
   * any scientific runtime dependency.
   */
  covariance: z.array(z.array(z.number())),
});

/** Grouped-holdout metrics for one model (attempt-weighted where noted). */
export const reconstructionMetricsSchema = z.object({
  /** Attempt-weighted mean absolute error on held-out predictions. */
  mae: z.number().nonnegative(),
  /** Attempt-weighted mean prediction minus observation (must be <= 0). */
  bias: z.number(),
  /** Share of held-out trials where the conservative prediction exceeded the observation. */
  overpredictionShare: z.number().min(0).max(1),
  /** Player count in the held-out folds. */
  samplePlayers: z.number().int().nonnegative(),
  /** Attempt-weighted per-position-group bands. */
  positionBands: z.object({
    G: z.object({
      mae: z.number().nonnegative(),
      bias: z.number(),
      count: z.number().int().nonnegative(),
    }),
    F: z.object({
      mae: z.number().nonnegative(),
      bias: z.number(),
      count: z.number().int().nonnegative(),
    }),
    C: z.object({
      mae: z.number().nonnegative(),
      bias: z.number(),
      count: z.number().int().nonnegative(),
    }),
  }),
  /** Attempt-weighted per-evidence-band (minutes) metrics. */
  evidenceBands: z.array(
    z.object({
      band: z.string().min(1).max(64),
      mae: z.number().nonnegative(),
      bias: z.number(),
      count: z.number().int().nonnegative(),
    }),
  ),
  /**
   * False positives: seasons predicted "capable" (>= threshold) whose
   * observed rate fell below the lower bound. False negatives are the
   * inverse. Thresholds are recorded on the artifact for the audit trail.
   */
  falsePositives: z.object({
    count: z.number().int().nonnegative(),
    threshold: z.number().min(0).max(1),
    lowerBound: z.number().min(0).max(1),
  }),
  falseNegatives: z.object({
    count: z.number().int().nonnegative(),
    threshold: z.number().min(0).max(1),
    upperBound: z.number().min(0).max(1),
  }),
});

/** Per-model holdout report. */
export const reconstructionHoldoutSchema = z.object({
  /** Early-cohort grouped holdout (player-grouped 5-fold, no leakage). */
  accuracy: reconstructionMetricsSchema,
  /**
   * Early-cohort attempt metrics, informational: the modern translation
   * intentionally predicts above early-era volume, so this bias is expected
   * positive and is NOT a gate.
   */
  attemptRate: reconstructionMetricsSchema,
  /**
   * Translated attempt metrics validated against the modern cohort
   * (2014-15..2023-24; era-disjoint from the fit cohort, so no player
   * leakage). This is the acceptance gate for the attempt translation.
   */
  translatedAttemptRateModern: reconstructionMetricsSchema,
  /** Player-grouped folds; no player appears in both train and holdout. */
  foldCount: z.number().int().positive(),
});
export type ReconstructionMetrics = z.infer<typeof reconstructionMetricsSchema>;

/** Conservative modern translation of reconstructed attempt volume. */
export const reconstructionAttemptTranslationSchema = z.object({
  /** The conservative attempt rate is multiplied by this factor. */
  factor: z.number().positive(),
  /**
   * Per-position-group caps: translated volume never exceeds these shares,
   * which sit below modern-era position norms (G ~0.30, F ~0.20, C ~0.08).
   */
  caps: reconstructionPosition2pSchema,
  description: z.string().min(1).max(256),
});

/** One anchor point of the conservative-accuracy -> three-point rating mapping. */
export const reconstructionRatingMappingPointSchema = z.object({
  accuracy: z.number().min(0).max(1),
  rating: z.number().min(0).max(100),
});

/**
 * The complete checked-in artifact. `generatedBy` records the exact CLI
 * invocation and versions that produced it; the artifact itself is the
 * reproducibility boundary.
 */
export const threePointReconstructionArtifactSchema = z.object({
  artifactVersion: z.literal(THREE_POINT_RECONSTRUCTION_VERSION),
  schemaVersion: z.literal(1),
  /** The early three-point prior cohort used for fitting. */
  fitCohort: z.object({
    seasons: z.array(z.string().min(1).max(16)).length(5),
    description: z.string().min(1).max(256),
  }),
  /** Standardized feature names in coefficient/covariance order (intercept excluded). */
  featureNames: z.array(z.string().min(1).max(64)),
  normalization: reconstructionFeatureNormalizationSchema,
  /** Position-and-cohort physical medians used to impute missing features. */
  missingDefaults: reconstructionPhysicalDefaultsSchema,
  position2pMeans: reconstructionPosition2pSchema,
  priors: reconstructionPriorsSchema,
  regularization: z.object({
    lambda: z.number().nonnegative(),
    maxIterations: z.number().int().positive(),
    convergenceTolerance: z.number().positive(),
  }),
  models: z.object({
    accuracy: reconstructionModelSchema,
    attemptRate: reconstructionModelSchema,
  }),
  /** Conservative posterior quantiles consumed for predictions. */
  posteriorQuantiles: z.object({
    accuracy: z.literal(0.25),
    attemptRate: z.literal(0.3),
  }),
  /**
   * Conservative modern translation (spec/12): reconstructed attempt volume
   * is scaled by `factor` and capped per position so a 1960s player's
   * spacing is visible without exceeding modern-era position norms. The
   * translation is validated against the modern cohort; accuracy is never
   * translated (still the conservative 25th percentile).
   */
  attemptRateTranslation: reconstructionAttemptTranslationSchema,
  /** Posterior accuracy std-dev thresholds that map profiles to confidence bands. */
  confidenceThresholds: z.object({
    highStdDev: z.number().positive(),
    mediumStdDev: z.number().positive(),
  }),
  /** Derived reconstructed floor and per-zone floors (5th percentile of
   * early-era conservative estimates; must sit below the established
   * .32/.34 zone floors). */
  floors: z.object({
    floor: z.number().min(0).max(1),
    zoneFloors: z.object({
      cornerThree: z.number().min(0).max(1),
      aboveBreakThree: z.number().min(0).max(1),
    }),
  }),
  /** Conservative accuracy -> threePoint rating mapping (linear between points). */
  ratingMapping: z.object({
    points: z.array(reconstructionRatingMappingPointSchema).min(2),
    clampMin: z.number().min(0).max(100),
    clampMax: z.number().min(0).max(100),
  }),
  holdout: reconstructionHoldoutSchema,
  /** Acceptance gates required before the artifact may be written. */
  gates: z.object({
    meanBiasNonPositiveAccuracy: z.boolean(),
    /** Translated attempt bias vs the modern cohort must be non-positive. */
    meanBiasNonPositiveTranslatedAttemptRate: z.boolean(),
    floorBelowEstablished: z.boolean(),
  }),
  generatedBy: z.string().min(1).max(256),
});
export type ThreePointReconstructionArtifact = z.infer<
  typeof threePointReconstructionArtifactSchema
>;
