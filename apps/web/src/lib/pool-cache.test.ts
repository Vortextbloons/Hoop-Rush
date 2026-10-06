import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

type FakeRecord = { key: string; savedAt: number } & Record<string, unknown>;

const stores = vi.hoisted(() => ({
  pools: new Map<string, FakeRecord>(),
  assets: new Map<string, FakeRecord>(),
}));

let poolCache: typeof import('./pool-cache');

beforeEach(async () => {
  vi.resetModules();
  vi.doMock('dexie', () => {
    class FakeTable {
      constructor(private readonly store: Map<string, FakeRecord>) {}
      get(key: string): Promise<unknown> {
        return Promise.resolve(this.store.get(key));
      }
      put(value: FakeRecord): Promise<void> {
        this.store.set(value.key, value);
        return Promise.resolve();
      }
      count(): Promise<number> {
        return Promise.resolve(this.store.size);
      }
      orderBy() {
        const store = this.store;
        return {
          limit(n: number) {
            return {
              primaryKeys(): Promise<string[]> {
                const keys = [...store.entries()]
                  .sort((a, b) => a[1].savedAt - b[1].savedAt)
                  .slice(0, n)
                  .map(([key]) => key);
                return Promise.resolve(keys);
              },
            };
          },
        };
      }
      bulkDelete(keys: string[]): Promise<void> {
        for (const key of keys) this.store.delete(key);
        return Promise.resolve();
      }
    }
    class FakeDexie {
      pools = new FakeTable(stores.pools);
      assets = new FakeTable(stores.assets);
      version(): { stores(): void } {
        return { stores(): void {} };
      }
    }
    return { default: FakeDexie };
  });
  poolCache = await import('./pool-cache');
});

describe('pool-cache eviction', () => {
  it('caps pools and assets at the documented maxima', async () => {
    expect(poolCache.POOL_CACHE_MAX_POOLS).toBe(60);
    expect(poolCache.POOL_CACHE_MAX_ASSETS).toBe(24);
    stores.pools.clear();
    stores.assets.clear();

    let now = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      now += 1;
      return now;
    });
    try {
      for (let i = 0; i < poolCache.POOL_CACHE_MAX_POOLS + 5; i += 1) {
        await poolCache.writeCachedPool(`pool-${String(i)}`, `hash-${String(i)}`, {
          marker: i,
        } as never);
      }
      expect(stores.pools.size).toBe(poolCache.POOL_CACHE_MAX_POOLS);
      expect(stores.pools.has('pool-0')).toBe(false);
      expect(stores.pools.has(`pool-${String(poolCache.POOL_CACHE_MAX_POOLS + 4)}`)).toBe(true);

      for (let i = 0; i < poolCache.POOL_CACHE_MAX_ASSETS + 5; i += 1) {
        await poolCache.writeCachedAsset(`asset-${String(i)}`, { n: i });
      }
      expect(stores.assets.size).toBe(poolCache.POOL_CACHE_MAX_ASSETS);
      expect(stores.assets.has('asset-0')).toBe(false);
      expect(stores.assets.has(`asset-${String(poolCache.POOL_CACHE_MAX_ASSETS + 4)}`)).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('requires a Zod parse and rejects tampered asset values', async () => {
    stores.assets.clear();
    const schema = z.object({ n: z.number().int().nonnegative() });
    await poolCache.writeCachedAsset('tampered', { n: -1 });
    await expect(
      poolCache.readCachedAsset('tampered', (value) => schema.parse(value)),
    ).resolves.toBeNull();
    await poolCache.writeCachedAsset('valid', { n: 3 });
    await expect(
      poolCache.readCachedAsset('valid', (value) => schema.parse(value)),
    ).resolves.toEqual({
      n: 3,
    });
    await expect(
      poolCache.readCachedAsset('missing', (value) => schema.parse(value)),
    ).resolves.toBeNull();
  });
});
