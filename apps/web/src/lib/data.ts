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

const CONTENT_HASH_MISMATCH =
  /content hash mismatch: expected ([0-9a-f]{64}), got ([0-9a-f]{64})/;

/** Pool URLs are relative to the manifest directory (e.g. pools/lakers-1990s.json). */
function resolveAssetUrl(url: string): string {
  if (/^https?:\/\//.test(url) || url.startsWith('/')) return url;
  return `${siteRoot()}data/${url}`;
}

function cacheBustedUrl(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${Date.now()}`;
}

const manifestRequestInit: RequestInit = { cache: 'no-store' };

/** Load (once) and validate the Hoop Rush manifest. */
export function getManifest(): Promise<HoopRushManifest> {
  if (!manifestPromise) {
    manifestPromise = loadManifest(manifestUrl(), manifestRequestInit);
    // A failed load must not poison the cache: the next request retries.
    manifestPromise.catch(() => {
      manifestPromise = null;
    });
  }
  return manifestPromise;
}

/** Refetch the manifest from the server, replacing the memoized value. */
function reloadManifest(): Promise<HoopRushManifest> {
  manifestPromise = loadManifest(cacheBustedUrl(manifestUrl()), manifestRequestInit);
  manifestPromise.catch(() => {
    manifestPromise = null;
  });
  return manifestPromise;
}

/** True when a packaged asset failed its SHA-256 content-hash check. */
function isContentHashMismatch(error: unknown): boolean {
  return error instanceof Error && CONTENT_HASH_MISMATCH.test(error.message);
}

function parseObservedContentHash(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const match = error.message.match(CONTENT_HASH_MISMATCH);
  return match?.[2] ?? null;
}

/**
 * Recover from a stale-manifest mismatch: packaged assets were regenerated
 * after this page loaded, so refresh the manifest and retry the asset once
 * against the freshly published content hash. When the manifest fetch is still
 * cached, retry against the hash observed from the fetched bytes.
 */
async function retryWithFreshManifest<T>(
  original: unknown,
  expectedHash: string,
  findEntry: (manifest: HoopRushManifest) => { url: string; contentHash: string } | null,
  load: (url: string, contentHash: string) => Promise<T>,
): Promise<T> {
  if (!isContentHashMismatch(original)) throw original;
  const observedHash = parseObservedContentHash(original);
  let fresh: HoopRushManifest;
  try {
    fresh = await reloadManifest();
  } catch {
    throw original;
  }
  const entry = findEntry(fresh);
  if (!entry) throw original;
  if (entry.contentHash !== expectedHash) {
    return load(entry.url, entry.contentHash);
  }
  if (observedHash && observedHash !== expectedHash) {
    return load(entry.url, observedHash);
  }
  throw original;
}

const poolCache = new Map<string, Promise<FranchiseEraPool>>();

/** Load, hash-verify, and validate a franchise-era pool asset. */
export function getPool(entry: PoolIndexEntry): Promise<FranchiseEraPool> {
  const key = `${entry.franchiseId}/${entry.eraId}`;
  let promise = poolCache.get(key);
  if (!promise) {
    promise = loadPoolForKey(entry.franchiseId, entry.eraId, key);
    poolCache.set(key, promise);
    // A failed load must not poison the cache: the next request retries.
    promise.catch(() => {
      poolCache.delete(key);
    });
  }
  return promise;
}

function findPoolEntry(
  manifest: HoopRushManifest,
  franchiseId: string,
  eraId: string,
): PoolIndexEntry | null {
  return manifest.pools.find((p) => p.franchiseId === franchiseId && p.eraId === eraId) ?? null;
}

async function loadPoolForKey(
  franchiseId: string,
  eraId: string,
  key: string,
): Promise<FranchiseEraPool> {
  const manifest = await getManifest();
  const entry = findPoolEntry(manifest, franchiseId, eraId);
  if (!entry) {
    throw new Error(`pool unavailable: ${franchiseId}/${eraId}`);
  }
  const cached = await readCachedPool(key, entry.contentHash);
  if (cached) return cached;
  const load = (url: string, contentHash: string, bustCache = false) =>
    loadPool(
      bustCache ? cacheBustedUrl(resolveAssetUrl(url)) : resolveAssetUrl(url),
      contentHash,
    ).then((pool) => {
      void writeCachedPool(key, contentHash, pool);
      return pool;
    });
  try {
    return await load(entry.url, entry.contentHash);
  } catch (error) {
    return retryWithFreshManifest(
      error,
      entry.contentHash,
      (fresh) => findPoolEntry(fresh, franchiseId, eraId),
      (url, contentHash) => load(url, contentHash, true),
    );
  }
}

const profileCache = new Map<string, Promise<EraSimulationProfile>>();

/** Load, hash-verify, and validate an era simulation profile asset. */
export function getEraSimulationProfile(
  entry: SimProfileIndexEntry,
): Promise<EraSimulationProfile> {
  const key = entry.eraId;
  let promise = profileCache.get(key);
  if (!promise) {
    promise = loadEraSimulationProfile(resolveAssetUrl(entry.url), entry.contentHash).catch(
      (error: unknown) =>
        retryWithFreshManifest(
          error,
          entry.contentHash,
          (manifest) => manifest.eraSimulationProfiles.find((p) => p.eraId === entry.eraId) ?? null,
          (url, contentHash) =>
            loadEraSimulationProfile(cacheBustedUrl(resolveAssetUrl(url)), contentHash),
        ),
    );
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
    promise = loadOpponentBracket(resolveAssetUrl(entry.url), entry.contentHash).catch(
      (error: unknown) =>
        retryWithFreshManifest(
          error,
          entry.contentHash,
          (manifest) => manifest.bracket ?? null,
          (url, contentHash) =>
            loadOpponentBracket(cacheBustedUrl(resolveAssetUrl(url)), contentHash),
        ),
    );
    bracketCache.set(key, promise);
    promise.catch(() => {
      bracketCache.delete(key);
    });
  }
  return promise;
}

/** @internal Resets memoized loaders between unit tests. */
export function clearDataLoaderCaches(): void {
  manifestPromise = null;
  poolCache.clear();
  profileCache.clear();
  bracketCache.clear();
}
