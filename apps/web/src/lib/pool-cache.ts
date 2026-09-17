import Dexie, { type EntityTable } from 'dexie';
import { franchiseEraPoolSchema, type FranchiseEraPool } from '@hoop-rush/data-contracts';
interface CachedPoolRecord {
  key: string;
  contentHash: string;
  pool: FranchiseEraPool;
  savedAt: number;
}
interface CachedAssetRecord {
  key: string;
  value: unknown;
  savedAt: number;
}
export const POOL_CACHE_MAX_POOLS = 60;
export const POOL_CACHE_MAX_ASSETS = 24;
type HoopRushCacheDb = Dexie & {
  pools: EntityTable<CachedPoolRecord, 'key'>;
  assets: EntityTable<CachedAssetRecord, 'key'>;
};
let dbInstance: HoopRushCacheDb | null = null;
function getDb(): HoopRushCacheDb {
  if (!dbInstance) {
    const db = new Dexie('hoop-rush') as HoopRushCacheDb;
    db.version(1).stores({
      pools: 'key',
    });
    db.version(2).stores({
      pools: 'key',
      assets: 'key',
    });
    db.version(3).stores({
      pools: 'key, savedAt',
      assets: 'key, savedAt',
    });
    dbInstance = db;
  }
  return dbInstance;
}
export async function readCachedPool(
  key: string,
  expectedHash: string,
): Promise<FranchiseEraPool | null> {
  try {
    const record = await getDb().pools.get(key);
    if (!record) return null;
    if (record.contentHash !== expectedHash) {
      console.warn(
        `[pool-cache] hash mismatch for ${key}: expected ${expectedHash}, got ${record.contentHash}`,
      );
      return null;
    }
    return franchiseEraPoolSchema.parse(record.pool);
  } catch (error) {
    console.warn('[pool-cache] readCachedPool failed', error);
    return null;
  }
}
export async function writeCachedPool(
  key: string,
  contentHash: string,
  pool: FranchiseEraPool,
): Promise<void> {
  try {
    const db = getDb();
    await db.pools.put({ key, contentHash, pool, savedAt: Date.now() });
    const count = await db.pools.count();
    if (count > POOL_CACHE_MAX_POOLS) {
      const excess = count - POOL_CACHE_MAX_POOLS;
      const victims = await db.pools.orderBy('savedAt').limit(excess).primaryKeys();
      if (victims.length > 0) await db.pools.bulkDelete(victims);
    }
  } catch (error) {
    console.warn('[pool-cache] writeCachedPool failed', error);
  }
}
export async function readCachedAsset<T>(
  contentHash: string,
  parse: (value: unknown) => T,
): Promise<T | null> {
  try {
    const record = await getDb().assets.get(contentHash);
    if (!record) return null;
    return parse(record.value);
  } catch (error) {
    console.warn('[pool-cache] readCachedAsset failed', error);
    return null;
  }
}
export async function writeCachedAsset(contentHash: string, value: unknown): Promise<void> {
  try {
    const db = getDb();
    await db.assets.put({ key: contentHash, value, savedAt: Date.now() });
    const count = await db.assets.count();
    if (count > POOL_CACHE_MAX_ASSETS) {
      const excess = count - POOL_CACHE_MAX_ASSETS;
      const victims = await db.assets.orderBy('savedAt').limit(excess).primaryKeys();
      if (victims.length > 0) await db.assets.bulkDelete(victims);
    }
  } catch (error) {
    console.warn('[pool-cache] writeCachedAsset failed', error);
  }
}
