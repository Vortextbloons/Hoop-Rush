/**
 * Shared deterministic 32-bit draw from a 32-hex seed (Season Run economy
 * modules). The seeded namespaced sub-seeds are 32-hex strings; the first
 * eight hex digits parse as the unsigned 32-bit draw used for bounded
 * uniform rolls (`% modulus`) and bitwise reductions (`>>> 0`). Single
 * implementation shared by trades, injuries, and the economy fixtures so the
 * slice and radix can never drift.
 */

/** Deterministic 32-bit integer from the first eight hex digits of a seed. */
export function drawHexInt(seed: string): number {
  return Number.parseInt(seed.slice(0, 8), 16);
}
