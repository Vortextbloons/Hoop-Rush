/**
 * Shared number formatting for stat displays. These helpers freeze the
 * idioms used across roster, classic, sandbox, and season surfaces: one
 * decimal via `toFixed` semantics (round-half-away-from-zero to 1 decimal),
 * and 0-1 ratios as one-decimal percentages.
 */

export function percentOneDecimal(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function oneDecimal(value: number): string {
  return value.toFixed(1);
}
