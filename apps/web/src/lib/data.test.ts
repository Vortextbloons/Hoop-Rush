import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildManifest, buildPlayerSeason, buildPool } from '@hoop-rush/test-fixtures';
import type {
  FranchiseEraPool,
  HoopRushManifest,
  PoolIndexEntry,
} from '@hoop-rush/data-contracts';
import { getPool, clearDataLoaderCaches, getManifest } from './data';
import { readCachedPool, writeCachedPool } from './pool-cache';

vi.mock('./pool-cache', () => ({
  readCachedPool: vi.fn(() => Promise.resolve(null)),
  writeCachedPool: vi.fn(() => Promise.resolve()),
}));

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function response(body: string): Response {
  return new Response(body, { status: 200 });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.toString() : input.url;
}

describe('data asset loading with a stale manifest', () => {
  let routes: Map<string, string>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearDataLoaderCaches();
    routes = new Map();
    fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      const normalized = url.replace(/[?&]v=\d+/, '').replace(/\?$/, '');
      const body = routes.get(url) ?? routes.get(normalized);
      if (body === undefined) throw new Error(`unexpected fetch: ${url}`);
      return response(body);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(readCachedPool).mockResolvedValue(null);
    vi.mocked(writeCachedPool).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('recovers when a pool file was regenerated after the manifest was loaded', async () => {
    const player = buildPlayerSeason({ playerId: 'pacers-2000s-a' });
    const poolV1 = buildPool([player], { franchiseId: 'pacers', eraId: '2000s' });
    const poolV2 = buildPool([player], {
      franchiseId: 'pacers',
      eraId: '2000s',
      dataVersion: 'data-v2',
    });
    const staleEntry: PoolIndexEntry = {
      franchiseId: 'pacers',
      eraId: '2000s',
      url: 'pools/pacers-2000s.json',
      contentHash: sha256(JSON.stringify(poolV1)),
    };
    const freshHash = sha256(JSON.stringify(poolV2));
    const staleManifest: HoopRushManifest = buildManifest({
      pools: [staleEntry],
    });
    const freshManifest: HoopRushManifest = buildManifest({
      dataVersion: 'data-v2',
      pools: [{ ...staleEntry, contentHash: freshHash }],
    });

    routes.set('/data/pools/pacers-2000s.json', JSON.stringify(poolV2));
    routes.set('/data/manifest.json', JSON.stringify(staleManifest));
    await getManifest();

    routes.set('/data/manifest.json', JSON.stringify(freshManifest));

    const pool = await getPool(staleEntry);

    expect(pool.dataVersion).toBe('data-v2');
    expect(writeCachedPool).toHaveBeenCalledWith('pacers/2000s', freshHash, poolV2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('recovers when the manifest fetch is still cached but the pool bytes changed', async () => {
    const player = buildPlayerSeason({ playerId: 'bulls-1990s-a' });
    const poolV1 = buildPool([player], { franchiseId: 'bulls', eraId: '1990s' });
    const poolV2 = buildPool([player], {
      franchiseId: 'bulls',
      eraId: '1990s',
      dataVersion: 'data-v2',
    });
    const staleEntry: PoolIndexEntry = {
      franchiseId: 'bulls',
      eraId: '1990s',
      url: 'pools/bulls-1990s.json',
      contentHash: sha256(JSON.stringify(poolV1)),
    };
    const freshHash = sha256(JSON.stringify(poolV2));
    const staleManifest: HoopRushManifest = buildManifest({
      pools: [staleEntry],
    });

    routes.set('/data/pools/bulls-1990s.json', JSON.stringify(poolV2));
    routes.set('/data/manifest.json', JSON.stringify(staleManifest));
    await getManifest();

    const pool = await getPool(staleEntry);

    expect(pool.dataVersion).toBe('data-v2');
    expect(writeCachedPool).toHaveBeenCalledWith('bulls/1990s', freshHash, poolV2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not retry when a pool load fails for a non-hash reason', async () => {
    const player = buildPlayerSeason({ playerId: 'lakers-1990s-a' });
    const pool = buildPool([player], { franchiseId: 'lakers', eraId: '1990s' });
    const entry: PoolIndexEntry = {
      franchiseId: 'lakers',
      eraId: '1990s',
      url: 'pools/lakers-1990s.json',
      contentHash: sha256(JSON.stringify(pool)),
    };
    routes.set('/data/manifest.json', JSON.stringify(buildManifest({ pools: [entry] })));
    routes.set('/data/pools/lakers-1990s.json', '');
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      const normalized = url.replace(/[?&]v=\d+/, '').replace(/\?$/, '');
      if (normalized === '/data/pools/lakers-1990s.json') {
        return Promise.resolve(new Response('server error', { status: 500 }));
      }
      const body = routes.get(url) ?? routes.get(normalized);
      if (body === undefined) throw new Error(`unexpected fetch: ${url}`);
      return response(body);
    });

    await expect(getPool(entry)).rejects.toThrow(/pool request failed: 500/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails when packaged pool bytes cannot be parsed after hash recovery', async () => {
    const player = buildPlayerSeason({ playerId: 'knicks-2000s-a' });
    const pool = buildPool([player], { franchiseId: 'knicks', eraId: '2000s' });
    const entry: PoolIndexEntry = {
      franchiseId: 'knicks',
      eraId: '2000s',
      url: 'pools/knicks-2000s.json',
      contentHash: sha256(JSON.stringify(pool)),
    };
    const manifest: HoopRushManifest = buildManifest({
      pools: [
        {
          franchiseId: 'knicks',
          eraId: '2000s',
          url: 'pools/knicks-2000s.json',
          contentHash: entry.contentHash,
        },
      ],
    });
    routes.set('/data/pools/knicks-2000s.json', '{"schemaVersion":1');
    routes.set('/data/manifest.json', JSON.stringify(manifest));
    await getManifest();

    await expect(getPool(entry)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('serves a pool from the IndexedDB cache when the hash still matches', async () => {
    const player = buildPlayerSeason({ playerId: 'celtics-1990s-a' });
    const pool = buildPool([player], { franchiseId: 'celtics', eraId: '1990s' });
    const entry: PoolIndexEntry = {
      franchiseId: 'celtics',
      eraId: '1990s',
      url: 'pools/celtics-1990s.json',
      contentHash: sha256(JSON.stringify(pool)),
    };
    const manifest: HoopRushManifest = buildManifest({
      pools: [entry],
    });
    routes.set('/data/manifest.json', JSON.stringify(manifest));
    vi.mocked(readCachedPool).mockResolvedValue(pool);

    const result: FranchiseEraPool = await getPool(entry);

    expect(result).toBe(pool);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
