import type { ChallengeRun, HoopRushManifest, PeakPlayerSeason } from '@hoop-rush/data-contracts';
import { getPool } from '$lib/data';

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
