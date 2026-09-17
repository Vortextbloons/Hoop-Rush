import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

type FakeRecord = { key: string; savedAt: number } & Record<string, unknown>;

const stores = vi.hoisted(() => ({
  pools: new Map<string, FakeRecord>(),
  assets: new Map<string, FakeRecord>(),
}));

vi.mock('dexie', () => {
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

import {
  POOL_CACHE_MAX_ASSETS,
  POOL_CACHE_MAX_POOLS,
  readCachedAsset,
  writeCachedAsset,
  writeCachedPool,
} from './pool-cache';

describe('pool-cache eviction', () => {
  it('caps pools and assets at the documented maxima', async () => {
    expect(POOL_CACHE_MAX_POOLS).toBe(60);
    expect(POOL_CACHE_MAX_ASSETS).toBe(24);
    stores.pools.clear();
    stores.assets.clear();

    let now = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      now += 1;
      return now;
    });
    try {
      for (let i = 0; i < POOL_CACHE_MAX_POOLS + 5; i += 1) {
        await writeCachedPool(`pool-${String(i)}`, `hash-${String(i)}`, { marker: i } as never);
      }
      expect(stores.pools.size).toBe(POOL_CACHE_MAX_POOLS);
      expect(stores.pools.has('pool-0')).toBe(false);
      expect(stores.pools.has(`pool-${String(POOL_CACHE_MAX_POOLS + 4)}`)).toBe(true);

      for (let i = 0; i < POOL_CACHE_MAX_ASSETS + 5; i += 1) {
        await writeCachedAsset(`asset-${String(i)}`, { n: i });
      }
      expect(stores.assets.size).toBe(POOL_CACHE_MAX_ASSETS);
      expect(stores.assets.has('asset-0')).toBe(false);
      expect(stores.assets.has(`asset-${String(POOL_CACHE_MAX_ASSETS + 4)}`)).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('requires a Zod parse and rejects tampered asset values', async () => {
    stores.assets.clear();
    const schema = z.object({ n: z.number().int().nonnegative() });
    await writeCachedAsset('tampered', { n: -1 });
    await expect(readCachedAsset('tampered', (value) => schema.parse(value))).resolves.toBeNull();
    await writeCachedAsset('valid', { n: 3 });
    await expect(readCachedAsset('valid', (value) => schema.parse(value))).resolves.toEqual({
      n: 3,
    });
    await expect(readCachedAsset('missing', (value) => schema.parse(value))).resolves.toBeNull();
  });
});
