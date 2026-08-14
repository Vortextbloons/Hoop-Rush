export function normalizeValue(
  raw: number,
  baseline: number,
  perPoint: number,
  min = 0,
  max = 100,
): number {
  return Math.min(max, Math.max(min, (raw - baseline) / Math.max(1e-9, perPoint) + 50));
}
