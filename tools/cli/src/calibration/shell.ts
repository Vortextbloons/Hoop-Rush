import type { CliReport } from '../report.ts';
import { makeReport } from '../report.ts';
import { gateSummary, type M25Gate } from '../commands/season-calibration.ts';
import { commitTargetsArtifact } from './artifacts.ts';
import type { SeedRangeCalibration } from './harness.ts';
import { calibrationGateFailures } from './report.ts';

export interface CalibrationMeasurement<TExtra> {
  targets: (() => unknown) | null;
  metrics: M25Gate[];
  gates: Record<string, boolean>;
  extra: TExtra;
}

export interface CalibrationShellState<TExtra> {
  plan: SeedRangeCalibration;
  metrics: M25Gate[];
  gates: Record<string, boolean>;
  skippedGates: string[];
  pass: boolean;
  targetsWritten: boolean;
  targetsPath: string | null;
  commitError: string | null;
  startedAt: number;
  extra: TExtra;
}

export interface CalibrationShellOptions<TExtra> {
  command: string;
  argsForReport: Record<string, unknown>;
  plan: SeedRangeCalibration;
  startedAt: number;
  validate: (() => CliReport) | null;
  measure: () => CalibrationMeasurement<TExtra>;
  report: (state: CalibrationShellState<TExtra>) => { details: string[]; payload: unknown };
  payloadSchema: { parse: (value: unknown) => unknown };
  artifact: {
    outPath: string;
    defaultTargetsPath: string;
    manifestPath: string;
    manifestKey: string;
    manifestUrl: string;
  };
}

export function runCalibrationShell<TExtra>(options: CalibrationShellOptions<TExtra>): CliReport {
  if (options.validate !== null) return options.validate();
  let measured: CalibrationMeasurement<TExtra>;
  try {
    measured = options.measure();
  } catch (error) {
    return makeReport(options.command, options.argsForReport, {
      failures: [`calibration cohort failed: ${(error as Error).message}`],
      exitCode: 2,
    });
  }
  const metrics = measured.metrics;
  const { skippedGates, pass } = gateSummary(metrics);
  let targetsWritten = false;
  let targetsPath: string | null = null;
  let commitError: string | null = null;
  if (pass && measured.targets !== null) {
    const commit = commitTargetsArtifact({
      ...options.artifact,
      content: measured.targets(),
    });
    targetsWritten = commit.written;
    targetsPath = commit.path;
    commitError = commit.error;
  }
  const state: CalibrationShellState<TExtra> = {
    plan: options.plan,
    metrics,
    gates: measured.gates,
    skippedGates,
    pass,
    targetsWritten,
    targetsPath,
    commitError,
    startedAt: options.startedAt,
    extra: measured.extra,
  };
  const { details, payload } = options.report(state);
  const failures = [
    ...(commitError !== null ? [commitError] : []),
    ...calibrationGateFailures({ pass, targetsWritten, skippedGates, metrics }),
  ];
  return makeReport(options.command, options.argsForReport, {
    details,
    failures,
    payload: options.payloadSchema.parse(payload),
  });
}
