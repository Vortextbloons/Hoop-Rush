import Dexie, { type EntityTable } from 'dexie';
import { franchiseEraPoolSchema, type FranchiseEraPool } from '@hoop-rush/data-contracts';
import { isLiteMode } from './device-capabilities';
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
const POOL_CACHE_MAX_POOLS_DEFAULT = 60;
const POOL_CACHE_MAX_POOLS_LITE = 10;
const POOL_CACHE_MAX_ASSETS_DEFAULT = 24;
const POOL_CACHE_MAX_ASSETS_LITE = 8;
export function poolCacheMaxPools(): number {
  return isLiteMode() ? POOL_CACHE_MAX_POOLS_LITE : POOL_CACHE_MAX_POOLS_DEFAULT;
}
export function poolCacheMaxAssets(): number {
  return isLiteMode() ? POOL_CACHE_MAX_ASSETS_LITE : POOL_CACHE_MAX_ASSETS_DEFAULT;
}
type HoopRushCacheDb = Dexie & {
  pools: EntityTable<CachedPoolRecord, 'key'>;
  assets: EntityTable<CachedAssetRecord, 'key'>;
};
let dbInstance: HoopRushCacheDb | null = null;
const parsedPoolCache = new Map<string, { hash: string; pool: FranchiseEraPool }>();
const PARSED_POOL_CACHE_MAX = 16;
function rememberParsedPool(key: string, hash: string, pool: FranchiseEraPool): void {
  parsedPoolCache.delete(key);
  parsedPoolCache.set(key, { hash, pool });
  while (parsedPoolCache.size > PARSED_POOL_CACHE_MAX) {
    const oldest = parsedPoolCache.keys().next().value;
    if (oldest === undefined) break;
    parsedPoolCache.delete(oldest);
  }
}
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
    const remembered = parsedPoolCache.get(key);
    if (remembered && remembered.hash === expectedHash) {
      parsedPoolCache.delete(key);
      parsedPoolCache.set(key, remembered);
      return remembered.pool;
    }
    const pool = franchiseEraPoolSchema.parse(record.pool);
    rememberParsedPool(key, expectedHash, pool);
    return pool;
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
    rememberParsedPool(key, contentHash, pool);
    const count = await db.pools.count();
    const max = poolCacheMaxPools();
    if (count > max) {
      const excess = count - max;
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
    const max = poolCacheMaxAssets();
    if (count > max) {
      const excess = count - max;
      const victims = await db.assets.orderBy('savedAt').limit(excess).primaryKeys();
      if (victims.length > 0) await db.assets.bulkDelete(victims);
    }
  } catch (error) {
    console.warn('[pool-cache] writeCachedAsset failed', error);
  }
}
