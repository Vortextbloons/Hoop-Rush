export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
