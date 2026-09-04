import { loadManifest, loadPool, loadEraSimulationProfile, loadOpponentBracket, loadPlayersIndex, loadRosterDetails, parseEraSimulationProfile, parseOpponentBracket, parsePlayersIndex, parseRosterDetails, type HoopRushManifest, type FranchiseEraPool, type PoolIndexEntry, type SimProfileIndexEntry, type OpponentIndexEntry, type EraSimulationProfile, type OpponentBracket, type PlayersIndex, type RosterDetails, } from '@hoop-rush/data-contracts';
import { resolveAssetUrl } from './asset-url';
import { readCachedAsset, readCachedPool, writeCachedAsset, writeCachedPool } from './pool-cache';
let manifestPromise: Promise<HoopRushManifest> | null = null;
function manifestUrl(): string {
    return resolveAssetUrl('manifest.json');
}
const CONTENT_HASH_MISMATCH = /content hash mismatch: expected ([0-9a-f]{64}), got ([0-9a-f]{64})/;
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
function reloadManifest(): Promise<HoopRushManifest> {
    manifestPromise = loadManifest(cacheBustedUrl(manifestUrl()));
    manifestPromise.catch(() => {
        manifestPromise = null;
    });
    return manifestPromise;
}
function isContentHashMismatch(error: unknown): boolean {
    return error instanceof Error && CONTENT_HASH_MISMATCH.test(error.message);
}
function parseObservedContentHash(error: unknown): string | null {
    if (!(error instanceof Error))
        return null;
    const match = error.message.match(CONTENT_HASH_MISMATCH);
    return match?.[2] ?? null;
}
async function retryWithFreshManifest<T>(original: unknown, expectedHash: string, findEntry: (manifest: HoopRushManifest) => {
    url: string;
    contentHash: string;
} | null, load: (url: string, contentHash: string) => Promise<T>): Promise<T> {
    if (!isContentHashMismatch(original))
        throw original;
    const observedHash = parseObservedContentHash(original);
    let fresh: HoopRushManifest;
    try {
        fresh = await reloadManifest();
    }
    catch {
        throw original;
    }
    const entry = findEntry(fresh);
    if (!entry)
        throw original;
    if (entry.contentHash !== expectedHash) {
        return load(entry.url, entry.contentHash);
    }
    if (observedHash && observedHash !== expectedHash) {
        return load(entry.url, observedHash);
    }
    throw original;
}
const poolCache = new Map<string, Promise<FranchiseEraPool>>();
export function getPool(entry: PoolIndexEntry): Promise<FranchiseEraPool> {
    const key = `${entry.franchiseId}/${entry.eraId}`;
    let promise = poolCache.get(key);
    if (!promise) {
        promise = loadPoolForKey(entry.franchiseId, entry.eraId, key);
        poolCache.set(key, promise);
        promise.catch(() => {
            poolCache.delete(key);
        });
    }
    return promise;
}
function findPoolEntry(manifest: HoopRushManifest, franchiseId: string, eraId: string): PoolIndexEntry | null {
    return manifest.pools.find((p) => p.franchiseId === franchiseId && p.eraId === eraId) ?? null;
}
async function loadPoolForKey(franchiseId: string, eraId: string, key: string): Promise<FranchiseEraPool> {
    const manifest = await getManifest();
    const entry = findPoolEntry(manifest, franchiseId, eraId);
    if (!entry) {
        throw new Error(`pool unavailable: ${franchiseId}/${eraId}`);
    }
    const cached = await readCachedPool(key, entry.contentHash);
    if (cached)
        return cached;
    const load = (url: string, contentHash: string, bustCache = false) => loadPool(bustCache ? cacheBustedUrl(resolveAssetUrl(url)) : resolveAssetUrl(url), contentHash).then((pool) => {
        void writeCachedPool(key, contentHash, pool);
        return pool;
    });
    try {
        return await load(entry.url, entry.contentHash);
    }
    catch (error) {
        return retryWithFreshManifest(error, entry.contentHash, (fresh) => findPoolEntry(fresh, franchiseId, eraId), (url, contentHash) => load(url, contentHash, true));
    }
}
const profileCache = new Map<string, Promise<EraSimulationProfile>>();
export function getEraSimulationProfile(entry: SimProfileIndexEntry): Promise<EraSimulationProfile> {
    const key = entry.eraId;
    let promise = profileCache.get(key);
    if (!promise) {
        promise = loadProfileFor(entry);
        profileCache.set(key, promise);
        promise.catch(() => {
            profileCache.delete(key);
        });
    }
    return promise;
}
async function loadProfileFor(entry: SimProfileIndexEntry): Promise<EraSimulationProfile> {
    const cached = await readCachedAsset(entry.contentHash, parseEraSimulationProfile);
    if (cached !== null)
        return cached;
    const load = (url: string, contentHash: string, bustCache = false) => loadEraSimulationProfile(bustCache ? cacheBustedUrl(resolveAssetUrl(url)) : resolveAssetUrl(url), contentHash).then((profile) => {
        void writeCachedAsset(contentHash, profile);
        return profile;
    });
    try {
        return await load(entry.url, entry.contentHash);
    }
    catch (error: unknown) {
        return retryWithFreshManifest(error, entry.contentHash, (manifest) => manifest.eraSimulationProfiles.find((p) => p.eraId === entry.eraId) ?? null, (url, contentHash) => load(url, contentHash, true));
    }
}
const bracketCache = new Map<string, Promise<OpponentBracket>>();
export function getBracket(entry: OpponentIndexEntry): Promise<OpponentBracket> {
    const key = entry.url;
    let promise = bracketCache.get(key);
    if (!promise) {
        promise = loadBracketFor(entry);
        bracketCache.set(key, promise);
        promise.catch(() => {
            bracketCache.delete(key);
        });
    }
    return promise;
}
async function loadBracketFor(entry: OpponentIndexEntry): Promise<OpponentBracket> {
    const cached = await readCachedAsset(entry.contentHash, parseOpponentBracket);
    if (cached !== null)
        return cached;
    const load = (url: string, contentHash: string, bustCache = false) => loadOpponentBracket(bustCache ? cacheBustedUrl(resolveAssetUrl(url)) : resolveAssetUrl(url), contentHash).then((bracket) => {
        void writeCachedAsset(contentHash, bracket);
        return bracket;
    });
    try {
        return await load(entry.url, entry.contentHash);
    }
    catch (error: unknown) {
        return retryWithFreshManifest(error, entry.contentHash, (manifest) => manifest.bracket ?? null, (url, contentHash) => load(url, contentHash, true));
    }
}
let playersIndexPromise: Promise<PlayersIndex> | null = null;
export function getPlayersIndex(): Promise<PlayersIndex> {
    if (!playersIndexPromise) {
        playersIndexPromise = loadPlayersIndexFor();
        playersIndexPromise.catch(() => {
            playersIndexPromise = null;
        });
    }
    return playersIndexPromise;
}
export function warmPlayersIndex(): void {
    if (typeof window === 'undefined')
        return;
    void getPlayersIndex().catch(() => { });
}
async function loadPlayersIndexFor(): Promise<PlayersIndex> {
    const manifest = await getManifest();
    const entry = manifest.playersIndex;
    if (!entry) {
        throw new Error('The global players index is unavailable.');
    }
    const cached = await readCachedAsset(entry.contentHash, parsePlayersIndex);
    if (cached !== null)
        return cached;
    const load = (url: string, contentHash: string, bustCache = false) => loadPlayersIndex(bustCache ? cacheBustedUrl(resolveAssetUrl(url)) : resolveAssetUrl(url), contentHash).then((index) => {
        void writeCachedAsset(contentHash, index);
        return index;
    });
    try {
        return await load(entry.url, entry.contentHash);
    }
    catch (error) {
        return retryWithFreshManifest(error, entry.contentHash, (fresh) => fresh.playersIndex ?? null, (url, contentHash) => load(url, contentHash, true));
    }
}
let rosterDetailsPromise: Promise<RosterDetails> | null = null;
export function getRosterDetails(): Promise<RosterDetails> {
    if (!rosterDetailsPromise) {
        rosterDetailsPromise = loadRosterDetailsFor();
        rosterDetailsPromise.catch(() => {
            rosterDetailsPromise = null;
        });
    }
    return rosterDetailsPromise;
}
async function loadRosterDetailsFor(): Promise<RosterDetails> {
    const manifest = await getManifest();
    const entry = manifest.rosterDetails;
    if (!entry) {
        throw new Error('Roster details are unavailable.');
    }
    const cached = await readCachedAsset(entry.contentHash, parseRosterDetails);
    if (cached !== null)
        return cached;
    const load = (url: string, contentHash: string, bustCache = false) => loadRosterDetails(bustCache ? cacheBustedUrl(resolveAssetUrl(url)) : resolveAssetUrl(url), contentHash).then((details) => {
        void writeCachedAsset(contentHash, details);
        return details;
    });
    try {
        return await load(entry.url, entry.contentHash);
    }
    catch (error) {
        return retryWithFreshManifest(error, entry.contentHash, (fresh) => fresh.rosterDetails ?? null, (url, contentHash) => load(url, contentHash, true));
    }
}
export function clearDataLoaderCaches(): void {
    manifestPromise = null;
    poolCache.clear();
    profileCache.clear();
    bracketCache.clear();
    playersIndexPromise = null;
    rosterDetailsPromise = null;
}
