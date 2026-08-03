import type {
  ClassicDraftCatalog,
  ClassicDraftState,
  HoopRushManifest,
  PlayersIndex,
  PlayersIndexEntry,
  Seed,
} from '@hoop-rush/data-contracts';
import { challengeRepository } from '$lib/challenge-repo';
import { sortDraftRows, type DraftPresentation } from '$lib/draft-presentation';
import { generateSeed } from '$lib/sandbox-url';

/**
 * Classic draft adapters (spec/01 Classic game mode): building the compact
 * franchise-era catalog the engine rolls against, slicing the global players
 * index into a round's eligible pool, and persisting/resuming the authoritative
 * ClassicDraftState. The browser never scans a decade to determine peaks; the
 * index and the manifest pools are the whole surface.
 */

/** The franchise/era grouping key used for every bucket lookup. */
function franchiseEraKey(franchiseId: string, eraId: string): string {
  return `${franchiseId}/${eraId}`;
}

/**
 * Memoized bucket maps keyed on the immutable index instance, so catalog and
 * pool-row builds never rescan the global index more than once per load.
 */
const franchiseEraBucketCache = new WeakMap<
  PlayersIndex,
  ReadonlyMap<string, PlayersIndexEntry[]>
>();

/**
 * Single pass over the global players index grouping rows by their
 * franchise/era pair. Buckets preserve index order, which keeps the catalog
 * and pool rows identical to a per-pool filter. Memoized per index instance.
 */
export function buildFranchiseEraBuckets(
  index: PlayersIndex,
): ReadonlyMap<string, PlayersIndexEntry[]> {
  const cached = franchiseEraBucketCache.get(index);
  if (cached) return cached;
  const mutable = new Map<string, PlayersIndexEntry[]>();
  for (const p of index.players) {
    const key = franchiseEraKey(p.franchiseId, p.eraId);
    const bucket = mutable.get(key);
    if (bucket) {
      bucket.push(p);
    } else {
      mutable.set(key, [p]);
    }
  }
  const buckets: ReadonlyMap<string, PlayersIndexEntry[]> = mutable;
  franchiseEraBucketCache.set(index, buckets);
  return buckets;
}

/** One catalog entry per packaged manifest pool, in manifest.pools order. */
export function buildClassicCatalog(
  manifest: HoopRushManifest,
  index: PlayersIndex,
): ClassicDraftCatalog {
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

/** The complete eligible pool for one rolled pair, sorted for the presentation. */
export function classicPoolRows(
  index: PlayersIndex,
  pair: { franchiseId: string; eraId: string },
  presentation: DraftPresentation,
): PlayersIndexEntry[] {
  const buckets = buildFranchiseEraBuckets(index);
  return sortDraftRows(
    buckets.get(franchiseEraKey(pair.franchiseId, pair.eraId)) ?? [],
    presentation,
  );
}

/** Persists the authoritative draft state so reload resumes at the exact round. */
export async function saveClassicDraftState(draft: ClassicDraftState): Promise<void> {
  await challengeRepository.saveClassicDraft({
    recordId: 'classic-draft',
    saveSchemaVersion: 1,
    draft,
  });
}

/** Loads the persisted draft, or null when no draft has been started. */
export async function loadClassicDraftState(): Promise<ClassicDraftState | null> {
  const record = await challengeRepository.loadClassicDraft();
  return record?.draft ?? null;
}

/** Discards the persisted draft (leave-and-discard) so the next visit starts fresh. */
export async function clearClassicDraftState(): Promise<void> {
  await challengeRepository.clearClassicDraft();
}

/** Fresh seed for a classic draft at the UI boundary. */
export function classicDraftSeed(): Seed {
  return generateSeed();
}
