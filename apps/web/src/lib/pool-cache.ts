import Dexie, { type EntityTable } from 'dexie';
import type { FranchiseEraPool } from '@hoop-rush/data-contracts';

/**
 * Best-effort IndexedDB cache for franchise-era pools (web adapter layer).
 *
 * Pools are immutable, content-addressed artifacts: the manifest carries a
 * SHA-256 per pool, verified when the pool is first fetched. A cached record
 * is trusted only when its stored hash matches the current manifest hash, so
 * a data repack naturally invalidates stale cache entries.
 *
 * Cache failures (unavailable storage, quota, corrupt records) never break
 * pool loading: every read fallback drops through to the network path.
 */

interface CachedPoolRecord {
  /** `franchiseId/eraId` cache key. */
  key: string;
  /** Manifest content hash of the pool at write time. */
  contentHash: string;
  /** Validated FranchiseEraPool payload. */
  pool: FranchiseEraPool;
  savedAt: number;
}

const db = new Dexie('hoop-rush') as Dexie & {
  pools: EntityTable<CachedPoolRecord, 'key'>;
};

db.version(1).stores({
  pools: 'key',
});

/** Read a previously cached pool when its content hash still matches. */
export async function readCachedPool(
  key: string,
  expectedHash: string,
): Promise<FranchiseEraPool | null> {
  try {
    const record = await db.pools.get(key);
    // The pool was schema-validated before caching and is trusted only when
    // the content hash still matches the manifest, so no re-parse is needed.
    if (!record || record.contentHash !== expectedHash) return null;
    return record.pool;
  } catch {
    return null;
  }
}

/** Persist a validated pool for future visits; failures are silently ignored. */
export async function writeCachedPool(
  key: string,
  contentHash: string,
  pool: FranchiseEraPool,
): Promise<void> {
  try {
    await db.pools.put({ key, contentHash, pool, savedAt: Date.now() });
  } catch {
    // The cache is an optimization, never a hard dependency.
  }
}
