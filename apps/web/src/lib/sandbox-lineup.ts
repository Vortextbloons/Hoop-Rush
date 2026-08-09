import type { ChallengeRun, HoopRushManifest, PeakPlayerSeason } from '@hoop-rush/data-contracts';
import { getPool } from '$lib/data';

/**
 * Loads the pools behind a run and maps playerId → peak season. Free-form
 * runs resolve the pools of their selections (unique franchise/era pairs);
 * legacy runs resolve the single franchise/era pool. Missing or failed
 * pools are skipped so callers render from run snapshots regardless.
 */
export async function loadRunPlayersById(
  currentRun: ChallengeRun,
  manifest: HoopRushManifest,
): Promise<Map<string, PeakPlayerSeason>> {
  const pairs: Array<{ franchiseId: string; eraId: string }> = [];
  if (currentRun.selections) {
    for (const selection of currentRun.selections) {
      const known = pairs.some(
        (p) => p.franchiseId === selection.franchiseId && p.eraId === selection.eraId,
      );
      if (!known) pairs.push({ franchiseId: selection.franchiseId, eraId: selection.eraId });
    }
  } else if (currentRun.franchiseId) {
    pairs.push({ franchiseId: currentRun.franchiseId, eraId: currentRun.eraId });
  }
  const entries: Array<[string, PeakPlayerSeason]> = [];
  // Load every distinct pool in parallel; a missing entry or a failed load
  // only skips that pair, never the whole call (callers render from run
  // snapshots regardless of partial player details).
  const loaded = await Promise.all(
    pairs.map(async (pair) => {
      const entry = manifest.pools.find(
        (p) => p.franchiseId === pair.franchiseId && p.eraId === pair.eraId,
      );
      if (!entry) return [];
      try {
        const pool = await getPool(entry);
        return pool.players.filter((player) => currentRun.playerIds.includes(player.playerId));
      } catch {
        // Player details are optional; callers render from run snapshots regardless.
        return [];
      }
    }),
  );
  for (const players of loaded) {
    for (const player of players) {
      entries.push([player.playerId, player]);
    }
  }
  return new Map(entries);
}

export function lineupPlayersFromRun(
  currentRun: ChallengeRun,
  byId: Map<string, PeakPlayerSeason>,
): PeakPlayerSeason[] | null {
  const ordered = currentRun.selections
    ? currentRun.selections.map((s) => byId.get(s.playerId))
    : currentRun.playerIds.map((id) => byId.get(id));
  return ordered.every((p): p is PeakPlayerSeason => p !== undefined) ? ordered : null;
}
