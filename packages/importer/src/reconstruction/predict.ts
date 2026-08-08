/**
 * Prediction against the checked-in reconstruction artifact (spec/12).
 *
 * Each prediction consumes the conservative posterior quantile: the 25th
 * percentile for accuracy and the 30th percentile for attempt tendency, so
 * reconstructed historical players are credited only with shooting they
 * plausibly demonstrated. Confidence comes from the Laplace posterior
 * std-dev and missing-feature evidence. The engine never imports this code:
 * it consumes the per-player profile produced here.
 */
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

/**
 * Rebuilds the prediction-time feature context from the artifact itself:
 * position FT priors, two-point means, and physical medians are all recorded
 * on the checked-in artifact, so per-season derivation needs no cohort data.
 */
export function featureContextFromArtifact(
  artifact: ThreePointReconstructionArtifact,
): FeatureContext {
  return {
    ftPriors: artifact.priors.ftPriors,
    twoPctMeans: artifact.position2pMeans,
    missingDefaults: artifact.missingDefaults,
  };
}

/** Posterior mean, std-dev, and conservative quantile from Laplace covariance. */
export interface PosteriorPrediction {
  mean: number;
  stdDev: number;
  conservative: number;
}

/**
 * Posterior summary for one model: mean = sigmoid(x'b), std-dev from the
 * Laplace covariance, conservative = sigmoid(x'b + Phi^-1(quantile)*sigma).
 * For quantiles below 0.5 the standard-normal quantile is negative, so the
 * conservative estimate sits below the posterior mean (25th percentile for
 * accuracy, 20th for attempt tendency).
 */
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
  /** Source fields behind the prediction (provenance). */
  sourceFields: string[];
}

/**
 * Predicts the conservative reconstructed three-point profile for one
 * player-season using the artifact alone. Deterministic: the same artifact
 * and row always produce the same profile.
 */
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

  // Conservative modern translation (spec/12): attempt volume scales toward
  // what a modern-era player with these traits would attempt, capped per
  // position below modern norms. Accuracy is never translated — it stays
  // the conservative 25th percentile. The translation preserves
  // conservative <= mean because it is a monotone per-player scaling.
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
      // Conservative quantiles are computed from the unclamped posterior
      // std-dev; the recorded value is clamped to the contract cap (0.5)
      // so weak-evidence profiles stay schema-valid. The engine consumes
      // only the conservative values and the confidence band.
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

/** Conservative accuracy -> threePoint rating mapping (linear between points). */
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

/** Deterministic 6-decimal rounding used everywhere profiles are serialized. */
export function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
