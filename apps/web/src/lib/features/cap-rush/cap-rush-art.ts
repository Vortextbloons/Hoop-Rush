import type {
  CapRushSourcePlayer,
  HavocSourcePlayer,
  HavocTeamInput,
  CapRushRosterMetadata,
  HoopRushManifest,
  PlayersIndexEntry,
} from '@hoop-rush/data-contracts';
import { loadCapRushRosterMetadata } from '#lib/data-assets.js';
import { capRushOpponentMetadataOf } from './cap-rush-opponent-metadata.js';
import { getManifest, getPlayersIndex } from '#lib/data.js';
import { franchiseIdentityOf, type FranchiseIdentity } from '#lib/branding.js';

export interface CapRushArt {
  readonly manifest: HoopRushManifest;
  opponentMetadataFor(source: HavocSourcePlayer): CapRushRosterMetadata['players'][number] | null;
  opponentSeasonFor(team: HavocTeamInput): string | null;
  faceFor(player: CapRushSourcePlayer): PlayersIndexEntry | null;
  faceForPlayerId(playerId: string): PlayersIndexEntry | null;
  teamFor(franchiseId: string): FranchiseIdentity | null;
}

function tupleKey(playerId: string, franchiseId: string, eraId: string, seasonKey: string): string {
  return `${playerId}\u0000${franchiseId}\u0000${eraId}\u0000${seasonKey}`;
}

export async function loadCapRushArt(): Promise<CapRushArt> {
  const manifest = await getManifest();
  const [playersIndex, rosterMetadata] = await Promise.all([
    getPlayersIndex().catch(() => null),
    loadCapRushRosterMetadata().catch(() => null),
  ]);
  const faces = new Map<string, PlayersIndexEntry>();
  const byPlayerId = new Map<string, PlayersIndexEntry>();
  if (playersIndex !== null) {
    for (const entry of playersIndex.players) {
      faces.set(tupleKey(entry.playerId, entry.franchiseId, entry.eraId, entry.seasonKey), entry);
      if (!byPlayerId.has(entry.playerId)) byPlayerId.set(entry.playerId, entry);
    }
  }
  const teams = new Map<string, FranchiseIdentity>();
  return {
    manifest,
    opponentMetadataFor(source) {
      return rosterMetadata === null ? null : capRushOpponentMetadataOf(source, rosterMetadata);
    },
    opponentSeasonFor(team) {
      const seasons = new Set(
        team.starters.flatMap((starter) => {
          const matched =
            rosterMetadata === null
              ? null
              : capRushOpponentMetadataOf(starter.source, rosterMetadata);
          const season = starter.source.seasonKey ?? matched?.seasonKey;
          return season === undefined ? [] : [season];
        }),
      );
      return seasons.size === 1 ? ([...seasons][0] ?? null) : null;
    },
    faceFor(player) {
      return (
        faces.get(tupleKey(player.playerId, player.franchiseId, player.eraId, player.seasonKey)) ??
        null
      );
    },
    faceForPlayerId(playerId) {
      return byPlayerId.get(playerId) ?? null;
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
