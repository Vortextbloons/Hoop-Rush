import { canonicalJson } from '@hoop-rush/data-contracts';

// Shared canonicalization primitives for season digests and checkpoints.
// All helpers preserve insertion-independent ordering: object keys are handled
// by canonicalJson, array order is normalized here. Do not change comparators
// without bumping the corresponding digest version.

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortedBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareStrings(keyOf(a), keyOf(b)));
}

export function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort(compareStrings);
}

export function sortedEntries<T>(record: Record<string, T>): Array<[string, T]> {
  return Object.entries(record).sort(([a], [b]) => compareStrings(a, b));
}

export function sortedNumericEntries<T>(record: Record<string, T>): Array<[string, T]> {
  return Object.entries(record).sort(([a], [b]) => Number(a) - Number(b));
}

export function comparePairKeys(a: { a: string; b: string }, b: { a: string; b: string }): number {
  return compareStrings(a.a, b.a) || compareStrings(a.b, b.b);
}

export function canonicalEffectsPayload(effects: {
  schemaVersion: number;
  playerStates: readonly { playerVersionId: string }[];
  pairStates: readonly { a: string; b: string }[];
}): string {
  return canonicalJson({
    schemaVersion: effects.schemaVersion,
    playerStates: sortedBy(effects.playerStates, (player) => player.playerVersionId),
    pairStates: [...effects.pairStates].sort(comparePairKeys),
  });
}

export function canonicalHealthPayload(health: {
  schemaVersion: number;
  healthVersion: string;
  injuries: readonly { injuryId: string }[];
}): string {
  return canonicalJson({
    schemaVersion: health.schemaVersion,
    healthVersion: health.healthVersion,
    injuries: sortedBy(health.injuries, (injury) => injury.injuryId),
  });
}

export function canonicalInfluencePayload(influence: {
  schemaVersion: number;
  influenceVersion: string;
  balances: unknown;
  ledger: readonly { entryId: string }[];
  windows: Record<string, readonly { windowIndex: number }[]>;
  rehabs: Record<string, unknown>;
}): string {
  return canonicalJson({
    schemaVersion: influence.schemaVersion,
    influenceVersion: influence.influenceVersion,
    balances: influence.balances,
    ledger: sortedBy(influence.ledger, (entry) => entry.entryId),
    windows: Object.fromEntries(
      sortedEntries(influence.windows).map(([franchiseId, windows]) => [
        franchiseId,
        [...windows].sort((a, b) => a.windowIndex - b.windowIndex),
      ]),
    ),
    rehabs: Object.fromEntries(sortedEntries(influence.rehabs)),
  });
}

export function canonicalTeamAggregatesPayload(
  rows: readonly { franchiseId: string }[],
): { franchiseId: string }[] {
  return sortedBy(rows, (row) => row.franchiseId);
}

export function canonicalPlayerAggregatesPayload(
  rows: readonly { playerVersionId: string }[],
): { playerVersionId: string }[] {
  return sortedBy(rows, (row) => row.playerVersionId);
}

export function canonicalGameSummariesPayload(
  rows: readonly { gameId: string }[],
): { gameId: string }[] {
  return sortedBy(rows, (row) => row.gameId);
}
