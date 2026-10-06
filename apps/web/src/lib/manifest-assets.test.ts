import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HoopRushManifest } from '@hoop-rush/data-contracts';
import type { ManifestAssetEntry, ManifestAssetOptions } from './manifest-assets';

type JsonResponse = { value: unknown } | { error: Error };

const state = vi.hoisted(() => ({
  manifests: [] as unknown[],
  manifestUrls: [] as string[],
  jsonLoads: [] as { url: string; label: string; expectedHash: string | undefined }[],
  jsonResponses: [] as JsonResponse[],
  cached: new Map<string, unknown>(),
  readHashes: [] as string[],
  writes: [] as { hash: string; value: unknown }[],
}));

let manifestAssets: typeof import('./manifest-assets');

beforeEach(async () => {
  vi.resetModules();
  vi.doMock('@hoop-rush/data-contracts', () => ({
    loadManifest: (url: string): Promise<unknown> => {
      state.manifestUrls.push(url);
      const manifest = state.manifests.shift();
      if (manifest === undefined) return Promise.reject(new Error('no manifest queued'));
      return Promise.resolve(manifest);
    },
    loadJsonAsset: (
      url: string,
      options: { label: string; expectedHash?: string; parse: (value: unknown) => unknown },
    ): Promise<unknown> => {
      state.jsonLoads.push({ url, label: options.label, expectedHash: options.expectedHash });
      const response = state.jsonResponses.shift();
      if (!response) return Promise.reject(new Error('no json response queued'));
      if ('error' in response) return Promise.reject(response.error);
      return Promise.resolve(options.parse(response.value));
    },
  }));

  vi.doMock('./pool-cache', () => ({
    readCachedAsset: <T>(contentHash: string, parse: (value: unknown) => T): Promise<T | null> => {
      state.readHashes.push(contentHash);
      if (!state.cached.has(contentHash)) return Promise.resolve(null);
      return Promise.resolve(parse(state.cached.get(contentHash)));
    },
    writeCachedAsset: (contentHash: string, value: unknown): Promise<void> => {
      state.writes.push({ hash: contentHash, value });
      state.cached.set(contentHash, value);
      return Promise.resolve();
    },
  }));

  vi.doMock('./asset-url', () => ({
    resolveAssetUrl: (url: string): string => `resolved/${url}`,
  }));

  manifestAssets = await import('./manifest-assets');
});

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

interface TestValue {
  ok: boolean;
}

function parseTestValue(value: unknown): TestValue {
  return value as TestValue;
}

function findBracket(manifest: HoopRushManifest): ManifestAssetEntry | null {
  return manifest.bracket ?? null;
}

function entry(url: string, contentHash: string): ManifestAssetEntry {
  return { url, contentHash };
}

function mismatchError(expected: string): Error {
  return new Error(`content hash mismatch: expected ${expected}, got ${HASH_C}`);
}

function testOptions(
  overrides: Partial<ManifestAssetOptions<TestValue>> = {},
): ManifestAssetOptions<TestValue> {
  return {
    key: 'test/asset',
    label: 'test asset',
    parse: parseTestValue,
    find: findBracket,
    missingMessage: 'test asset missing',
    ...overrides,
  };
}

describe('loadManifestAsset', () => {
  beforeEach(() => {
    state.manifests.length = 0;
    state.manifestUrls.length = 0;
    state.jsonLoads.length = 0;
    state.jsonResponses.length = 0;
    state.readHashes.length = 0;
    state.cached.clear();
    state.writes.length = 0;
    manifestAssets.clearManifestCache();
    manifestAssets.clearManifestAssetCaches();
  });

  it('memoizes loads by key', async () => {
    state.manifests.push({ bracket: entry('bracket.json', HASH_A) });
    state.jsonResponses.push({ value: { ok: true } });
    const first = manifestAssets.loadManifestAsset(testOptions());
    const second = manifestAssets.loadManifestAsset(testOptions());
    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ ok: true });
    expect(state.manifestUrls).toHaveLength(1);
    expect(state.readHashes).toEqual([HASH_A]);
    expect(state.jsonLoads).toHaveLength(1);
  });

  it('returns a cached asset without fetching when the content hash matches', async () => {
    state.cached.set(HASH_A, { ok: true });
    const result = await manifestAssets.loadManifestAsset(
      testOptions({ key: 'test/cache-hit', entry: entry('cached.json', HASH_A) }),
    );
    expect(result).toEqual({ ok: true });
    expect(state.manifestUrls).toHaveLength(0);
    expect(state.readHashes).toEqual([HASH_A]);
    expect(state.jsonLoads).toHaveLength(0);
    expect(state.writes).toHaveLength(0);
  });

  it('fetches, verifies, and caches on a cache miss', async () => {
    state.jsonResponses.push({ value: { ok: true } });
    const result = await manifestAssets.loadManifestAsset(
      testOptions({ key: 'test/cache-miss', entry: entry('fresh.json', HASH_A) }),
    );
    expect(result).toEqual({ ok: true });
    expect(state.jsonLoads).toEqual([
      { url: 'resolved/fresh.json', label: 'test asset', expectedHash: HASH_A },
    ]);
    expect(state.writes).toEqual([{ hash: HASH_A, value: { ok: true } }]);
  });

  it('throws the missing message when a required artifact is absent', async () => {
    state.manifests.push({});
    await expect(
      manifestAssets.loadManifestAsset(testOptions({ key: 'test/missing' })),
    ).rejects.toThrow('test asset missing');
    expect(state.jsonLoads).toHaveLength(0);
  });

  it('resolves null for an optional artifact that the manifest omits', async () => {
    state.manifests.push({});
    const result = await manifestAssets.loadManifestAsset(
      testOptions({ key: 'test/optional', optional: true }),
    );
    expect(result).toBeNull();
    expect(state.jsonLoads).toHaveLength(0);
  });

  it('retries against a fresh manifest when its content hash differs', async () => {
    state.jsonResponses.push({ error: mismatchError(HASH_A) }, { value: { ok: true } });
    state.manifests.push({ bracket: entry('bracket-v2.json', HASH_B) });
    const result = await manifestAssets.loadManifestAsset(
      testOptions({
        key: 'test/retry',
        entry: entry('bracket.json', HASH_A),
        retryOnHashMismatch: true,
      }),
    );
    expect(result).toEqual({ ok: true });
    expect(state.manifestUrls).toHaveLength(1);
    expect(state.manifestUrls[0] ?? '').toMatch(/^resolved\/manifest\.json\?v=\d+$/);
    expect(state.jsonLoads).toHaveLength(2);
    expect(state.jsonLoads[0]).toEqual({
      url: 'resolved/bracket.json',
      label: 'test asset',
      expectedHash: HASH_A,
    });
    expect(state.jsonLoads[1]?.expectedHash).toBe(HASH_B);
    expect(state.jsonLoads[1]?.url ?? '').toMatch(/^resolved\/bracket-v2\.json\?v=\d+$/);
    expect(state.writes).toEqual([{ hash: HASH_B, value: { ok: true } }]);
  });

  it('keeps the original mismatch when the fresh manifest reuses the hash', async () => {
    const original = mismatchError(HASH_A);
    state.jsonResponses.push({ error: original });
    state.manifests.push({ bracket: entry('bracket.json', HASH_A) });
    const promise = manifestAssets.loadManifestAsset(
      testOptions({
        key: 'test/retry-same-hash',
        entry: entry('bracket.json', HASH_A),
        retryOnHashMismatch: true,
      }),
    );
    await expect(promise).rejects.toBe(original);
    expect(state.manifestUrls).toHaveLength(1);
    expect(state.jsonLoads).toHaveLength(1);
    expect(state.writes).toHaveLength(0);
  });

  it('retries unconditionally in always mode even when the fresh manifest reuses the hash', async () => {
    state.jsonResponses.push({ error: mismatchError(HASH_A) }, { value: { ok: true } });
    state.manifests.push({ bracket: entry('bracket.json', HASH_A) });
    const result = await manifestAssets.loadManifestAsset(
      testOptions({
        key: 'test/retry-always',
        entry: entry('bracket.json', HASH_A),
        retryOnHashMismatch: 'always',
      }),
    );
    expect(result).toEqual({ ok: true });
    expect(state.manifestUrls).toHaveLength(1);
    expect(state.manifestUrls[0] ?? '').toMatch(/^resolved\/manifest\.json\?v=\d+$/);
    expect(state.jsonLoads).toHaveLength(2);
    expect(state.jsonLoads[0]?.expectedHash).toBe(HASH_A);
    expect(state.jsonLoads[1]?.expectedHash).toBe(HASH_A);
    expect(state.jsonLoads[1]?.url ?? '').toMatch(/^resolved\/bracket\.json\?v=\d+$/);
    expect(state.writes).toEqual([{ hash: HASH_A, value: { ok: true } }]);
  });

  it('returns a fresh-hash cache hit in always mode without fetching', async () => {
    state.jsonResponses.push({ error: mismatchError(HASH_A) });
    state.manifests.push({ bracket: entry('bracket-v2.json', HASH_B) });
    state.cached.set(HASH_B, { ok: true });
    const result = await manifestAssets.loadManifestAsset(
      testOptions({
        key: 'test/retry-always-cached',
        entry: entry('bracket.json', HASH_A),
        retryOnHashMismatch: 'always',
      }),
    );
    expect(result).toEqual({ ok: true });
    expect(state.readHashes).toEqual([HASH_A, HASH_B]);
    expect(state.jsonLoads).toHaveLength(1);
    expect(state.writes).toHaveLength(0);
  });

  it('reports the missing message in always mode when the fresh manifest omits the entry', async () => {
    state.jsonResponses.push({ error: mismatchError(HASH_A) });
    state.manifests.push({});
    const promise = manifestAssets.loadManifestAsset(
      testOptions({
        key: 'test/retry-always-missing',
        entry: entry('bracket.json', HASH_A),
        retryOnHashMismatch: 'always',
      }),
    );
    await expect(promise).rejects.toThrow('test asset missing');
    expect(state.manifestUrls).toHaveLength(1);
    expect(state.jsonLoads).toHaveLength(1);
    expect(state.writes).toHaveLength(0);
  });

  it('does not refresh the manifest for unrelated failures in always mode', async () => {
    state.jsonResponses.push({ error: new Error('network down') });
    await expect(
      manifestAssets.loadManifestAsset(
        testOptions({
          key: 'test/always-other-error',
          entry: entry('bracket.json', HASH_A),
          retryOnHashMismatch: 'always',
        }),
      ),
    ).rejects.toThrow('network down');
    expect(state.manifestUrls).toHaveLength(0);
    expect(state.jsonLoads).toHaveLength(1);
  });

  it('does not refresh the manifest for unrelated failures', async () => {
    state.jsonResponses.push({ error: new Error('network down') });
    await expect(
      manifestAssets.loadManifestAsset(
        testOptions({
          key: 'test/other-error',
          entry: entry('bracket.json', HASH_A),
          retryOnHashMismatch: true,
        }),
      ),
    ).rejects.toThrow('network down');
    expect(state.manifestUrls).toHaveLength(0);
    expect(state.jsonLoads).toHaveLength(1);
  });
});

describe('isContentHashMismatch', () => {
  it('matches only the loader mismatch message', () => {
    expect(manifestAssets.isContentHashMismatch(mismatchError(HASH_A))).toBe(true);
    expect(manifestAssets.isContentHashMismatch(new Error('content hash mismatch'))).toBe(false);
    expect(
      manifestAssets.isContentHashMismatch(
        new Error(`content hash mismatch: expected ${HASH_A}, got short`),
      ),
    ).toBe(false);
    expect(manifestAssets.isContentHashMismatch('content hash mismatch')).toBe(false);
  });
});
