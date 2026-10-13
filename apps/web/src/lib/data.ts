import {
  loadPool,
  parseEraSimulationProfile,
  parseOpponentBracket,
  parsePlayersIndex,
  parseRosterDetails,
  type HoopRushManifest,
  type FranchiseEraPool,
  type PoolIndexEntry,
  type SimProfileIndexEntry,
  type OpponentIndexEntry,
  type EraSimulationProfile,
  type OpponentBracket,
  type PlayersIndex,
  type RosterDetails,
} from '@hoop-rush/data-contracts';
import { resolveAssetUrl } from './asset-url';
import { isLiteMode } from './device-capabilities';
import { readCachedPool, writeCachedPool } from './pool-cache';
import {
  clearManifestAssetCaches,
  clearManifestCache,
  getManifest,
  loadManifestAsset,
  reloadManifest,
  retryWithFreshManifest,
} from './manifest-assets';

export { getManifest, reloadManifest };

function cacheBustedUrl(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${String(Date.now())}`;
}
const poolCache = new Map<string, Promise<FranchiseEraPool>>();
const POOL_MEMORY_MAX_DEFAULT = 8;
const POOL_MEMORY_MAX_LITE = 3;
function poolMemoryMax(): number {
  return isLiteMode() ? POOL_MEMORY_MAX_LITE : POOL_MEMORY_MAX_DEFAULT;
}
function rememberPool(key: string, promise: Promise<FranchiseEraPool>): void {
  poolCache.delete(key);
  poolCache.set(key, promise);
  const max = poolMemoryMax();
  while (poolCache.size > max) {
    const oldest = poolCache.keys().next().value;
    if (oldest === undefined) break;
    poolCache.delete(oldest);
  }
}
export function getPool(entry: PoolIndexEntry): Promise<FranchiseEraPool> {
  const key = `${entry.franchiseId}/${entry.eraId}`;
  let promise = poolCache.get(key);
  if (!promise) {
    promise = loadPoolForKey(entry.franchiseId, entry.eraId, key);
    promise.catch(() => {
      poolCache.delete(key);
    });
  }
  rememberPool(key, promise);
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

export function getEraSimulationProfile(
  entry: SimProfileIndexEntry,
): Promise<EraSimulationProfile> {
  return loadManifestAsset({
    key: `data/era-profile/${entry.eraId}`,
    label: 'era simulation profile',
    parse: parseEraSimulationProfile,
    entry,
    find: (manifest) => manifest.eraSimulationProfiles.find((p) => p.eraId === entry.eraId) ?? null,
    missingMessage: 'The era simulation profile is unavailable.',
    retryOnHashMismatch: true,
  });
}

export function getBracket(entry: OpponentIndexEntry): Promise<OpponentBracket> {
  return loadManifestAsset({
    key: `data/bracket/${entry.url}`,
    label: 'opponent bracket',
    parse: parseOpponentBracket,
    entry,
    find: (manifest) => manifest.bracket ?? null,
    missingMessage: 'The opponent bracket is unavailable.',
    retryOnHashMismatch: true,
  });
}

export function getPlayersIndex(): Promise<PlayersIndex> {
  return loadManifestAsset({
    key: 'data/players-index',
    label: 'players index',
    parse: parsePlayersIndex,
    find: (manifest) => manifest.playersIndex ?? null,
    missingMessage: 'The global players index is unavailable.',
    retryOnHashMismatch: true,
  });
}

export function warmManifest(): void {
  if (typeof window === 'undefined') return;
  if (isLiteMode()) return;
  void getManifest().catch(() => {});
}
export function warmPlayersIndex(): void {
  if (typeof window === 'undefined') return;
  if (isLiteMode()) return;
  void getPlayersIndex().catch(() => {});
}

export function getRosterDetails(): Promise<RosterDetails> {
  return loadManifestAsset({
    key: 'data/roster-details',
    label: 'roster details',
    parse: parseRosterDetails,
    find: (manifest) => manifest.rosterDetails ?? null,
    missingMessage: 'Roster details are unavailable.',
    retryOnHashMismatch: true,
  });
}

export function clearDataLoaderCaches(): void {
  clearManifestCache();
  clearManifestAssetCaches('data/');
  poolCache.clear();
}
