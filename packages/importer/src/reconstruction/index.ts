/**
 * Conservative three-point reconstruction module (spec/12). Offline,
 * deterministic two-model pipeline over the 1979-80..1983-84 early
 * three-point cohort:
 *
 * - accuracy: regularized binomial logistic model of 3PM/3PA from
 *   historically available traits;
 * - attemptRate: regularized binomial logistic model of 3PA/FGA.
 *
 * Predictions consume conservative posterior quantiles (accuracy 25th,
 * attempt rate 30th percentile) via Laplace covariance. The checked-in
 * artifact and the `calibrate three-point` report are the reproducibility
 * boundary; derivation and the browser consume only per-player profiles.
 */
export {
  RECONSTRUCTION_SEASONS,
  RECONSTRUCTION_FEATURE_NAMES,
  PRIOR_EQUIVALENT_ATTEMPTS,
  buildFeatureContext,
  cohortPriors,
  extractRawFeatures,
  featureVector,
  loadCohortRows,
  median,
  positionGroupOf,
  type FeatureContext,
  type PositionGroup,
  type ReconstructionRow,
} from './rows.ts';
export {
  fitThreePointReconstruction,
  loadThreePointReconstructionArtifact,
  reconstructionArtifactPath,
  validateThreePointReconstructionArtifact,
  writeThreePointReconstructionArtifact,
  weightedPercentile,
  type FitResult,
} from './artifact.ts';
export { predictReconstructedProfile, ratingFromAccuracy } from './predict.ts';
export {
  evidenceBandOf,
  foldOf,
  metricsOf,
  observedRateFor,
  pickLambda,
  runGroupedHoldout,
  trialWeightFor,
  type HeldOutPrediction,
  type Normalization,
} from './cross-validation.ts';
export { fitBinomialLogistic, fnv1a32, normalQuantile, sigmoid } from './math.ts';
