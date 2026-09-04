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
export async function readCachedPool(key: string, expectedHash: string): Promise<FranchiseEraPool | null> {
    try {
        const record = await db.pools.get(key);
        if (!record)
            return null;
        if (record.contentHash !== expectedHash) {
            console.warn(`[pool-cache] hash mismatch for ${key}: expected ${expectedHash}, got ${record.contentHash}`);
            return null;
        }
        return franchiseEraPoolSchema.parse(record.pool);
    }
    catch (error) {
        console.warn('[pool-cache] readCachedPool failed', error);
        return null;
    }
}
export async function writeCachedPool(key: string, contentHash: string, pool: FranchiseEraPool): Promise<void> {
    try {
        await db.pools.put({ key, contentHash, pool, savedAt: Date.now() });
    }
    catch (error) {
        console.warn('[pool-cache] writeCachedPool failed', error);
    }
}
export async function readCachedAsset<T>(contentHash: string, parse?: (value: unknown) => T): Promise<T | null> {
    try {
        const record = await db.assets.get(contentHash);
        if (!record)
            return null;
        return parse === undefined ? (record.value as T) : parse(record.value);
    }
    catch (error) {
        console.warn('[pool-cache] readCachedAsset failed', error);
        return null;
    }
}
export async function writeCachedAsset(contentHash: string, value: unknown): Promise<void> {
    try {
        await db.assets.put({ key: contentHash, value, savedAt: Date.now() });
    }
    catch (error) {
        console.warn('[pool-cache] writeCachedAsset failed', error);
    }
}
