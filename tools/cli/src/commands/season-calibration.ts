/**
 * Pure gate helpers shared by the M2.5 calibration commands (`season health
 * calibrate`, `season trade calibrate`, `season influence calibrate`,
 * spec/2.0 M2.5 contract §17). This module deliberately imports nothing from
 * the engine so the gate math is unit-testable before the M2.5 engine seams
 * land; the season-level cohort drivers live in `season-m25-core.ts`.
 *
 * Every gate has a three-state status: 'pass', 'fail', or
 * 'skippedInsufficientSample' (a skipped gate is never reported as passing,
 * and a calibration that skips a gate never freezes its targets artifact).
 */

export type M25GateStatus = 'pass' | 'fail' | 'skippedInsufficientSample';

/** One evaluated gate; the shared shape the report payloads and docs use. */
export interface M25Gate {
  key: string;
  observed: number;
  /** The frozen target value (informational for range/direction gates). */
  target: number;
  /** Absolute tolerance around the target; null for range/direction gates. */
  tolerance: number | null;
  /** Frozen inclusive range for range gates; null otherwise. */
  min: number | null;
  max: number | null;
  status: M25GateStatus;
  pass: boolean;
  sample: number;
  minimumSample: number;
}

/** Evaluates `|observed - target| <= tolerance` with a sample floor. */
export function m25ToleranceGate(
  key: string,
  observed: number,
  target: number,
  tolerance: number,
  sample: number,
  minimumSample: number,
): M25Gate {
  const status: M25GateStatus =
    sample < minimumSample
      ? 'skippedInsufficientSample'
      : Math.abs(observed - target) <= tolerance
        ? 'pass'
        : 'fail';
  return {
    key,
    observed,
    target,
    tolerance,
    min: null,
    max: null,
    status,
    pass: status === 'pass',
    sample,
    minimumSample,
  };
}

/** Evaluates `min <= observed <= max` with a sample floor. */
export function m25RangeGate(
  key: string,
  observed: number,
  min: number,
  max: number,
  sample: number,
  minimumSample: number,
): M25Gate {
  const status: M25GateStatus =
    sample < minimumSample
      ? 'skippedInsufficientSample'
      : observed >= min && observed <= max
        ? 'pass'
        : 'fail';
  return {
    key,
    observed,
    target: (min + max) / 2,
    tolerance: null,
    min,
    max,
    status,
    pass: status === 'pass',
    sample,
    minimumSample,
  };
}

/**
 * Direction assertion for the frozen risk-input monotonicity gates: the
 * high-input cohort's observed incidence must exceed the low-input cohort's
 * (contract §17 "cohort splits with direction assertions").
 */
export function m25LiftGate(
  key: string,
  high: number,
  low: number,
  sample: number,
  minimumSample: number,
): M25Gate {
  const status: M25GateStatus =
    sample < minimumSample ? 'skippedInsufficientSample' : high > low ? 'pass' : 'fail';
  return {
    key,
    observed: high - low,
    target: 0,
    tolerance: null,
    min: null,
    max: null,
    status,
    pass: status === 'pass',
    sample,
    minimumSample,
  };
}

/** Frozen absolute-gap assertion (e.g. recurrence window vs non-window). */
export function m25GapGate(
  key: string,
  gap: number,
  minimumGap: number,
  sample: number,
  minimumSample: number,
): M25Gate {
  const status: M25GateStatus =
    sample < minimumSample ? 'skippedInsufficientSample' : gap >= minimumGap ? 'pass' : 'fail';
  return {
    key,
    observed: gap,
    target: minimumGap,
    tolerance: null,
    min: minimumGap,
    max: null,
    status,
    pass: status === 'pass',
    sample,
    minimumSample,
  };
}

/** Arithmetic mean of a numeric array (0 for an empty array). */
export { mean } from '../stats.ts';

/** Count / total as a fraction (0 for an empty total). */
export function share(count: number, total: number): number {
  return total <= 0 ? 0 : count / total;
}

/** Count / total expressed in basis points (0 for an empty total). */
export function rateBasisPoints(count: number, total: number): number {
  return total <= 0 ? 0 : (count / total) * 10_000;
}

/** The fixed 32-hex-digit sequential calibration cohort seed (M2.2 pattern). */
export function seasonCalibrationSeed(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`calibration seed index must be a nonnegative integer (got ${String(index)})`);
  }
  return index.toString(16).padStart(32, '0');
}

/** Inclusive integer seed range [from, to]. */
export function seedIndexRange(from: number, to: number): number[] {
  const indices: number[] = [];
  for (let i = from; i <= to; i += 1) indices.push(i);
  return indices;
}

/** The boolean value of one named gate (false when absent). */
export function gateValue(metrics: readonly M25Gate[], key: string): boolean {
  return metrics.find((metric) => metric.key === key)?.pass ?? false;
}

/** Named boolean gates + the skipped keys, derived from the metric array. */
export function gateSummary(metrics: readonly M25Gate[]): {
  gates: Record<string, boolean>;
  skippedGates: string[];
  pass: boolean;
} {
  const gates: Record<string, boolean> = {};
  const skippedGates: string[] = [];
  for (const metric of metrics) {
    gates[metric.key] = metric.pass;
    if (metric.status === 'skippedInsufficientSample') skippedGates.push(metric.key);
  }
  return { gates, skippedGates, pass: metrics.every((metric) => metric.pass) };
}
