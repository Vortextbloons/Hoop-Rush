import {
  loadManifest,
  loadPool,
  type HoopRushManifest,
  type FranchiseEraPool,
  type PoolIndexEntry,
} from '@hoop-rush/data-contracts';

let manifestPromise: Promise<HoopRushManifest> | null = null;

function manifestUrl(): string {
  return `${import.meta.env.BASE_URL}data/manifest.json`;
}

/** Pool URLs are relative to the manifest directory (e.g. pools/lakers-1990s.json). */
function resolveAssetUrl(url: string): string {
  if (/^https?:\/\//.test(url) || url.startsWith('/')) return url;
  return `${import.meta.env.BASE_URL}data/${url}`;
}

/** Load (once) and validate the Hoop Rush manifest. */
export function getManifest(): Promise<HoopRushManifest> {
  if (!manifestPromise) {
    manifestPromise = loadManifest(manifestUrl());
  }
  return manifestPromise;
}

const poolCache = new Map<string, Promise<FranchiseEraPool>>();

/** Load, hash-verify, and validate a franchise-era pool asset. */
export function getPool(entry: PoolIndexEntry): Promise<FranchiseEraPool> {
  const key = `${entry.franchiseId}/${entry.eraId}`;
  let promise = poolCache.get(key);
  if (!promise) {
    promise = loadPool(resolveAssetUrl(entry.url), entry.contentHash);
    poolCache.set(key, promise);
  }
  return promise;
}
