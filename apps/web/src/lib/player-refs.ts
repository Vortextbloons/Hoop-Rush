import type { HoopRushManifest, PeakPlayerSeason } from '@hoop-rush/data-contracts';
import { getPool } from '$lib/data';
export interface PlayerRef {
  playerId: string;
  franchiseId: string;
  eraId: string;
}
export async function resolvePlayerRefs(
  refs: readonly PlayerRef[],
  manifest: HoopRushManifest,
): Promise<PeakPlayerSeason[]> {
  const byKey = new Map<string, Map<string, PeakPlayerSeason>>();
  const uniqueKeys = [...new Set(refs.map((r) => `${r.franchiseId}/${r.eraId}`))];
  await Promise.all(
    uniqueKeys.map(async (key) => {
      const slash = key.indexOf('/');
      const poolEntry = manifest.pools.find(
        (p) => p.franchiseId === key.slice(0, slash) && p.eraId === key.slice(slash + 1),
      );
      if (!poolEntry) throw new Error(`Pool unavailable for ${key}.`);
      const pool = await getPool(poolEntry);
      byKey.set(key, new Map(pool.players.map((p) => [p.playerId, p])));
    }),
  );
  return refs.map((ref) => {
    const player = byKey.get(`${ref.franchiseId}/${ref.eraId}`)?.get(ref.playerId);
    if (!player) throw new Error(`Drafted player ${ref.playerId} is unavailable.`);
    return player;
  });
}
