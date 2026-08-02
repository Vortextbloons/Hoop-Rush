import type { ChallengeRun, HoopRushManifest, PeakPlayerSeason } from '@hoop-rush/data-contracts';
import { getPool } from '$lib/data';

/**
 * Loads the single franchise-era pool behind a run and maps playerId →
 * peak season. Every sandbox run drafts five players from exactly one
 * franchise-era pool (spec/12 challenge contract). Missing or failed pools
 * are skipped so callers render from run snapshots regardless.
 */
export async function loadRunPlayersById(
  currentRun: ChallengeRun,
  manifest: HoopRushManifest,
): Promise<Map<string, PeakPlayerSeason>> {
  const entry = manifest.pools.find(
    (p) => p.franchiseId === currentRun.franchiseId && p.eraId === currentRun.eraId,
  );
  if (!entry) return new Map();
  try {
    const pool = await getPool(entry);
    return new Map(
      pool.players
        .filter((player) => currentRun.playerIds.includes(player.playerId))
        .map((player) => [player.playerId, player]),
    );
  } catch {
    // Player details are optional; callers render from run snapshots regardless.
    return new Map();
  }
}

/** The run's five players in slot order once their pool has resolved. */
export function lineupPlayersFromRun(
  currentRun: ChallengeRun,
  byId: Map<string, PeakPlayerSeason>,
): PeakPlayerSeason[] | null {
  const ordered = currentRun.playerIds.map((id) => byId.get(id));
  return ordered.every((p): p is PeakPlayerSeason => p !== undefined) ? ordered : null;
}
