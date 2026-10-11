import type { SeasonRunSnapshot } from '@hoop-rush/persistence';
const CACHE_LIMIT = 4;
function cacheKeyOf(runId: string, acceptedCount: number, stateRevision: number): string {
  return `${runId}:${String(acceptedCount)}:${String(stateRevision)}`;
}
export function rosterKeyOfSnapshotRun(rosters: SeasonRunSnapshot['run']['rosters']): string {
  return rosters
    .map(
      (roster) =>
        `${roster.franchiseId}:${roster.players.map((player) => player.playerVersionId).join(',')}`,
    )
    .join('|');
}
function rosterKeyOfSnapshot(snapshot: SeasonRunSnapshot): string {
  return rosterKeyOfSnapshotRun(snapshot.run.rosters);
}
export class SeasonSnapshotCache {
  private readonly snapshotsByKey = new Map<
    string,
    { snapshot: SeasonRunSnapshot; rosterKey: string }
  >();
  private latestKey: string | null = null;
  get(): SeasonRunSnapshot | null {
    if (this.latestKey === null) return null;
    return this.snapshotsByKey.get(this.latestKey)?.snapshot ?? null;
  }
  getFor(runId: string, acceptedCount: number, stateRevision: number): SeasonRunSnapshot | null {
    const entry = this.snapshotsByKey.get(cacheKeyOf(runId, acceptedCount, stateRevision));
    if (entry === undefined) return null;
    this.latestKey = cacheKeyOf(runId, acceptedCount, stateRevision);
    return entry.snapshot;
  }
  matches(runId: string, acceptedCount: number, stateRevision: number): boolean {
    const key = cacheKeyOf(runId, acceptedCount, stateRevision);
    if (this.snapshotsByKey.has(key)) {
      this.latestKey = key;
      return true;
    }
    return false;
  }
  rosterKeyFor(runId: string, acceptedCount: number, stateRevision: number): string | null {
    return (
      this.snapshotsByKey.get(cacheKeyOf(runId, acceptedCount, stateRevision))?.rosterKey ?? null
    );
  }
  set(snapshot: SeasonRunSnapshot): void {
    const key = cacheKeyOf(
      snapshot.run.runId,
      snapshot.acceptedBlocks.length,
      snapshot.run.stateRevision,
    );
    for (const existing of [...this.snapshotsByKey.keys()]) {
      const prefix = `${snapshot.run.runId}:${String(snapshot.acceptedBlocks.length)}:`;
      if (existing !== key && existing.startsWith(prefix)) {
        this.snapshotsByKey.delete(existing);
      }
    }
    this.snapshotsByKey.set(key, { snapshot, rosterKey: rosterKeyOfSnapshot(snapshot) });
    this.latestKey = key;
    while (this.snapshotsByKey.size > CACHE_LIMIT) {
      const next = this.snapshotsByKey.keys().next();
      const oldest = next.done === true ? undefined : next.value;
      if (oldest === undefined) break;
      if (oldest === this.latestKey) {
        const second = [...this.snapshotsByKey.keys()].find((k) => k !== this.latestKey);
        if (second === undefined) break;
        this.snapshotsByKey.delete(second);
      } else {
        this.snapshotsByKey.delete(oldest);
      }
    }
  }
  clear(): void {
    this.snapshotsByKey.clear();
    this.latestKey = null;
  }
}
