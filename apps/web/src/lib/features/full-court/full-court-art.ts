import {
  playerVersionId,
  type HoopRushManifest,
  type PlayersIndex,
  type PlayersIndexEntry,
} from '@hoop-rush/data-contracts';
import { cachedAssets } from '#lib/assets/cached-assets.js';
import { franchiseIdentityOf, type FranchiseIdentity } from '#lib/branding.js';
import { getManifest, getPlayersIndex } from '#lib/data.js';

/** The smallest player shape every Full Court surface already carries. */
export interface FullCourtArtPlayer {
  /** Person fallback for reports that only carry a version id. */
  readonly playerId?: string | null;
  readonly playerVersionId?: string | null;
  readonly displayName: string;
}

export interface FullCourtFaceIndex {
  /** Faces keyed by the catalog version id derived from the player's season tuple. */
  readonly byVersion: ReadonlyMap<string, PlayersIndexEntry>;
  /** First indexed face per person, used when a version cannot be resolved. */
  readonly byPlayerId: ReadonlyMap<string, PlayersIndexEntry>;
}

export interface FullCourtArtIndex extends FullCourtFaceIndex {
  readonly manifest: HoopRushManifest;
}

export interface FullCourtArt {
  readonly manifest: HoopRushManifest;
  faceFor(player: FullCourtArtPlayer): PlayersIndexEntry | null;
  teamFor(franchiseId: string): FranchiseIdentity | null;
}

export function fullCourtArtFaceIndex(playersIndex: PlayersIndex): FullCourtFaceIndex {
  const byVersion = new Map<string, PlayersIndexEntry>();
  const byPlayerId = new Map<string, PlayersIndexEntry>();
  for (const entry of playersIndex.players) {
    const version = playerVersionId(
      entry.playerId,
      entry.franchiseId,
      entry.eraId,
      entry.seasonKey,
    );
    if (!byVersion.has(version)) byVersion.set(version, entry);
    if (!byPlayerId.has(entry.playerId)) byPlayerId.set(entry.playerId, entry);
  }
  return { byVersion, byPlayerId };
}

export function fullCourtArtIndex(
  manifest: HoopRushManifest,
  playersIndex: PlayersIndex,
): FullCourtArtIndex {
  return { manifest, ...fullCourtArtFaceIndex(playersIndex) };
}

/** Resolves a version-specific face first, then the person, then nothing. */
export function fullCourtArtOf(index: FullCourtArtIndex): FullCourtArt {
  const teams = new Map<string, FranchiseIdentity>();
  return {
    manifest: index.manifest,
    faceFor(player) {
      const version = player.playerVersionId ?? null;
      if (version !== null) {
        const face = index.byVersion.get(version);
        if (face !== undefined) return face;
      }
      const playerId = player.playerId ?? null;
      return playerId === null ? null : (index.byPlayerId.get(playerId) ?? null);
    },
    teamFor(franchiseId) {
      const cached = teams.get(franchiseId);
      if (cached !== undefined) return cached;
      const identity = franchiseIdentityOf(index.manifest, franchiseId);
      if (identity !== null) teams.set(franchiseId, identity);
      return identity;
    },
  };
}

const defaultArt = cachedAssets(async () => {
  const [manifest, playersIndex] = await Promise.all([getManifest(), getPlayersIndex()]);
  return fullCourtArtOf(fullCourtArtIndex(manifest, playersIndex));
});

/** Loads the shared manifest and players index once for every portrait. */
export function loadFullCourtArt(): Promise<FullCourtArt> {
  return defaultArt.load();
}
