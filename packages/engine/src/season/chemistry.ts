import type { SeasonPairChemistryState } from '@hoop-rush/data-contracts';
import { SEASON_ROSTER_SIZE } from './roster-rules.ts';
export const SEASON_CHEMISTRY_HALF_SHARED = 600;
export const SEASON_CHEMISTRY_BASIS_POINT_SCALE = 10000;
export function seasonPairKey(a: string, b: string): string {
  return `${a}\u0000${b}`;
}
export function seasonPairIsCanonical(a: string, b: string): boolean {
  return a < b;
}
export function canonicalPlayerPairs(players: readonly string[]): Array<[string, string]> {
  if (new Set(players).size !== players.length) {
    throw new Error('season chemistry: player versions must be distinct');
  }
  return canonicalPairs([...players].sort());
}
export function canonicalRosterPairs(roster: readonly string[]): Array<[string, string]> {
  if (roster.length !== SEASON_ROSTER_SIZE || new Set(roster).size !== SEASON_ROSTER_SIZE) {
    throw new Error(
      `season chemistry: roster must be ten distinct versions (got ${String(roster.length)})`,
    );
  }
  return canonicalPlayerPairs(roster);
}
export function unitPairs(unit: readonly string[]): Array<[string, string]> {
  if (unit.length !== 5 || new Set(unit).size !== 5) {
    throw new Error(
      `season chemistry: unit must be five distinct versions (got ${String(unit.length)})`,
    );
  }
  return canonicalPairs([...unit].sort());
}
function canonicalPairs(sorted: readonly string[]): Array<[string, string]> {
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
export function pairChemistryBasisPoints(shared: number): number {
  return Math.round(
    (shared / (shared + SEASON_CHEMISTRY_HALF_SHARED)) * SEASON_CHEMISTRY_BASIS_POINT_SCALE,
  );
}
export function unitChemistryFromShared(
  unit: readonly string[],
  sharedOf: (a: string, b: string) => number,
): number {
  let sum = 0;
  for (const [a, b] of unitPairs(unit)) {
    sum += pairChemistryBasisPoints(sharedOf(a, b));
  }
  return Math.round(sum / 10);
}
export function unitChemistryBasisPoints(
  pairStates: readonly SeasonPairChemistryState[],
  unit: readonly string[],
): number {
  const byKey = new Map(pairStates.map((pair) => [seasonPairKey(pair.a, pair.b), pair]));
  return unitChemistryFromShared(unit, (a, b) => {
    const pair = byKey.get(seasonPairKey(a, b));
    if (pair === undefined) {
      throw new Error(`season chemistry: unit pair ${a}-${b} is not a tracked pair`);
    }
    return pair.sharedPossessions;
  });
}
