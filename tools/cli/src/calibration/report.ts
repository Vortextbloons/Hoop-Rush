export interface CalibrationGateMetric {
  key: string;
  observed: unknown;
  status: string;
  pass: boolean;
}

export function targetsDetail(args: {
  targetsWritten: boolean;
  targetsPath: string | null;
  writeRequested?: boolean;
}): string {
  if (args.targetsWritten) return `targets written to ${args.targetsPath ?? '?'}`;
  if (args.writeRequested === false) return 'targets not written (no --write)';
  return 'targets NOT written';
}

export function calibrationGateFailures(args: {
  pass: boolean;
  targetsWritten: boolean;
  skippedGates: readonly string[];
  metrics: readonly CalibrationGateMetric[];
}): string[] {
  const failures: string[] = [];
  if (args.skippedGates.length > 0) {
    failures.push(`gates skipped (insufficient sample): ${args.skippedGates.join(', ')}`);
  }
  if (!args.pass) {
    for (const metric of args.metrics) {
      if (!metric.pass) {
        failures.push(`gate ${metric.key}: observed ${String(metric.observed)} (${metric.status})`);
      }
    }
  }
  if (args.pass && !args.targetsWritten) failures.push('targets artifact was not written');
  return failures;
}
