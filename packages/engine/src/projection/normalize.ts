/**
 * Shared projection normalization formula (projection milestone). Base and
 * ranking scores map a raw component onto the 0-100 scale through the same
 * frozen formula: 50 plus the raw deviation from a baseline in per-point
 * units, clamped to [min, max].
 */

/** Normalizes a raw component to 0-100: `clamp(min, max, 50 + (raw - baseline) / perPoint)`. */
export function normalizeValue(
  raw: number,
  baseline: number,
  perPoint: number,
  min = 0,
  max = 100,
): number {
  return Math.min(max, Math.max(min, (raw - baseline) / Math.max(1e-9, perPoint) + 50));
}
