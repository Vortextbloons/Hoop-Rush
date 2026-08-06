import type { SeasonPairChemistryState } from '@hoop-rush/data-contracts';

/**
 * M2.4 pair chemistry (spec/2.0/04, season-chemistry-v1). Every roster's 45
 * canonical player pairs start at zero shared possessions; after each
 * completed trip every pair of each active five increments by one. Wins,
 * scores, player identity, and off-court time never add chemistry, so a
 * pair's chemistry is a pure record of shared recorded play.
 *
 * Pair chemistry is `shared / (shared + 600)` converted to basis points;
 * active-unit chemistry is the arithmetic mean of its ten pair values.
 * Trades in M2.5 naturally create zero-state pairs; no same-person-version
 * exception exists.
 *
 * Pure TypeScript: no Svelte, persistence, worker, or network code.
 */

/** Chemistry half-life constant: a pair reaches 50% at 600 shared trips. */
export const SEASON_CHEMISTRY_HALF_SHARED = 600;

/** Basis-point scale (10,000 = 100%). */
export const SEASON_CHEMISTRY_BASIS_POINT_SCALE = 10_000;

/** Canonical pair key: `a<0>b`, where a < b lexicographically. */
export function seasonPairKey(a: string, b: string): string {
  return `${a}\u0000${b}`;
}

/** Whether a pair is canonically ordered (a < b lexicographically). */
export function seasonPairIsCanonical(a: string, b: string): boolean {
  return a < b;
}

/** All 45 unordered canonical pairs of a ten-player roster. */
export function canonicalRosterPairs(roster: readonly string[]): Array<[string, string]> {
  if (roster.length !== 10 || new Set(roster).size !== 10) {
    throw new Error(
      `season chemistry: roster must be ten distinct versions (got ${String(roster.length)})`,
    );
  }
  const sorted = [...roster].sort();
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      if (a !== undefined && b !== undefined) pairs.push([a, b]);
    }
  }
  return pairs;
}

/** The ten unordered canonical pairs of an active unit (five versions). */
export function unitPairs(unit: readonly string[]): Array<[string, string]> {
  if (unit.length !== 5 || new Set(unit).size !== 5) {
    throw new Error(
      `season chemistry: unit must be five distinct versions (got ${String(unit.length)})`,
    );
  }
  const sorted = [...unit].sort();
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      if (a !== undefined && b !== undefined) pairs.push([a, b]);
    }
  }
  return pairs;
}

/** Pair chemistry in basis points: `shared / (shared + 600)`, rounded. */
export function pairChemistryBasisPoints(shared: number): number {
  return Math.round(
    (shared / (shared + SEASON_CHEMISTRY_HALF_SHARED)) * SEASON_CHEMISTRY_BASIS_POINT_SCALE,
  );
}

/**
 * Active-unit chemistry: the arithmetic mean of its ten pair values, in
 * basis points. Every pair of the unit must exist in the supplied pair
 * states; a missing pair is a roster mismatch and throws.
 */
export function unitChemistryBasisPoints(
  pairStates: readonly SeasonPairChemistryState[],
  unit: readonly string[],
): number {
  const byKey = new Map(pairStates.map((pair) => [seasonPairKey(pair.a, pair.b), pair]));
  let sum = 0;
  for (const [a, b] of unitPairs(unit)) {
    const pair = byKey.get(seasonPairKey(a, b));
    if (pair === undefined) {
      throw new Error(`season chemistry: unit pair ${a}-${b} is not a tracked pair`);
    }
    sum += pairChemistryBasisPoints(pair.sharedPossessions);
  }
  return Math.round(sum / 10);
}

/**
 * The five unit pairs' shared-possession totals as a map (for per-unit
 * explanation facts). Missing pairs throw, matching unitChemistryBasisPoints.
 */
export function unitSharedPossessions(
  pairStates: readonly SeasonPairChemistryState[],
  unit: readonly string[],
): Map<string, number> {
  const byKey = new Map(pairStates.map((pair) => [seasonPairKey(pair.a, pair.b), pair]));
  const totals = new Map<string, number>();
  for (const [a, b] of unitPairs(unit)) {
    const pair = byKey.get(seasonPairKey(a, b));
    if (pair === undefined) {
      throw new Error(`season chemistry: unit pair ${a}-${b} is not a tracked pair`);
    }
    totals.set(seasonPairKey(a, b), pair.sharedPossessions);
  }
  return totals;
}
