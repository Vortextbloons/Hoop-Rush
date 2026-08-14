import {
  THREE_POINT_RECONSTRUCTION_VERSION,
  type ReconstructedThreePointProfile,
  type ThreePointReconstructionArtifact,
} from '@hoop-rush/data-contracts';
import { normalQuantile, sigmoid } from './math.ts';
import {
  extractRawFeatures,
  missingFeatureCount,
  type FeatureContext,
  type ReconstructionRow,
} from './rows.ts';

export function featureContextFromArtifact(
  artifact: ThreePointReconstructionArtifact,
): FeatureContext {
  return {
    ftPriors: artifact.priors.ftPriors,
    twoPctMeans: artifact.position2pMeans,
    missingDefaults: artifact.missingDefaults,
  };
}

export interface PosteriorPrediction {
  mean: number;
  stdDev: number;
  conservative: number;
}

export function posteriorPrediction(
  coefficients: readonly number[],
  covariance: readonly (readonly number[])[],
  x: readonly number[],
  quantile: number,
): PosteriorPrediction {
  const logit = coefficients.reduce((sum, value, i) => sum + value * (x[i] ?? 0), 0);
  let variance = 0;
  for (let a = 0; a < coefficients.length; a += 1) {
    for (let b = 0; b < coefficients.length; b += 1) {
      variance += (x[a] ?? 0) * (covariance[a]?.[b] ?? 0) * (x[b] ?? 0);
    }
  }
  const stdDev = Math.sqrt(Math.max(0, variance));
  const z = normalQuantile(quantile);
  const mean = sigmoid(logit);
  const conservative = sigmoid(logit + z * stdDev);
  return { mean, stdDev, conservative };
}

export interface ReconstructedProfileResult {
  profile: ReconstructedThreePointProfile;

  sourceFields: string[];
}

export function predictReconstructedProfile(
  artifact: ThreePointReconstructionArtifact,
  row: ReconstructionRow,
): ReconstructedProfileResult {
  const context = featureContextFromArtifact(artifact);
  const raw = extractRawFeatures(row, context);
  const missing = missingFeatureCount(raw);

  const mean = (name: string): number => {
    const norm = artifact.normalization[name];
    const value = raw[name as keyof typeof raw];
    if (norm === undefined) return value;
    return (value - norm.mean) / norm.std;
  };
  const x = artifact.featureNames.map((name) => mean(name));

  const coefficientsOf = (model: {
    intercept: number;
    coefficients: Record<string, number>;
  }): number[] => [
    model.intercept,
    ...artifact.featureNames.map((name) => model.coefficients[name] ?? 0),
  ];
  const accuracy = posteriorPrediction(
    coefficientsOf(artifact.models.accuracy),
    artifact.models.accuracy.covariance,
    [1, ...x],
    artifact.posteriorQuantiles.accuracy,
  );
  const attempt = posteriorPrediction(
    coefficientsOf(artifact.models.attemptRate),
    artifact.models.attemptRate.covariance,
    [1, ...x],
    artifact.posteriorQuantiles.attemptRate,
  );

  const thresholds = artifact.confidenceThresholds;
  const confidence: ReconstructedThreePointProfile['confidence'] =
    accuracy.stdDev < thresholds.highStdDev && missing === 0
      ? 'high'
      : accuracy.stdDev < thresholds.mediumStdDev
        ? 'medium'
        : 'low';

  const translation = artifact.attemptRateTranslation;
  const cap = translation.caps[row.positionGroup];
  const translated = (value: number): number => Math.min(cap, value * translation.factor);

  const sourceFields = [
    'ftm',
    'fta',
    'fga',
    'assists',
    'position',
    'heightInches',
    'weightLbs',
    'age',
    'season',
  ];
  return {
    profile: {
      modelVersion: THREE_POINT_RECONSTRUCTION_VERSION,
      accuracyConservative: round6(accuracy.conservative),
      accuracyMean: round6(accuracy.mean),

      accuracyStdDev: clampStdDev(accuracy.stdDev),
      attemptRateConservative: round6(translated(attempt.conservative)),
      attemptRateMean: round6(translated(attempt.mean)),
      attemptRateStdDev: clampStdDev(attempt.stdDev),
      confidence,
      floor: artifact.floors.floor,
      zoneFloors: artifact.floors.zoneFloors,
      evidence: {
        missingFeatures: missing,
        sourceFields,
      },
    },
    sourceFields,
  };
}

function clampStdDev(value: number): number {
  return round6(Math.min(0.5, value));
}

export function ratingFromAccuracy(
  artifact: ThreePointReconstructionArtifact,
  accuracy: number,
): number {
  const points = [...artifact.ratingMapping.points].sort((a, b) => a.accuracy - b.accuracy);
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return artifact.ratingMapping.clampMin;
  if (accuracy <= first.accuracy) return first.rating;
  if (accuracy >= last.accuracy) return last.rating;
  for (let i = 1; i < points.length; i += 1) {
    const low = points[i - 1];
    const high = points[i];
    if (low === undefined || high === undefined) continue;
    if (accuracy <= high.accuracy) {
      const span = high.accuracy - low.accuracy;
      const t = span > 0 ? (accuracy - low.accuracy) / span : 0;
      return Math.round(low.rating + t * (high.rating - low.rating));
    }
  }
  return last.rating;
}

export function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
