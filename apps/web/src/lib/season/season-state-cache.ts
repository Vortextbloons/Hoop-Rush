import type { SeasonRunSnapshot } from '@hoop-rush/persistence';

/**
 * Session-scoped cache of the last validated Season Run snapshot (web
 * adapter layer). The hub re-reads the accepted snapshot after every block
 * commit; the block-complete refresh and later route mounts reuse this cache
 * when the active-run index still matches, so the full validated load +
 * reconciliation audit runs once per commit instead of once per block and
 * again per navigation.
 *
 * The cache is keyed by runId + accepted-block count, so a new run, a
 * cleared run, or an out-of-band commit (another tab) falls through to the
 * repository load path automatically. It never substitutes for persistence:
 * a cold reload starts empty and loads once from IndexedDB.
 */

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

/** @internal Clears the cache (tests, explicit run teardown). */
export function clearCachedSeasonSnapshot(): void {
  cached = null;
}
