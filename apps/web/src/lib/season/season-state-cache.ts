import type { SeasonRunSnapshot } from '@hoop-rush/persistence';

// Browser-local fast path only. The active-run index remains authoritative,
// and callers must validate cached snapshots against that index.
let cached: { snapshot: SeasonRunSnapshot } | null = null;

export function getCachedSeasonSnapshot(): SeasonRunSnapshot | null {
  return cached?.snapshot ?? null;
}

export function cachedSeasonSnapshotMatches(runId: string, revision: number): boolean {
  if (cached === null) return false;
  const snapshot = cached.snapshot;
  return snapshot.run.runId === runId && snapshot.acceptedBlocks.length === revision;
}

export function setCachedSeasonSnapshot(snapshot: SeasonRunSnapshot): void {
  cached = { snapshot };
}

export function clearCachedSeasonSnapshot(): void {
  cached = null;
}
