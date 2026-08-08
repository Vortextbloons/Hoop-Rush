/**
 * Canonical descriptive-statistic helpers for CLI calibration and audit
 * commands (deduplicated from per-command copies).
 *
 * Conventions:
 * - `median` is the true statistical median (the mean of the two middle
 *   values on an even-length list; 0 for an empty list).
 * - `percentile` takes the fraction p in [0, 1] and returns the nearest-rank
 *   value by index (floor(p * (length - 1)), clamped).
 * - `mean` is the arithmetic mean (0 for an empty list).
 *
 * Commands whose frozen artifacts were authored with a different convention
 * (the index-based lower median, or a percent/round percentile) keep their
 * own local helpers so regeneration output stays byte-identical.
 */

/** Arithmetic mean of a numeric array (0 for an empty array). */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** Median of a numeric list; the mean of the two middle values when even. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Nearest-rank percentile of a numeric list for a fraction p in [0, 1]. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[index] ?? 0;
}
