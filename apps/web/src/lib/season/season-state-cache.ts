import type { SeasonRunSnapshot } from '@hoop-rush/persistence';
const CACHE_LIMIT = 4;
function cacheKeyOf(runId: string, revision: number): string {
    return `${runId}:${String(revision)}`;
}
export function rosterKeyOfSnapshotRun(rosters: SeasonRunSnapshot['run']['rosters']): string {
    return rosters
        .map((roster) => `${roster.franchiseId}:${roster.players.map((player) => player.playerVersionId).join(',')}`)
        .join('|');
}
function rosterKeyOfSnapshot(snapshot: SeasonRunSnapshot): string {
    return rosterKeyOfSnapshotRun(snapshot.run.rosters);
}
const snapshotsByKey = new Map<string, { snapshot: SeasonRunSnapshot; rosterKey: string }>();
let latestKey: string | null = null;
export function getCachedSeasonSnapshot(): SeasonRunSnapshot | null {
    if (latestKey === null)
        return null;
    return snapshotsByKey.get(latestKey)?.snapshot ?? null;
}
export function getCachedSeasonSnapshotFor(runId: string, revision: number): SeasonRunSnapshot | null {
    const entry = snapshotsByKey.get(cacheKeyOf(runId, revision));
    if (entry === undefined)
        return null;
    latestKey = cacheKeyOf(runId, revision);
    return entry.snapshot;
}
export function cachedSeasonSnapshotMatches(runId: string, revision: number): boolean {
    const key = cacheKeyOf(runId, revision);
    if (snapshotsByKey.has(key)) {
        latestKey = key;
        return true;
    }
    return false;
}
export function cachedSeasonSnapshotRosterKey(runId: string, revision: number): string | null {
    return snapshotsByKey.get(cacheKeyOf(runId, revision))?.rosterKey ?? null;
}
export function setCachedSeasonSnapshot(snapshot: SeasonRunSnapshot): void {
    const key = cacheKeyOf(snapshot.run.runId, snapshot.acceptedBlocks.length);
    snapshotsByKey.set(key, { snapshot, rosterKey: rosterKeyOfSnapshot(snapshot) });
    latestKey = key;
    while (snapshotsByKey.size > CACHE_LIMIT) {
        const next = snapshotsByKey.keys().next();
        const oldest = next.done === true ? undefined : next.value;
        if (oldest === undefined)
            break;
        if (oldest === latestKey) {
            const second = [...snapshotsByKey.keys()].find((k) => k !== latestKey);
            if (second === undefined)
                break;
            snapshotsByKey.delete(second);
        }
        else {
            snapshotsByKey.delete(oldest);
        }
    }
}
export function clearCachedSeasonSnapshot(): void {
    snapshotsByKey.clear();
    latestKey = null;
}
