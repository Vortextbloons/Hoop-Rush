export interface TimedMetric {
  sampleCount: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
}

export interface BaselineMetric {
  id: string;
  label: string;
  noiseMs: number;
}

export interface BaselineComparison {
  status: 'not-requested' | 'matched' | 'skipped-fingerprint' | 'regressed';
  fingerprintMatched: boolean;
  baselineFingerprint: string | null;
  regressions: Array<{
    metric: 'medianMs' | 'p95Ms';
    measurement: string;
    baselineMs: number;
    currentMs: number;
    noiseAllowanceMs: number;
  }>;
}

export function timingStats(samples: readonly number[]): TimedMetric {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    sampleCount: samples.length,
    medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? sorted[sorted.length - 1] ?? 0,
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

export function compareTimedBaselines(input: {
  readonly currentFingerprint: string;
  readonly baselineFingerprint: string;
  readonly current: Readonly<Record<string, TimedMetric>>;
  readonly baseline: Readonly<Record<string, TimedMetric>>;
  readonly metrics: readonly BaselineMetric[];
  readonly details: string[];
}): { failures: string[]; comparison: BaselineComparison } {
  if (input.baselineFingerprint !== input.currentFingerprint) {
    input.details.push('baseline comparison skipped: environment fingerprint does not match');
    return {
      failures: [],
      comparison: {
        status: 'skipped-fingerprint',
        fingerprintMatched: false,
        baselineFingerprint: input.baselineFingerprint,
        regressions: [],
      },
    };
  }
  input.details.push('baseline environment fingerprint matched');
  const failures: string[] = [];
  const regressions: BaselineComparison['regressions'] = [];
  for (const metric of input.metrics) {
    const currentMetric = input.current[metric.id];
    const baselineMetric = input.baseline[metric.id];
    if (currentMetric === undefined || baselineMetric === undefined) {
      failures.push(`baseline is missing measurement ${metric.id}`);
      continue;
    }
    for (const field of ['medianMs', 'p95Ms'] as const) {
      const increase = currentMetric[field] - baselineMetric[field];
      if (currentMetric[field] > baselineMetric[field] * 1.25 && increase > metric.noiseMs) {
        regressions.push({
          metric: field,
          measurement: metric.id,
          baselineMs: baselineMetric[field],
          currentMs: currentMetric[field],
          noiseAllowanceMs: metric.noiseMs,
        });
        failures.push(
          `${metric.label} ${field} regressed from ${baselineMetric[field].toFixed(2)} ms to ${currentMetric[field].toFixed(2)} ms`,
        );
      }
    }
  }
  return {
    failures,
    comparison: {
      status: regressions.length > 0 ? 'regressed' : 'matched',
      fingerprintMatched: true,
      baselineFingerprint: input.baselineFingerprint,
      regressions,
    },
  };
}
