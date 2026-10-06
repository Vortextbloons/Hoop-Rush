import { loadJsonAsset, loadManifest, type HoopRushManifest } from '@hoop-rush/data-contracts';
import { resolveAssetUrl } from './asset-url';
import { readCachedAsset, writeCachedAsset } from './pool-cache';

export interface ManifestAssetEntry {
  url: string;
  contentHash: string;
}

export interface ManifestAssetOptions<T> {
  key: string;
  label: string;
  parse: (value: unknown) => T;
  find: (manifest: HoopRushManifest) => ManifestAssetEntry | null;
  missingMessage: string;
  entry?: ManifestAssetEntry;
  load?: (url: string, contentHash: string) => Promise<T>;
  retryOnHashMismatch?: boolean | 'always';
  optional?: boolean;
}

const CONTENT_HASH_MISMATCH = /content hash mismatch: expected ([0-9a-f]{64}), got ([0-9a-f]{64})/;
const manifestAssetCache = new Map<string, Promise<unknown>>();
let manifestPromise: Promise<HoopRushManifest> | null = null;

function manifestUrl(): string {
  return resolveAssetUrl('manifest.json');
}

function cacheBustedUrl(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${String(Date.now())}`;
}

export function getManifest(): Promise<HoopRushManifest> {
  if (!manifestPromise) {
    manifestPromise = loadManifest(manifestUrl());
    manifestPromise.catch(() => {
      manifestPromise = null;
    });
  }
  return manifestPromise;
}

export function reloadManifest(): Promise<HoopRushManifest> {
  manifestPromise = loadManifest(cacheBustedUrl(manifestUrl()));
  manifestPromise.catch(() => {
    manifestPromise = null;
  });
  return manifestPromise;
}

export function clearManifestCache(): void {
  manifestPromise = null;
}

export function isContentHashMismatch(error: unknown): boolean {
  return error instanceof Error && CONTENT_HASH_MISMATCH.test(error.message);
}

export function clearManifestAssetCaches(keyPrefix?: string): void {
  if (keyPrefix === undefined) {
    manifestAssetCache.clear();
    return;
  }
  for (const key of [...manifestAssetCache.keys()]) {
    if (key.startsWith(keyPrefix)) manifestAssetCache.delete(key);
  }
}

export async function retryWithFreshManifest<T>(
  original: unknown,
  expectedHash: string,
  find: (manifest: HoopRushManifest) => ManifestAssetEntry | null,
  load: (url: string, contentHash: string) => Promise<T>,
): Promise<T> {
  if (!isContentHashMismatch(original)) throw original;
  let fresh: HoopRushManifest;
  try {
    fresh = await reloadManifest();
  } catch {
    throw original;
  }
  const entry = find(fresh);
  if (!entry) throw original;
  if (entry.contentHash !== expectedHash) {
    return load(entry.url, entry.contentHash);
  }
  throw original;
}

async function loadVerified<T>(
  entry: ManifestAssetEntry,
  options: ManifestAssetOptions<T>,
  bustCache: boolean,
): Promise<T> {
  const url = bustCache ? cacheBustedUrl(resolveAssetUrl(entry.url)) : resolveAssetUrl(entry.url);
  const value = options.load
    ? await options.load(url, entry.contentHash)
    : await loadJsonAsset(url, {
        label: options.label,
        expectedHash: entry.contentHash,
        parse: options.parse,
      });
  void writeCachedAsset(entry.contentHash, value);
  return value;
}

async function retryWithFreshManifestAlways<T>(
  original: unknown,
  options: ManifestAssetOptions<T>,
): Promise<T> {
  if (!isContentHashMismatch(original)) throw original;
  await reloadManifest().catch(() => null);
  const manifest = await getManifest();
  const entry = options.find(manifest);
  if (!entry) throw new Error(options.missingMessage);
  const cached = await readCachedAsset(entry.contentHash, options.parse);
  if (cached !== null) return cached;
  return loadVerified(entry, options, true);
}

async function loadManifestAssetUncached<T>(options: ManifestAssetOptions<T>): Promise<T | null> {
  let entry = options.entry ?? null;
  if (!entry) {
    const manifest = await getManifest();
    entry = options.find(manifest);
  }
  if (!entry) {
    if (options.optional) return null;
    throw new Error(options.missingMessage);
  }
  const target = entry;
  const cached = await readCachedAsset(target.contentHash, options.parse);
  if (cached !== null) return cached;
  try {
    return await loadVerified(target, options, false);
  } catch (error) {
    if (options.retryOnHashMismatch === 'always') {
      return retryWithFreshManifestAlways(error, options);
    }
    if (!options.retryOnHashMismatch) throw error;
    return retryWithFreshManifest(error, target.contentHash, options.find, (url, contentHash) =>
      loadVerified({ url, contentHash }, options, true),
    );
  }
}

export function loadManifestAsset<T>(
  options: ManifestAssetOptions<T> & { optional: true },
): Promise<T | null>;
export function loadManifestAsset<T>(options: ManifestAssetOptions<T>): Promise<T>;
export function loadManifestAsset<T>(options: ManifestAssetOptions<T>): Promise<T | null> {
  const existing = manifestAssetCache.get(options.key) as Promise<T | null> | undefined;
  if (existing) return existing;
  const promise = loadManifestAssetUncached(options);
  manifestAssetCache.set(options.key, promise);
  promise.catch(() => {
    if (manifestAssetCache.get(options.key) === promise) manifestAssetCache.delete(options.key);
  });
  return promise;
}
