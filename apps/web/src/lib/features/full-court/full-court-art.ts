import type { HoopRushManifest, PlayersIndexEntry } from '@hoop-rush/data-contracts';
import { cachedAssets } from '#lib/assets/cached-assets.js';
import {
  playerFaces,
  resolvePlayerFace,
  type PlayerFaceIndex,
} from '#lib/assets/player-face-lookup.js';
import { franchiseIdentityOf, type FranchiseIdentity } from '#lib/branding.js';
import { getManifest } from '#lib/data.js';

/** The smallest player shape every Full Court surface already carries. */
export interface FullCourtArtPlayer {
  /** Person fallback for reports that only carry a version id. */
  readonly playerId?: string | null;
  readonly playerVersionId?: string | null;
  readonly displayName: string;
}

export interface FullCourtArt {
  readonly manifest: HoopRushManifest;
  faceFor(player: FullCourtArtPlayer): PlayersIndexEntry | null;
  teamFor(franchiseId: string): FranchiseIdentity | null;
}

/** Resolves a version-specific face first, then the person, then nothing. */
export function fullCourtArtOf(manifest: HoopRushManifest, index: PlayerFaceIndex): FullCourtArt {
  const teams = new Map<string, FranchiseIdentity>();
  return {
    manifest,
    faceFor(player) {
      return resolvePlayerFace(index, player);
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

const defaultArt = cachedAssets(async () => {
  const [manifest, index] = await Promise.all([getManifest(), playerFaces.load()]);
  return fullCourtArtOf(manifest, index);
});

/** Loads the shared manifest and players index once for every portrait. */
export function loadFullCourtArt(): Promise<FullCourtArt> {
  return defaultArt.load();
}
