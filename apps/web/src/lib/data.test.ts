import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildManifest, buildPlayerSeason, buildPool } from '@hoop-rush/test-fixtures';
import type {
  FranchiseEraPool,
  HoopRushManifest,
  PlayersIndex,
  PoolIndexEntry,
} from '@hoop-rush/data-contracts';
import {
  contentHashSchema,
  eraIdSchema,
  franchiseIdSchema,
  playerIdSchema,
  seasonKeySchema,
} from '@hoop-rush/data-contracts';
import {
  getPool,
  getPlayersIndex,
  clearDataLoaderCaches,
  getManifest,
  warmPlayersIndex,
} from './data';
import { readCachedAsset, readCachedPool, writeCachedAsset, writeCachedPool } from './pool-cache';
vi.mock('./pool-cache', () => ({
  readCachedPool: vi.fn(() => Promise.resolve(null)),
  writeCachedPool: vi.fn(() => Promise.resolve()),
  readCachedAsset: vi.fn(() => Promise.resolve(null)),
  writeCachedAsset: vi.fn(() => Promise.resolve()),
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
    vi.mocked(readCachedAsset).mockResolvedValue(null);
    vi.mocked(writeCachedAsset).mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  it.each([
    {
      playerId: 'pacers-2000s-a',
      franchiseId: 'pacers',
      eraId: '2000s',
      url: 'pools/pacers-2000s.json',
      staleManifestRefresh: true,
    },
    {
      playerId: 'bulls-1990s-a',
      franchiseId: 'bulls',
      eraId: '1990s',
      url: 'pools/bulls-1990s.json',
      staleManifestRefresh: false,
    },
  ])(
    'recovers a stale pool hash ($playerId, manifest refreshed: $staleManifestRefresh)',
    async ({ playerId, franchiseId, eraId, url, staleManifestRefresh }) => {
      const player = buildPlayerSeason({ playerId: playerIdSchema.parse(playerId) });
      const poolV1 = buildPool([player], {
        franchiseId: franchiseIdSchema.parse(franchiseId),
        eraId: eraIdSchema.parse(eraId),
      });
      const poolV2 = buildPool([player], {
        franchiseId: franchiseIdSchema.parse(franchiseId),
        eraId: eraIdSchema.parse(eraId),
        dataVersion: 'data-v2',
      });
      const staleEntry: PoolIndexEntry = {
        franchiseId: franchiseIdSchema.parse(franchiseId),
        eraId: eraIdSchema.parse(eraId),
        url,
        contentHash: contentHashSchema.parse(sha256(JSON.stringify(poolV1))),
      };
      const freshHash = sha256(JSON.stringify(poolV2));
      const staleManifest: HoopRushManifest = buildManifest({ pools: [staleEntry] });
      const freshManifest: HoopRushManifest = buildManifest({
        dataVersion: 'data-v2',
        pools: [{ ...staleEntry, contentHash: contentHashSchema.parse(freshHash) }],
      });
      routes.set(`/data/${url}`, JSON.stringify(poolV2));
      routes.set('/data/manifest.json', JSON.stringify(staleManifest));
      await getManifest();
      if (staleManifestRefresh) {
        routes.set('/data/manifest.json', JSON.stringify(freshManifest));
      }
      const pool = await getPool(staleEntry);
      expect(pool.dataVersion).toBe('data-v2');
      expect(writeCachedPool).toHaveBeenCalledWith(`${franchiseId}/${eraId}`, freshHash, poolV2);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    },
  );
  it('does not retry when a pool load fails for a non-hash reason', async () => {
    const player = buildPlayerSeason({ playerId: playerIdSchema.parse('lakers-1990s-a') });
    const pool = buildPool([player], {
      franchiseId: franchiseIdSchema.parse('lakers'),
      eraId: eraIdSchema.parse('1990s'),
    });
    const entry: PoolIndexEntry = {
      franchiseId: franchiseIdSchema.parse('lakers'),
      eraId: eraIdSchema.parse('1990s'),
      url: 'pools/lakers-1990s.json',
      contentHash: contentHashSchema.parse(sha256(JSON.stringify(pool))),
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
    const player = buildPlayerSeason({ playerId: playerIdSchema.parse('knicks-2000s-a') });
    const pool = buildPool([player], {
      franchiseId: franchiseIdSchema.parse('knicks'),
      eraId: eraIdSchema.parse('2000s'),
    });
    const entry: PoolIndexEntry = {
      franchiseId: franchiseIdSchema.parse('knicks'),
      eraId: eraIdSchema.parse('2000s'),
      url: 'pools/knicks-2000s.json',
      contentHash: contentHashSchema.parse(sha256(JSON.stringify(pool))),
    };
    const manifest: HoopRushManifest = buildManifest({
      pools: [
        {
          franchiseId: franchiseIdSchema.parse('knicks'),
          eraId: eraIdSchema.parse('2000s'),
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
    const player = buildPlayerSeason({ playerId: playerIdSchema.parse('celtics-1990s-a') });
    const pool = buildPool([player], {
      franchiseId: franchiseIdSchema.parse('celtics'),
      eraId: eraIdSchema.parse('1990s'),
    });
    const entry: PoolIndexEntry = {
      franchiseId: franchiseIdSchema.parse('celtics'),
      eraId: eraIdSchema.parse('1990s'),
      url: 'pools/celtics-1990s.json',
      contentHash: contentHashSchema.parse(sha256(JSON.stringify(pool))),
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
describe('warmPlayersIndex', () => {
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
    vi.mocked(readCachedAsset).mockResolvedValue(null);
    vi.mocked(writeCachedAsset).mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  it('is a no-op when there is no window', () => {
    expect(() => {
      warmPlayersIndex();
    }).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('starts loading the players index without awaiting the caller', async () => {
    const index: PlayersIndex = {
      schemaVersion: 4,
      dataVersion: 'data-v1',
      players: [
        {
          playerId: playerIdSchema.parse('lakers-1990s-a'),
          franchiseId: franchiseIdSchema.parse('lakers'),
          eraId: eraIdSchema.parse('1990s'),
          seasonKey: seasonKeySchema.parse('1996-97'),
          firstName: 'Test',
          lastName: 'Player',
          displayName: 'Test Player',
          playerExternalId: '101',
          positionsPlayable: ['PG', 'SG'],
          overall: 92,
          offense: 95,
          defense: 80,
          selectionScore: 91.517,
        },
      ],
    };
    const indexHash = sha256(JSON.stringify(index));
    const manifest: HoopRushManifest = buildManifest({
      playersIndex: { url: 'players-index.json', contentHash: contentHashSchema.parse(indexHash) },
    });
    routes.set('/data/players-index.json', JSON.stringify(index));
    routes.set('/data/manifest.json', JSON.stringify(manifest));
    vi.stubGlobal('window', {});
    warmPlayersIndex();
    await vi.waitFor(() => {
      const urls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(urls.some((url) => /players-index\.json/.test(url))).toBe(true);
    });
    await expect(getPlayersIndex()).resolves.toEqual(index);
  });
  it('never throws when the underlying load fails', async () => {
    const manifest: HoopRushManifest = buildManifest({
      playersIndex: {
        url: 'players-index.json',
        contentHash: contentHashSchema.parse(sha256(JSON.stringify('junk'))),
      },
    });
    routes.set('/data/manifest.json', JSON.stringify(manifest));
    routes.set('/data/players-index.json', 'not json');
    vi.stubGlobal('window', {});
    expect(() => {
      warmPlayersIndex();
    }).not.toThrow();
    await vi.waitFor(() => {
      const urls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(urls.some((url) => /players-index\.json/.test(url))).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(getPlayersIndex()).rejects.toThrow();
  });
  it('serves the players index from the asset cache when the hash still matches', async () => {
    const index: PlayersIndex = {
      schemaVersion: 4,
      dataVersion: 'data-v1',
      players: [
        {
          playerId: playerIdSchema.parse('lakers-1990s-a'),
          franchiseId: franchiseIdSchema.parse('lakers'),
          eraId: eraIdSchema.parse('1990s'),
          seasonKey: seasonKeySchema.parse('1996-97'),
          firstName: 'Test',
          lastName: 'Player',
          displayName: 'Test Player',
          playerExternalId: '101',
          positionsPlayable: ['PG', 'SG'],
          overall: 92,
          offense: 95,
          defense: 80,
          selectionScore: 91.517,
        },
      ],
    };
    const indexHash = sha256(JSON.stringify(index));
    const manifest: HoopRushManifest = buildManifest({
      playersIndex: { url: 'players-index.json', contentHash: contentHashSchema.parse(indexHash) },
    });
    routes.set('/data/manifest.json', JSON.stringify(manifest));
    vi.mocked(readCachedAsset).mockResolvedValue(index);
    const result = await getPlayersIndex();
    expect(result).toBe(index);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
