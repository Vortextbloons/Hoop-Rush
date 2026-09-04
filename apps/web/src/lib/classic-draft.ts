import type { ClassicDraftCatalog, ClassicDraftState, HoopRushManifest, PlayersIndex, PlayersIndexEntry, Seed, } from '@hoop-rush/data-contracts';
import { challengeRepository } from '$lib/challenge-repo';
import { sortDraftRows, type DraftPresentation } from '$lib/draft-presentation';
import { generateSeed } from '$lib/sandbox-url';
function franchiseEraKey(franchiseId: string, eraId: string): string {
    return `${franchiseId}/${eraId}`;
}
const franchiseEraBucketCache = new WeakMap<PlayersIndex, ReadonlyMap<string, PlayersIndexEntry[]>>();
export function buildFranchiseEraBuckets(index: PlayersIndex): ReadonlyMap<string, PlayersIndexEntry[]> {
    const cached = franchiseEraBucketCache.get(index);
    if (cached)
        return cached;
    const mutable = new Map<string, PlayersIndexEntry[]>();
    for (const p of index.players) {
        const key = franchiseEraKey(p.franchiseId, p.eraId);
        const bucket = mutable.get(key);
        if (bucket) {
            bucket.push(p);
        }
        else {
            mutable.set(key, [p]);
        }
    }
    const buckets: ReadonlyMap<string, PlayersIndexEntry[]> = mutable;
    franchiseEraBucketCache.set(index, buckets);
    return buckets;
}
export function buildClassicCatalog(manifest: HoopRushManifest, index: PlayersIndex): ClassicDraftCatalog {
    const buckets = buildFranchiseEraBuckets(index);
    return manifest.pools.map((pair) => ({
        franchiseId: pair.franchiseId,
        eraId: pair.eraId,
        players: (buckets.get(franchiseEraKey(pair.franchiseId, pair.eraId)) ?? []).map((p) => ({
            playerId: p.playerId,
            positions: [...p.positionsPlayable],
        })),
    }));
}
export function classicPoolRows(index: PlayersIndex, pair: {
    franchiseId: string;
    eraId: string;
}, presentation: DraftPresentation): PlayersIndexEntry[] {
    const buckets = buildFranchiseEraBuckets(index);
    return sortDraftRows(buckets.get(franchiseEraKey(pair.franchiseId, pair.eraId)) ?? [], presentation);
}
export async function saveClassicDraftState(draft: ClassicDraftState): Promise<void> {
    await challengeRepository.saveClassicDraft({
        recordId: 'classic-draft',
        saveSchemaVersion: 1,
        draft,
    });
}
export async function loadClassicDraftState(): Promise<ClassicDraftState | null> {
    const record = await challengeRepository.loadClassicDraft();
    return record?.draft ?? null;
}
export async function clearClassicDraftState(): Promise<void> {
    await challengeRepository.clearClassicDraft();
}
export function classicDraftSeed(): Seed {
    return generateSeed();
}
