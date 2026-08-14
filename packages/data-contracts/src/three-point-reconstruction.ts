import { z } from 'zod';
import { THREE_POINT_RECONSTRUCTION_VERSION } from './versions.ts';

export const reconstructionFeatureNormalizationSchema = z.record(
  z.string().min(1).max(64),
  z.object({
    mean: z.number(),
    std: z.number().positive(),
  }),
);

export const reconstructionPosition2pSchema = z.object({
  G: z.number().min(0).max(1),
  F: z.number().min(0).max(1),
  C: z.number().min(0).max(1),
});

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

export const reconstructionPriorsSchema = z.object({
  accuracyPrior: z.number().min(0).max(1),

  accuracyPriorAttempts: z.number().positive(),

  attemptRatePrior: z.number().min(0).max(1),

  attemptRatePriorTrials: z.number().positive(),

  ftPriors: reconstructionPosition2pSchema,
});

export const reconstructionModelSchema = z.object({
  intercept: z.number(),

  coefficients: z.record(z.string().min(1).max(64), z.number()),

  covariance: z.array(z.array(z.number())),
});

export const reconstructionMetricsSchema = z.object({
  mae: z.number().nonnegative(),

  bias: z.number(),

  overpredictionShare: z.number().min(0).max(1),

  samplePlayers: z.number().int().nonnegative(),

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

  evidenceBands: z.array(
    z.object({
      band: z.string().min(1).max(64),
      mae: z.number().nonnegative(),
      bias: z.number(),
      count: z.number().int().nonnegative(),
    }),
  ),

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

export const reconstructionHoldoutSchema = z.object({
  accuracy: reconstructionMetricsSchema,

  attemptRate: reconstructionMetricsSchema,

  translatedAttemptRateModern: reconstructionMetricsSchema,

  foldCount: z.number().int().positive(),
});
export type ReconstructionMetrics = z.infer<typeof reconstructionMetricsSchema>;

export const reconstructionAttemptTranslationSchema = z.object({
  factor: z.number().positive(),

  caps: reconstructionPosition2pSchema,
  description: z.string().min(1).max(256),
});

export const reconstructionRatingMappingPointSchema = z.object({
  accuracy: z.number().min(0).max(1),
  rating: z.number().min(0).max(100),
});

export const threePointReconstructionArtifactSchema = z.object({
  artifactVersion: z.literal(THREE_POINT_RECONSTRUCTION_VERSION),
  schemaVersion: z.literal(1),

  fitCohort: z.object({
    seasons: z.array(z.string().min(1).max(16)).length(5),
    description: z.string().min(1).max(256),
  }),

  featureNames: z.array(z.string().min(1).max(64)),
  normalization: reconstructionFeatureNormalizationSchema,

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

  posteriorQuantiles: z.object({
    accuracy: z.literal(0.25),
    attemptRate: z.literal(0.3),
  }),

  attemptRateTranslation: reconstructionAttemptTranslationSchema,

  confidenceThresholds: z.object({
    highStdDev: z.number().positive(),
    mediumStdDev: z.number().positive(),
  }),

  floors: z.object({
    floor: z.number().min(0).max(1),
    zoneFloors: z.object({
      cornerThree: z.number().min(0).max(1),
      aboveBreakThree: z.number().min(0).max(1),
    }),
  }),

  ratingMapping: z.object({
    points: z.array(reconstructionRatingMappingPointSchema).min(2),
    clampMin: z.number().min(0).max(100),
    clampMax: z.number().min(0).max(100),
  }),
  holdout: reconstructionHoldoutSchema,

  gates: z.object({
    meanBiasNonPositiveAccuracy: z.boolean(),

    meanBiasNonPositiveTranslatedAttemptRate: z.boolean(),
    floorBelowEstablished: z.boolean(),
  }),
  generatedBy: z.string().min(1).max(256),
});
export type ThreePointReconstructionArtifact = z.infer<
  typeof threePointReconstructionArtifactSchema
>;
