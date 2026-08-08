/**
 * Shared numeric helpers for the deterministic engine (no platform APIs, no
 * RNG). `clamp` is the single implementation of bounded value coercion used
 * by challenge contextual value, AI scoring, and position responsibilities.
 */

/** Clamps `value` into [low, high] (inclusive). */
export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
