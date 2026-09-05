import { type ReconstructionMetrics } from '@hoop-rush/data-contracts';
import { fnv1a32, fitBinomialLogistic, type FittedBinomial } from './math.ts';
import { posteriorPrediction, round6 } from './predict.ts';
import {
  RECONSTRUCTION_FEATURE_NAMES,
  extractRawFeatures,
  featureVector,
  type FeatureContext,
  type ReconstructionRow,
} from './rows.ts';
export type ReconstructionModel = 'accuracy' | 'attemptRate';
export function foldOf(playerExternalId: string, foldCount: number): number {
  return fnv1a32(`reconstruct-v1:${playerExternalId}`) % foldCount;
}
export interface PriorInput {
  accuracyPrior: number;
  accuracyPriorAttempts: number;
  attemptRatePrior: number;
  attemptRatePriorTrials: number;
}
export function eligibleRows(
  rows: readonly ReconstructionRow[],
  model: ReconstructionModel,
): ReconstructionRow[] {
  if (model === 'accuracy') return rows.filter((row) => row.tpa !== null && row.tpa > 0);
  return rows.filter((row) => row.fga !== null && row.fga > 0);
}
export function observedRateFor(row: ReconstructionRow, model: ReconstructionModel): number | null {
  if (model === 'accuracy') {
    if (row.tpa === null || row.tpa <= 0) return null;
    return Math.min(row.tpm ?? 0, row.tpa) / row.tpa;
  }
  if (row.fga === null || row.fga <= 0) return null;
  return Math.min(row.tpa ?? 0, row.fga) / row.fga;
}
export function trialWeightFor(row: ReconstructionRow, model: ReconstructionModel): number {
  return model === 'accuracy' ? (row.tpa ?? 0) : (row.fga ?? 0);
}
export interface Normalization {
  mean: number[];
  std: number[];
}
export function standardize(raw: readonly number[][], normalization: Normalization): number[][] {
  return raw.map((row) =>
    row.map((value, j) => (value - (normalization.mean[j] ?? 0)) / (normalization.std[j] ?? 1)),
  );
}
export const RAW_UNIT_FEATURES = new Set(['isGuard', 'isCenter']);
export function computeNormalization(raw: readonly number[][]): Normalization {
  const k = RECONSTRUCTION_FEATURE_NAMES.length;
  const mean: number[] = new Array<number>(k).fill(0);
  for (const row of raw) {
    for (let j = 0; j < k; j += 1) mean[j] = (mean[j] ?? 0) + (row[j] ?? 0);
  }
  for (let j = 0; j < k; j += 1) mean[j] = (mean[j] ?? 0) / Math.max(1, raw.length);
  const std: number[] = new Array<number>(k).fill(0);
  for (const row of raw) {
    for (let j = 0; j < k; j += 1) {
      std[j] = (std[j] ?? 0) + ((row[j] ?? 0) - (mean[j] ?? 0)) ** 2;
    }
  }
  for (let j = 0; j < k; j += 1) {
    std[j] = RAW_UNIT_FEATURES.has(RECONSTRUCTION_FEATURE_NAMES[j] as string)
      ? 1
      : Math.sqrt((std[j] ?? 0) / Math.max(1, raw.length)) || 1;
  }
  return { mean, std };
}
export interface FittedModel {
  fitted: FittedBinomial;
  normalization: Normalization;
}
export const DUMMY_FEATURE_PENALTY_MULTIPLIER = 4;
export function fitModel(
  rows: readonly ReconstructionRow[],
  context: FeatureContext,
  model: ReconstructionModel,
  lambda: number,
  priors: PriorInput,
  maxIterations = 40,
  tolerance = 1e-9,
): FittedModel {
  const eligible = eligibleRows(rows, model);
  const raw = eligible.map((row) => featureVector(extractRawFeatures(row, context)));
  const normalization = computeNormalization(raw);
  const design = standardize(raw, normalization).map((row) => [1, ...row]);
  const makes: number[] = [];
  const trials: number[] = [];
  for (const row of eligible) {
    if (model === 'accuracy') {
      makes.push(Math.min(row.tpm ?? 0, row.tpa ?? 0));
      trials.push(row.tpa ?? 0);
    } else {
      makes.push(Math.min(row.tpa ?? 0, row.fga ?? 0));
      trials.push(row.fga ?? 0);
    }
  }
  const priorRate = model === 'accuracy' ? priors.accuracyPrior : priors.attemptRatePrior;
  const priorTrials =
    model === 'accuracy' ? priors.accuracyPriorAttempts : priors.attemptRatePriorTrials;
  const penalties = RECONSTRUCTION_FEATURE_NAMES.map((name) =>
    name === 'isGuard' || name === 'isCenter' ? lambda * DUMMY_FEATURE_PENALTY_MULTIPLIER : lambda,
  );
  return {
    fitted: fitBinomialLogistic(
      design,
      makes,
      trials,
      lambda,
      priorRate * priorTrials,
      priorTrials,
      maxIterations,
      tolerance,
      penalties,
    ),
    normalization,
  };
}
export function predictConservative(
  model: FittedModel,
  rawFeatures: readonly number[],
  quantile: number,
): number {
  const standardized = rawFeatures.map(
    (value, j) => (value - (model.normalization.mean[j] ?? 0)) / (model.normalization.std[j] ?? 1),
  );
  const x = [1, ...standardized];
  return posteriorPrediction(model.fitted.coefficients, model.fitted.covariance, x, quantile)
    .conservative;
}
export interface HeldOutPrediction {
  row: ReconstructionRow;
  prediction: number;
  observed: number;
  weight: number;
}
export interface AttemptTranslation {
  factor: number;
  caps: {
    G: number;
    F: number;
    C: number;
  };
}
export function validateTranslatedAttemptRate(
  modernRows: readonly ReconstructionRow[],
  context: FeatureContext,
  attemptModel: FittedModel,
  translation: AttemptTranslation,
): ReconstructionMetrics {
  const predictions: HeldOutPrediction[] = [];
  for (const row of modernRows) {
    const observed = observedRateFor(row, 'attemptRate');
    if (observed === null) continue;
    const raw = featureVector(extractRawFeatures(row, context));
    const conservative = predictConservative(attemptModel, raw, 0.3);
    const cap = translation.caps[row.positionGroup];
    predictions.push({
      row,
      prediction: Math.min(cap, conservative * translation.factor),
      observed,
      weight: trialWeightFor(row, 'attemptRate'),
    });
  }
  return metricsOf(predictions, 'attemptRate');
}
const FP_FN: Record<
  ReconstructionModel,
  {
    threshold: number;
    lowerBound: number;
    upperBound: number;
  }
> = {
  accuracy: { threshold: 0.33, lowerBound: 0.29, upperBound: 0.37 },
  attemptRate: { threshold: 0.1, lowerBound: 0.05, upperBound: 0.15 },
};
export function runGroupedHoldout(
  rows: readonly ReconstructionRow[],
  context: FeatureContext,
  lambdas: {
    accuracyLambda: number;
    attemptRateLambda: number;
  },
  priors: PriorInput,
  foldCount = 5,
): {
  accuracy: ReconstructionMetrics;
  attemptRate: ReconstructionMetrics;
  foldCount: number;
} {
  const playerIds = [...new Set(rows.map((row) => row.playerExternalId))];
  const foldOfPlayer = new Map(playerIds.map((id) => [id, foldOf(id, foldCount)]));
  const accuracyPredictions: HeldOutPrediction[] = [];
  const attemptPredictions: HeldOutPrediction[] = [];
  for (let fold = 0; fold < foldCount; fold += 1) {
    const train = rows.filter((row) => foldOfPlayer.get(row.playerExternalId) !== fold);
    const heldOut = rows.filter((row) => foldOfPlayer.get(row.playerExternalId) === fold);
    const accuracyModel = fitModel(train, context, 'accuracy', lambdas.accuracyLambda, priors);
    const attemptModel = fitModel(train, context, 'attemptRate', lambdas.attemptRateLambda, priors);
    for (const row of heldOut) {
      const raw = featureVector(extractRawFeatures(row, context));
      const observedAccuracy = observedRateFor(row, 'accuracy');
      if (observedAccuracy !== null) {
        accuracyPredictions.push({
          row,
          prediction: predictConservative(accuracyModel, raw, 0.25),
          observed: observedAccuracy,
          weight: trialWeightFor(row, 'accuracy'),
        });
      }
      const observedAttempt = observedRateFor(row, 'attemptRate');
      if (observedAttempt !== null) {
        attemptPredictions.push({
          row,
          prediction: predictConservative(attemptModel, raw, 0.3),
          observed: observedAttempt,
          weight: trialWeightFor(row, 'attemptRate'),
        });
      }
    }
  }
  return {
    accuracy: metricsOf(accuracyPredictions, 'accuracy'),
    attemptRate: metricsOf(attemptPredictions, 'attemptRate'),
    foldCount,
  };
}
export function metricsOf(
  predictions: readonly HeldOutPrediction[],
  model: ReconstructionModel,
): ReconstructionMetrics {
  const totalWeight = predictions.reduce((sum, p) => sum + p.weight, 0) || 1;
  let absoluteError = 0;
  let bias = 0;
  let overprediction = 0;
  const byPosition = new Map<
    string,
    {
      mae: number;
      bias: number;
      count: number;
      weight: number;
    }
  >();
  const byEvidence = new Map<
    string,
    {
      mae: number;
      bias: number;
      count: number;
      weight: number;
    }
  >();
  let falsePositives = 0;
  let falseNegatives = 0;
  const { threshold, lowerBound, upperBound } = FP_FN[model];
  for (const p of predictions) {
    const error = p.prediction - p.observed;
    absoluteError += Math.abs(error) * p.weight;
    bias += error * p.weight;
    if (p.prediction > p.observed) overprediction += p.weight;
    addBand(byPosition, p.row.positionGroup, p, error);
    addBand(byEvidence, evidenceBandOf(p.row.minutes), p, error);
    if (p.prediction >= threshold && p.observed < lowerBound) falsePositives += 1;
    if (p.prediction < threshold && p.observed > upperBound) falseNegatives += 1;
  }
  return {
    mae: round6(absoluteError / totalWeight),
    bias: round6(bias / totalWeight),
    overpredictionShare: round6(overprediction / totalWeight),
    samplePlayers: new Set(predictions.map((p) => p.row.playerExternalId)).size,
    positionBands: {
      G: bandMetrics(byPosition.get('G')),
      F: bandMetrics(byPosition.get('F')),
      C: bandMetrics(byPosition.get('C')),
    },
    evidenceBands: [...byEvidence.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([band, stats]) => ({
        band,
        mae: round6(stats.mae / Math.max(1, stats.weight)),
        bias: round6(stats.bias / Math.max(1, stats.weight)),
        count: stats.count,
      })),
    falsePositives: { count: falsePositives, threshold, lowerBound },
    falseNegatives: { count: falseNegatives, threshold, upperBound },
  };
}
function addBand(
  bands: Map<
    string,
    {
      mae: number;
      bias: number;
      count: number;
      weight: number;
    }
  >,
  key: string,
  p: HeldOutPrediction,
  error: number,
): void {
  const current = bands.get(key) ?? { mae: 0, bias: 0, count: 0, weight: 0 };
  current.mae += Math.abs(error) * p.weight;
  current.bias += error * p.weight;
  current.count += 1;
  current.weight += p.weight;
  bands.set(key, current);
}
function bandMetrics(
  stats:
    | {
        mae: number;
        bias: number;
        count: number;
        weight: number;
      }
    | undefined,
): {
  mae: number;
  bias: number;
  count: number;
} {
  if (stats === undefined || stats.weight <= 0) return { mae: 0, bias: 0, count: 0 };
  return {
    mae: round6(stats.mae / stats.weight),
    bias: round6(stats.bias / stats.weight),
    count: stats.count,
  };
}
export function evidenceBandOf(minutes: number): string {
  if (minutes < 500) return 'under-500-min';
  if (minutes < 1500) return '500-1499-min';
  return '1500-plus-min';
}
export const LAMBDA_GRID = [0.5, 1, 2, 4] as const;
export function pickLambda(
  rows: readonly ReconstructionRow[],
  context: FeatureContext,
  priors: PriorInput,
  foldCount = 5,
): {
  accuracyLambda: number;
  attemptRateLambda: number;
} {
  let bestAccuracy: {
    lambda: number;
    mae: number;
  } | null = null;
  let bestAttempt: {
    lambda: number;
    mae: number;
  } | null = null;
  for (const lambda of LAMBDA_GRID) {
    const report = runGroupedHoldout(
      rows,
      context,
      { accuracyLambda: lambda, attemptRateLambda: lambda },
      priors,
      foldCount,
    );
    if (bestAccuracy === null || report.accuracy.mae < bestAccuracy.mae) {
      bestAccuracy = { lambda, mae: report.accuracy.mae };
    }
    if (bestAttempt === null || report.attemptRate.mae < bestAttempt.mae) {
      bestAttempt = { lambda, mae: report.attemptRate.mae };
    }
  }
  return {
    accuracyLambda: bestAccuracy?.lambda ?? 1,
    attemptRateLambda: bestAttempt?.lambda ?? 1,
  };
}
