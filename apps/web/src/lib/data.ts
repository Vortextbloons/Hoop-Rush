import {
  loadManifest,
  loadPool,
  type HoopRushManifest,
  type FranchiseEraPool,
  type PoolIndexEntry,
} from '@hoop-rush/data-contracts';
import { readCachedPool, writeCachedPool } from './pool-cache';

let manifestPromise: Promise<HoopRushManifest> | null = null;

function manifestUrl(): string {
  return `${import.meta.env.BASE_URL}data/manifest.json`;
}

/** Pool URLs are relative to the manifest directory (e.g. pools/lakers-1990s.json). */
function resolveAssetUrl(url: string): string {
  if (/^https?:\/\//.test(url) || url.startsWith('/')) return url;
  return `${import.meta.env.BASE_URL}data/${url}`;
}

/** Load (once) and validate the Hoop Rush manifest. */
export function getManifest(): Promise<HoopRushManifest> {
  if (!manifestPromise) {
    manifestPromise = loadManifest(manifestUrl(), { cache: 'no-store' });
  }
  return manifestPromise;
}

const poolCache = new Map<string, Promise<FranchiseEraPool>>();

/** Load, hash-verify, and validate a franchise-era pool asset. */
export function getPool(entry: PoolIndexEntry): Promise<FranchiseEraPool> {
  const key = `${entry.franchiseId}/${entry.eraId}`;
  let promise = poolCache.get(key);
  if (!promise) {
    promise = loadPoolForEntry(entry, key);
    poolCache.set(key, promise);
    // A failed load must not poison the cache: the next request retries.
    promise.catch(() => {
      poolCache.delete(key);
    });
  }
  return promise;
}

async function loadPoolForEntry(entry: PoolIndexEntry, key: string): Promise<FranchiseEraPool> {
  const cached = await readCachedPool(key, entry.contentHash);
  if (cached) return cached;
  const pool = await loadPool(resolveAssetUrl(entry.url), entry.contentHash);
  void writeCachedPool(key, entry.contentHash, pool);
  return pool;
}

/**
 * Kick off background loads so a later pick resolves from memory instantly.
 *
 * Today the manifest packages a handful of pools; when the pool count grows
 * into the hundreds, gate this on user intent (e.g. opening the franchise
 * dropdown) instead of prefetching everything eagerly.
 */
export function prefetchPools(entries: readonly PoolIndexEntry[]): void {
  for (const entry of entries) {
    void getPool(entry).catch(() => {
      // Best-effort warm-up; the selection path surfaces real errors.
    });
  }
}
