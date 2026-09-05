import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RATINGS_VERSION,
  THREE_POINT_RECONSTRUCTION_VERSION,
  DERIVATION_METHOD_VERSION,
  threePointReconstructionArtifactSchema,
  type ReconstructionMetrics,
  type ThreePointReconstructionArtifact,
} from '@hoop-rush/data-contracts';
import { PUBLIC_DATA } from '../config.ts';
import { fileExists } from '../json.ts';
import {
  fitModel,
  pickLambda,
  predictConservative,
  runGroupedHoldout,
  validateTranslatedAttemptRate,
} from './cross-validation.ts';
import { round6 } from './predict.ts';
import {
  MODERN_VALIDATION_SEASONS,
  RECONSTRUCTION_FEATURE_NAMES,
  RECONSTRUCTION_SEASONS,
  buildFeatureContext,
  cohortPriors,
  extractRawFeatures,
  featureVector,
  loadCohortRows,
  type ReconstructionRow,
} from './rows.ts';
export function reconstructionArtifactPath(): string {
  return join(PUBLIC_DATA, 'three-point-reconstruction-v1.json');
}
export function weightedPercentile(
  values: readonly {
    value: number;
    weight: number;
  }[],
  percentile: number,
): number {
  const sorted = [...values].filter((v) => v.weight > 0).sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, v) => sum + v.weight, 0);
  if (total <= 0) return 0;
  const target = percentile * total;
  let cumulative = 0;
  for (const entry of sorted) {
    cumulative += entry.weight;
    if (cumulative >= target) return entry.value;
  }
  return sorted[sorted.length - 1]?.value ?? 0;
}
export function buildRatingMapping(
  values: readonly number[],
): ThreePointReconstructionArtifact['ratingMapping'] {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (percentile: number): number => {
    const index = percentile * (sorted.length - 1);
    const low = sorted[Math.floor(index)] ?? 0;
    const high = sorted[Math.ceil(index)] ?? low;
    return low + (high - low) * (index - Math.floor(index));
  };
  const p05 = at(0.05);
  const p50 = at(0.5);
  const p95 = at(0.95);
  const points = [
    { accuracy: round6(p05), rating: 15 },
    { accuracy: round6(p50), rating: 55 },
    { accuracy: round6(p95), rating: 92 },
  ].sort((a, b) => a.accuracy - b.accuracy);
  return { points, clampMin: 10, clampMax: 95 };
}
export interface FitResult {
  artifact: ThreePointReconstructionArtifact;
  holdout: {
    accuracy: ReconstructionMetrics;
    attemptRate: ReconstructionMetrics;
    translatedAttemptRateModern: ReconstructionMetrics;
    foldCount: number;
  };
  gates: {
    meanBiasNonPositiveAccuracy: boolean;
    meanBiasNonPositiveTranslatedAttemptRate: boolean;
    floorBelowEstablished: boolean;
  };
  cohortEstimates: {
    accuracy: number[];
    attemptRate: number[];
  };
}
export const ATTEMPT_TRANSLATION = {
  factor: 2.5,
  caps: { G: 0.15, F: 0.08, C: 0.02 },
  description:
    'conservative modern translation: reconstructed early-era attempt volume scaled 2.5x and capped per position below modern-era norms (G ~0.30, F ~0.20, C ~0.08); accuracy is never translated',
};
export function fitThreePointReconstruction(
  rows: readonly ReconstructionRow[] = loadCohortRows(),
  modernRows: readonly ReconstructionRow[] = loadCohortRows([...MODERN_VALIDATION_SEASONS]),
): FitResult {
  const context = buildFeatureContext(rows);
  const priors = cohortPriors(rows);
  const lambdas = pickLambda(rows, context, priors);
  const accuracyModel = fitModel(rows, context, 'accuracy', lambdas.accuracyLambda, priors);
  const attemptModel = fitModel(rows, context, 'attemptRate', lambdas.attemptRateLambda, priors);
  const cohortEstimates = { accuracy: [] as number[], attemptRate: [] as number[] };
  const floorEntries: {
    value: number;
    weight: number;
  }[] = [];
  const ratingValues: number[] = [];
  for (const row of rows) {
    const raw = featureVector(extractRawFeatures(row, context));
    const accuracy = predictConservative(accuracyModel, raw, 0.25);
    if (row.tpa !== null && row.tpa > 0) {
      floorEntries.push({ value: accuracy, weight: row.tpa });
      cohortEstimates.accuracy.push(accuracy);
    }
    ratingValues.push(accuracy);
    cohortEstimates.attemptRate.push(predictConservative(attemptModel, raw, 0.3));
  }
  const floor = weightedPercentile(floorEntries, 0.05);
  const zoneFloors = {
    cornerThree: round6(Math.min(0.34, floor + 0.02)),
    aboveBreakThree: round6(floor),
  };
  const holdout = runGroupedHoldout(
    rows,
    context,
    { accuracyLambda: lambdas.accuracyLambda, attemptRateLambda: lambdas.attemptRateLambda },
    priors,
  );
  const translatedAttemptRateModern = validateTranslatedAttemptRate(
    modernRows,
    context,
    attemptModel,
    ATTEMPT_TRANSLATION,
  );
  const gates = {
    meanBiasNonPositiveAccuracy: holdout.accuracy.bias <= 0,
    meanBiasNonPositiveTranslatedAttemptRate: translatedAttemptRateModern.bias <= 0,
    floorBelowEstablished: floor < 0.32,
  };
  const coefficients = (model: ReturnType<typeof fitModel>['fitted']) =>
    RECONSTRUCTION_FEATURE_NAMES.reduce<Record<string, number>>((acc, name, j) => {
      acc[name] = round6(model.coefficients[j + 1] ?? 0);
      return acc;
    }, {});
  const artifact: ThreePointReconstructionArtifact = {
    artifactVersion: THREE_POINT_RECONSTRUCTION_VERSION,
    schemaVersion: 1,
    fitCohort: {
      seasons: [...RECONSTRUCTION_SEASONS],
      description:
        '1979-80 through 1983-84 early three-point cohort; the shot was nascent and closest to the world pre-1979 players would face',
    },
    featureNames: [...RECONSTRUCTION_FEATURE_NAMES],
    normalization: Object.fromEntries(
      RECONSTRUCTION_FEATURE_NAMES.map((name, j) => [
        name,
        {
          mean: round6(accuracyModel.normalization.mean[j] ?? 0),
          std: round6(accuracyModel.normalization.std[j] ?? 1),
        },
      ]),
    ),
    missingDefaults: {
      G: {
        heightInches: round6(context.missingDefaults.G.heightInches),
        weightLbs: round6(context.missingDefaults.G.weightLbs),
        age: round6(context.missingDefaults.G.age),
      },
      F: {
        heightInches: round6(context.missingDefaults.F.heightInches),
        weightLbs: round6(context.missingDefaults.F.weightLbs),
        age: round6(context.missingDefaults.F.age),
      },
      C: {
        heightInches: round6(context.missingDefaults.C.heightInches),
        weightLbs: round6(context.missingDefaults.C.weightLbs),
        age: round6(context.missingDefaults.C.age),
      },
    },
    position2pMeans: {
      G: round6(context.twoPctMeans.G),
      F: round6(context.twoPctMeans.F),
      C: round6(context.twoPctMeans.C),
    },
    priors: {
      accuracyPrior: round6(priors.accuracyPrior),
      accuracyPriorAttempts: priors.accuracyPriorAttempts,
      attemptRatePrior: round6(priors.attemptRatePrior),
      attemptRatePriorTrials: priors.attemptRatePriorTrials,
      ftPriors: {
        G: round6(context.ftPriors.G),
        F: round6(context.ftPriors.F),
        C: round6(context.ftPriors.C),
      },
    },
    regularization: {
      lambda: lambdas.accuracyLambda,
      maxIterations: 40,
      convergenceTolerance: 1e-9,
    },
    models: {
      accuracy: {
        intercept: round6(accuracyModel.fitted.coefficients[0] ?? 0),
        coefficients: coefficients(accuracyModel.fitted),
        covariance: accuracyModel.fitted.covariance.map((row) => row.map((v) => round6(v))),
      },
      attemptRate: {
        intercept: round6(attemptModel.fitted.coefficients[0] ?? 0),
        coefficients: coefficients(attemptModel.fitted),
        covariance: attemptModel.fitted.covariance.map((row) => row.map((v) => round6(v))),
      },
    },
    posteriorQuantiles: { accuracy: 0.25, attemptRate: 0.3 },
    attemptRateTranslation: {
      factor: ATTEMPT_TRANSLATION.factor,
      caps: ATTEMPT_TRANSLATION.caps,
      description: ATTEMPT_TRANSLATION.description,
    },
    confidenceThresholds: { highStdDev: 0.025, mediumStdDev: 0.045 },
    floors: { floor: round6(floor), zoneFloors },
    ratingMapping: buildRatingMapping(ratingValues),
    holdout: {
      accuracy: holdout.accuracy,
      attemptRate: holdout.attemptRate,
      translatedAttemptRateModern,
      foldCount: holdout.foldCount,
    },
    gates,
    generatedBy: `hoop-rush calibrate three-point (${DERIVATION_METHOD_VERSION}, ${RATINGS_VERSION})`,
  };
  threePointReconstructionArtifactSchema.parse(artifact);
  return {
    artifact,
    holdout: { ...holdout, translatedAttemptRateModern },
    gates,
    cohortEstimates,
  };
}
export function loadThreePointReconstructionArtifact(
  path: string = reconstructionArtifactPath(),
): ThreePointReconstructionArtifact {
  const memo = threePointArtifactByPath.get(path);
  if (memo !== undefined) return memo;
  const artifact = loadThreePointReconstructionArtifactUncached(path);
  threePointArtifactByPath.set(path, artifact);
  return artifact;
}
const threePointArtifactByPath = new Map<string, ThreePointReconstructionArtifact>();
function loadThreePointReconstructionArtifactUncached(
  path: string,
): ThreePointReconstructionArtifact {
  if (!fileExists(path)) {
    throw new Error(
      `three-point reconstruction artifact missing at ${path}; run \`hoop-rush calibrate three-point --write\` first`,
    );
  }
  const parsed = threePointReconstructionArtifactSchema.safeParse(
    JSON.parse(readFileSync(path, 'utf8')) as unknown,
  );
  if (!parsed.success) {
    throw new Error(
      `three-point reconstruction artifact ${path} fails validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return parsed.data;
}
export function writeThreePointReconstructionArtifact(
  artifact: ThreePointReconstructionArtifact,
  path: string = reconstructionArtifactPath(),
): void {
  threePointReconstructionArtifactSchema.parse(artifact);
  if (
    !artifact.gates.meanBiasNonPositiveAccuracy ||
    !artifact.gates.meanBiasNonPositiveTranslatedAttemptRate
  ) {
    throw new Error('refusing to write artifact: conservative bias gate failed');
  }
  if (!artifact.gates.floorBelowEstablished) {
    throw new Error('refusing to write artifact: reconstructed floor not below the .32/.34 floors');
  }
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  threePointArtifactByPath.delete(path);
}
export function validateThreePointReconstructionArtifact(
  artifact: ThreePointReconstructionArtifact,
): {
  valid: boolean;
  failures: string[];
} {
  const failures: string[] = [];
  if (!artifact.gates.meanBiasNonPositiveAccuracy) {
    failures.push('accuracy holdout mean bias is positive');
  }
  if (!artifact.gates.meanBiasNonPositiveTranslatedAttemptRate) {
    failures.push('translated attempt-rate mean bias vs the modern cohort is positive');
  }
  if (!artifact.gates.floorBelowEstablished) {
    failures.push('reconstructed floor is not below the established .32/.34 zone floors');
  }
  return { valid: failures.length === 0, failures };
}
