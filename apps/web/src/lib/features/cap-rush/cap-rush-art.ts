import type {
  CapRushSourcePlayer,
  HoopRushManifest,
  PlayersIndexEntry,
} from '@hoop-rush/data-contracts';
import { getManifest, getPlayersIndex } from '#lib/data.js';
import { franchiseIdentityOf, type FranchiseIdentity } from '#lib/branding.js';

export interface CapRushArt {
  readonly manifest: HoopRushManifest;
  faceFor(player: CapRushSourcePlayer): PlayersIndexEntry | null;
  teamFor(franchiseId: string): FranchiseIdentity | null;
}

function tupleKey(playerId: string, franchiseId: string, eraId: string, seasonKey: string): string {
  return `${playerId}\u0000${franchiseId}\u0000${eraId}\u0000${seasonKey}`;
}

export async function loadCapRushArt(): Promise<CapRushArt> {
  const manifest = await getManifest();
  const playersIndex = await getPlayersIndex().catch(() => null);
  const faces = new Map<string, PlayersIndexEntry>();
  if (playersIndex !== null) {
    for (const entry of playersIndex.players) {
      faces.set(tupleKey(entry.playerId, entry.franchiseId, entry.eraId, entry.seasonKey), entry);
    }
  }
  const teams = new Map<string, FranchiseIdentity>();
  return {
    manifest,
    faceFor(player) {
      return (
        faces.get(tupleKey(player.playerId, player.franchiseId, player.eraId, player.seasonKey)) ??
        null
      );
    },
    teamFor(franchiseId) {
      const cached = teams.get(franchiseId);
      if (cached !== undefined) return cached;
      const identity = franchiseIdentityOf(manifest, franchiseId);
      if (identity !== null) teams.set(franchiseId, identity);
      return identity;
    },
  };
}
