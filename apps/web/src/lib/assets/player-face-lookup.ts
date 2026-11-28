import {
  playerVersionId,
  type PlayersIndex,
  type PlayersIndexEntry,
} from '@hoop-rush/data-contracts';
import { getPlayersIndex } from '#lib/data.js';
import { cachedAssets } from './cached-assets.js';

export interface PlayerFaceLookupQuery {
  readonly playerId?: string | null;
  readonly playerVersionId?: string | null;
  readonly displayName: string;
  readonly franchiseId?: string | null;
  readonly seasonKey?: string | null;
}

export interface PlayerFaceIndex {
  /** Faces keyed by the catalog version id derived from the player's season tuple. */
  readonly byVersion: ReadonlyMap<string, PlayersIndexEntry>;
  /** First indexed face per person, used when a version cannot be resolved. */
  readonly byPlayerId: ReadonlyMap<string, PlayersIndexEntry>;
  /** First indexed face per display name, used by callers without a person id. */
  readonly byDisplayName: ReadonlyMap<string, PlayersIndexEntry>;
  /** Full catalog list for franchise/season-scoped fallback when version id is absent. */
  readonly entries: readonly PlayersIndexEntry[];
}

export interface ResolvePlayerFaceOptions {
  /** Allow matching by displayName when playerId is absent. */
  readonly fallbackToDisplayName?: boolean;
}

export function playerFaceIndex(playersIndex: PlayersIndex): PlayerFaceIndex {
  const byVersion = new Map<string, PlayersIndexEntry>();
  const byPlayerId = new Map<string, PlayersIndexEntry>();
  const byDisplayName = new Map<string, PlayersIndexEntry>();
  for (const entry of playersIndex.players) {
    const version = playerVersionId(
      entry.playerId,
      entry.franchiseId,
      entry.eraId,
      entry.seasonKey,
    );
    if (!byVersion.has(version)) byVersion.set(version, entry);
    if (!byPlayerId.has(entry.playerId)) byPlayerId.set(entry.playerId, entry);
    if (!byDisplayName.has(entry.displayName)) byDisplayName.set(entry.displayName, entry);
  }
  return { byVersion, byPlayerId, byDisplayName, entries: playersIndex.players };
}

export const playerFaces = cachedAssets(async () => playerFaceIndex(await getPlayersIndex()));

/** Resolves a version-specific face first, then optional franchise/season, then person. */
export function resolvePlayerFace(
  index: PlayerFaceIndex,
  query: PlayerFaceLookupQuery,
  options: ResolvePlayerFaceOptions = {},
): PlayersIndexEntry | null {
  const version = query.playerVersionId ?? null;
  if (version !== null) {
    const face = index.byVersion.get(version);
    if (face !== undefined) return face;
  }

  const playerId = query.playerId || null;
  if (query.franchiseId || query.seasonKey) {
    const scoped = index.entries.find(
      (entry) =>
        (playerId
          ? entry.playerId === playerId
          : options.fallbackToDisplayName && entry.displayName === query.displayName) &&
        (!query.franchiseId || entry.franchiseId === query.franchiseId) &&
        (!query.seasonKey || entry.seasonKey === query.seasonKey),
    );
    if (scoped !== undefined) return scoped;
  }

  if (playerId !== null) {
    return index.byPlayerId.get(playerId) ?? null;
  }

  if (options.fallbackToDisplayName) {
    return index.byDisplayName.get(query.displayName) ?? null;
  }

  return null;
}
