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

/** One catalog entry per packaged manifest pool, in manifest.pools order. */
export function buildClassicCatalog(
  manifest: HoopRushManifest,
  index: PlayersIndex,
): ClassicDraftCatalog {
  return manifest.pools.map((pair) => ({
    franchiseId: pair.franchiseId,
    eraId: pair.eraId,
    players: index.players
      .filter((p) => p.franchiseId === pair.franchiseId && p.eraId === pair.eraId)
      .map((p) => ({ playerId: p.playerId, positions: [...p.positionsCanonical] })),
  }));
}

/** The complete eligible pool for one rolled pair, sorted for the presentation. */
export function classicPoolRows(
  index: PlayersIndex,
  pair: { franchiseId: string; eraId: string },
  presentation: DraftPresentation,
): PlayersIndexEntry[] {
  return sortDraftRows(
    index.players.filter((p) => p.franchiseId === pair.franchiseId && p.eraId === pair.eraId),
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
