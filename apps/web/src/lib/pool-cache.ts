import Dexie, { type EntityTable } from 'dexie';
import { franchiseEraPoolSchema, type FranchiseEraPool } from '@hoop-rush/data-contracts';

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
 * loading: every read fallback drops through to the network path. A present
 * but corrupt record is detected on read by re-validating the payload
 * through its schema (pools) or the caller's parser (assets), so corrupt
 * rows can never enter app state.
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

export async function readCachedPool(
  key: string,
  expectedHash: string,
): Promise<FranchiseEraPool | null> {
  try {
    const record = await db.pools.get(key);
    // The pool was schema-validated before caching and is trusted only when
    // the content hash still matches the manifest; the payload is re-parsed
    // so a corrupt-but-present record falls back to the network path.
    if (!record || record.contentHash !== expectedHash) return null;
    return franchiseEraPoolSchema.parse(record.pool);
  } catch {
    return null;
  }
}

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

/**
 * Read a previously cached validated asset when its hash still matches. When
 * `parse` is supplied, the stored payload is re-validated through it on
 * every read; a corrupt-but-present record returns null so the caller's
 * network fallback engages.
 */
export async function readCachedAsset<T>(
  contentHash: string,
  parse?: (value: unknown) => T,
): Promise<T | null> {
  try {
    const record = await db.assets.get(contentHash);
    if (!record) return null;
    return parse === undefined ? (record.value as T) : parse(record.value);
  } catch {
    return null;
  }
}

export async function writeCachedAsset(contentHash: string, value: unknown): Promise<void> {
  try {
    await db.assets.put({ key: contentHash, value, savedAt: Date.now() });
  } catch {
    // The cache is an optimization, never a hard dependency.
  }
}
