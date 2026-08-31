import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  threePointReconstructionArtifactSchema,
  type ReconstructionMetrics,
} from '@hoop-rush/data-contracts';
import {
  fitThreePointReconstruction,
  loadCohortRows,
  validateThreePointReconstructionArtifact,
  writeThreePointReconstructionArtifact,
} from '@hoop-rush/importer';
import { makeReport, type CliReport } from '../report.ts';
import { loadPackagedData } from './data-loader.ts';
import { threePointCalibrateReportSchema } from '../report-schemas.ts';
export const CALIBRATE_THREE_POINT_OPTIONS: Record<string, boolean> = {
  write: false,
  format: true,
  manifest: true,
  output: true,
};
export function calibrateThreePoint(args: {
  write?: boolean;
  format?: string;
  manifest?: string;
  output?: string;
}): CliReport {
  const packaged = loadPackagedData(args.manifest);
  const output = args.output ?? join(packaged.dir, 'three-point-reconstruction-v1.json');
  const rows = loadCohortRows();
  const { artifact, gates } = fitThreePointReconstruction(rows);
  const accuracyRows = rows.filter((row) => row.tpa !== null && row.tpa > 0).length;
  const attemptRows = rows.filter((row) => row.fga !== null && row.fga > 0).length;
  const failures: string[] = [];
  if (!gates.meanBiasNonPositiveAccuracy) {
    failures.push('accuracy holdout mean bias is positive (mean bias accuracy <= 0 gate failed)');
  }
  if (!gates.meanBiasNonPositiveTranslatedAttemptRate) {
    failures.push(
      'translated attempt-rate mean bias vs the modern cohort is positive (mean bias attempt rate <= 0 gate failed)',
    );
  }
  if (!gates.floorBelowEstablished) {
    failures.push('reconstructed floor is not below the established .32/.34 zone floors');
  }
  let written = false;
  if (args.write === true) {
    if (failures.length === 0) {
      try {
        writeThreePointReconstructionArtifact(artifact, output);
        written = true;
      } catch (error) {
        failures.push(`write failed: ${(error as Error).message}`);
      }
    } else {
      failures.push('refusing to write artifact: gates failed');
    }
  }
  const payload = threePointCalibrateReportSchema.parse({
    schemaVersion: 1,
    command: 'calibrate three-point',
    artifactVersion: artifact.artifactVersion,
    written,
    artifactPath: output,
    cohortSize: { rows: rows.length, accuracyRows, attemptRows },
    gates,
    floors: artifact.floors,
    ratingMapping: artifact.ratingMapping,
    regularization: artifact.regularization,
    priors: artifact.priors,
    fitCohort: artifact.fitCohort,
    holdout: artifact.holdout,
    generatedBy: artifact.generatedBy,
  });
  const cohortLabel = `${artifact.fitCohort.seasons[0] ?? '?'}..${artifact.fitCohort.seasons[4] ?? '?'}`;
  const translation = artifact.attemptRateTranslation;
  const details = [
    `cohort ${cohortLabel} · ${String(rows.length)} rows · ${String(accuracyRows)} accuracy rows · ${String(attemptRows)} attempt rows`,
    ...modelDetails('accuracy', artifact.holdout.accuracy),
    ...modelDetails('attemptRate', artifact.holdout.attemptRate),
    ...modelDetails('translatedAttemptRateModern', artifact.holdout.translatedAttemptRateModern),
    `translation: volume x${String(translation.factor)} capped G ${String(translation.caps.G)} / F ${String(translation.caps.F)} / C ${String(translation.caps.C)}; accuracy never translated`,
    `mean bias accuracy <= 0: ${gates.meanBiasNonPositiveAccuracy ? 'PASS' : 'FAIL'}`,
    `mean bias translated attempt rate (modern cohort) <= 0: ${gates.meanBiasNonPositiveTranslatedAttemptRate ? 'PASS' : 'FAIL'}`,
    `floor below established .32/.34: ${gates.floorBelowEstablished ? 'PASS' : 'FAIL'} (floor ${artifact.floors.floor.toFixed(3)})`,
    `floors: overall ${artifact.floors.floor.toFixed(3)} · corner ${artifact.floors.zoneFloors.cornerThree.toFixed(3)} · above-break ${artifact.floors.zoneFloors.aboveBreakThree.toFixed(3)}`,
    `priors: accuracy ${artifact.priors.accuracyPrior.toFixed(3)} (${String(Math.round(artifact.priors.accuracyPriorAttempts))} attempts) · attempt rate ${artifact.priors.attemptRatePrior.toFixed(3)} (${String(Math.round(artifact.priors.attemptRatePriorTrials))} trials)`,
    `rating mapping: ${String(artifact.ratingMapping.points.length)} points · clamp ${String(artifact.ratingMapping.clampMin)}..${String(artifact.ratingMapping.clampMax)}`,
    existingArtifactDetail(output),
    written ? `written: ${output}` : `not written (pass --write to write ${output})`,
  ];
  return makeReport(
    'calibrate three-point',
    { write: args.write === true, output },
    { details, failures, payload },
  );
}
function modelDetails(model: string, metrics: ReconstructionMetrics): string[] {
  const position = (['G', 'F', 'C'] as const).map((name) => {
    const band = metrics.positionBands[name];
    return `${name} MAE ${band.mae.toFixed(4)} bias ${band.bias.toFixed(4)} (n=${String(band.count)})`;
  });
  const evidence = metrics.evidenceBands.map(
    (band) =>
      `${band.band} MAE ${band.mae.toFixed(4)} bias ${band.bias.toFixed(4)} (n=${String(band.count)})`,
  );
  return [
    `${model}   MAE ${metrics.mae.toFixed(4)}  bias ${metrics.bias.toFixed(4)}  overpred ${metrics.overpredictionShare.toFixed(3)}  players ${String(metrics.samplePlayers)}`,
    `  ${model} position: ${position.join(' · ')}`,
    `  ${model} evidence: ${evidence.join(' · ')}`,
  ];
}
function existingArtifactDetail(output: string): string {
  let existing: unknown;
  try {
    existing = JSON.parse(readFileSync(output, 'utf8')) as unknown;
  } catch {
    return 'existing artifact: none';
  }
  const parsed = threePointReconstructionArtifactSchema.safeParse(existing);
  if (!parsed.success) return 'existing artifact: invalid (schema validation failed)';
  const state = validateThreePointReconstructionArtifact(parsed.data);
  return state.valid
    ? `existing artifact: valid (${parsed.data.artifactVersion})`
    : `existing artifact: invalid (${state.failures.join('; ')})`;
}
