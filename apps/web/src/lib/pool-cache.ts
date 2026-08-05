import Dexie, { type EntityTable } from 'dexie';
import type { FranchiseEraPool } from '@hoop-rush/data-contracts';

/**
 * Best-effort IndexedDB cache for franchise-era pools and large validated
 * JSON assets (web adapter layer).
 *
 * Pools and assets are immutable, content-addressed artifacts: the manifest
 * carries a SHA-256 per artifact, verified when it is first fetched. A
 * cached record is trusted only when its stored hash matches the current
 * manifest hash, so a data repack naturally invalidates stale cache entries.
 *
 * Cache failures (unavailable storage, quota, corrupt records) never break
 * loading: every read fallback drops through to the network path.
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

/** Large validated JSON assets (players index, roster details, catalog). */
interface CachedAssetRecord {
  /** SHA-256 content hash of the asset at write time. */
  key: string;
  /** Validated JSON payload (schema-validated before caching). */
  value: unknown;
  savedAt: number;
}

const db = new Dexie('hoop-rush') as Dexie & {
  pools: EntityTable<CachedPoolRecord, 'key'>;
  assets: EntityTable<CachedAssetRecord, 'key'>;
};

db.version(1).stores({
  pools: 'key',
});

db.version(2).stores({
  pools: 'key',
  assets: 'key',
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

/** Read a previously cached validated asset when its hash still matches. */
export async function readCachedAsset<T>(contentHash: string): Promise<T | null> {
  try {
    const record = await db.assets.get(contentHash);
    if (!record) return null;
    return record.value as T;
  } catch {
    return null;
  }
}

/** Persist a validated asset for future visits; failures are silently ignored. */
export async function writeCachedAsset(contentHash: string, value: unknown): Promise<void> {
  try {
    await db.assets.put({ key: contentHash, value, savedAt: Date.now() });
  } catch {
    // The cache is an optimization, never a hard dependency.
  }
}
