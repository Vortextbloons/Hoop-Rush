import {
  loadManifest,
  loadPool,
  loadEraSimulationProfile,
  loadOpponentBracket,
  type HoopRushManifest,
  type FranchiseEraPool,
  type PoolIndexEntry,
  type SimProfileIndexEntry,
  type OpponentIndexEntry,
  type EraSimulationProfile,
  type OpponentBracket,
} from '@hoop-rush/data-contracts';
import { readCachedPool, writeCachedPool } from './pool-cache';

let manifestPromise: Promise<HoopRushManifest> | null = null;

/**
 * Site root for packaged assets. The static build sets a relative base
 * (`./`), which would resolve nested routes like /sandbox/game to
 * /sandbox/data/...; assets always live at the site root.
 */
function siteRoot(): string {
  const base = import.meta.env.BASE_URL;
  return base.startsWith('/') ? base : '/';
}

function manifestUrl(): string {
  return `${siteRoot()}data/manifest.json`;
}

/** Pool URLs are relative to the manifest directory (e.g. pools/lakers-1990s.json). */
function resolveAssetUrl(url: string): string {
  if (/^https?:\/\//.test(url) || url.startsWith('/')) return url;
  return `${siteRoot()}data/${url}`;
}

/** Load (once) and validate the Hoop Rush manifest. */
export function getManifest(): Promise<HoopRushManifest> {
  if (!manifestPromise) {
    manifestPromise = loadManifest(manifestUrl(), { cache: 'no-cache' });
  }
  return manifestPromise;
}

const poolCache = new Map<string, Promise<FranchiseEraPool>>();

/** Load, hash-verify, and validate a franchise-era pool asset. */
export function getPool(entry: PoolIndexEntry): Promise<FranchiseEraPool> {
  const key = `${entry.franchiseId}/${entry.eraId}`;
  let promise = poolCache.get(key);
  if (!promise) {
    promise = loadPoolForEntry(entry, key);
    poolCache.set(key, promise);
    // A failed load must not poison the cache: the next request retries.
    promise.catch(() => {
      poolCache.delete(key);
    });
  }
  return promise;
}

async function loadPoolForEntry(entry: PoolIndexEntry, key: string): Promise<FranchiseEraPool> {
  const cached = await readCachedPool(key, entry.contentHash);
  if (cached) return cached;
  const pool = await loadPool(resolveAssetUrl(entry.url), entry.contentHash);
  void writeCachedPool(key, entry.contentHash, pool);
  return pool;
}

const profileCache = new Map<string, Promise<EraSimulationProfile>>();

/** Load, hash-verify, and validate an era simulation profile asset. */
export function getEraSimulationProfile(
  entry: SimProfileIndexEntry,
): Promise<EraSimulationProfile> {
  const key = entry.eraId;
  let promise = profileCache.get(key);
  if (!promise) {
    promise = loadEraSimulationProfile(resolveAssetUrl(entry.url), entry.contentHash);
    profileCache.set(key, promise);
    promise.catch(() => {
      profileCache.delete(key);
    });
  }
  return promise;
}

const bracketCache = new Map<string, Promise<OpponentBracket>>();

/** Load, hash-verify, and validate the frozen opponent bracket as a unit. */
export function getBracket(entry: OpponentIndexEntry): Promise<OpponentBracket> {
  const key = entry.url;
  let promise = bracketCache.get(key);
  if (!promise) {
    promise = loadOpponentBracket(resolveAssetUrl(entry.url), entry.contentHash);
    bracketCache.set(key, promise);
    promise.catch(() => {
      bracketCache.delete(key);
    });
  }
  return promise;
}
