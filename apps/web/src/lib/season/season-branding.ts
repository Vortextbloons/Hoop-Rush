import {
  franchiseAbbreviation,
  resolveEraTeamIdentity,
  type HoopRushManifest,
  type PlayersIndexAltIds,
  type PlayersIndexEntry,
} from '@hoop-rush/data-contracts';

/**
 * Season Run branding index (M2.3.5). Fantasy franchises use their assigned
 * modern identity and logo; player-season cards use the historical identity
 * and logo of the franchise/era that owned that version. Version cards join
 * the global players index by the exact (playerId, franchiseId, eraId,
 * seasonKey) tuple so `SeasonPlayerFace` receives the full headshot fallback
 * chain (NBA CDN, bbref, photoUrl). This module never invents franchise
 * colors: Hoop Rush orange/gold remain the UI accent and logos carry team
 * identity.
 */

/** Minimal identity a season player card needs for a branded face. */
export interface SeasonFaceRef {
  playerId: string;
  playerExternalId: string;
  altIds: PlayersIndexAltIds;
  /** Initials for the fallback face. */
  initials: string;
}

/** Identity facts a roster entry needs to join the players index. */
export interface SeasonVersionTuple {
  playerVersionId: string;
  playerId: string;
  franchiseId: string;
  eraId: string;
  seasonKey: string;
  displayName: string;
}

/** Modern franchise slot facts for the masthead and team pages. */
export interface SeasonFranchiseIdentity {
  franchiseId: string;
  displayName: string;
  abbreviation: string;
  teamExternalId: string;
}

/**
 * Builds `playerVersionId -> face ref` by joining roster entries to the
 * global players index on the exact version tuple. Entries missing from the
 * index receive an empty playerExternalId so faces fall back to initials
 * without a doomed network request; the map always contains every entry.
 */
export function buildVersionFaceIndex(
  playersIndex: readonly PlayersIndexEntry[],
  rosterEntries: readonly SeasonVersionTuple[],
): Map<string, SeasonFaceRef> {
  const byTuple = new Map<string, PlayersIndexEntry>();
  for (const entry of playersIndex) {
    byTuple.set(tupleKey(entry.playerId, entry.franchiseId, entry.eraId, entry.seasonKey), entry);
  }
  const faces = new Map<string, SeasonFaceRef>();
  for (const entry of rosterEntries) {
    const match = byTuple.get(
      tupleKey(entry.playerId, entry.franchiseId, entry.eraId, entry.seasonKey),
    );
    faces.set(entry.playerVersionId, {
      playerId: entry.playerId,
      playerExternalId: match?.playerExternalId ?? '',
      altIds: match?.altIds ?? null,
      initials: initialsOf(match?.displayName ?? entry.displayName),
    });
  }
  return faces;
}

function tupleKey(playerId: string, franchiseId: string, eraId: string, seasonKey: string): string {
  return `${playerId}\0${franchiseId}\0${eraId}\0${seasonKey}`;
}

/** The modern franchise slot for a franchiseId, or null when missing. */
export function franchiseIdentityOf(
  manifest: HoopRushManifest,
  franchiseId: string,
): SeasonFranchiseIdentity | null {
  const slot = manifest.modernFranchiseSlots.find((s) => s.franchiseId === franchiseId);
  if (slot === undefined) return null;
  return {
    franchiseId,
    displayName: slot.displayName,
    abbreviation: franchiseAbbreviation(franchiseId),
    teamExternalId: slot.teamExternalId,
  };
}

/** Historical era-scoped identity for a player-season card (null when modern). */
export function eraIdentityOf(
  manifest: HoopRushManifest,
  franchiseId: string,
  eraId: string,
): { displayLabel: string | null; logoCandidates: readonly string[] } {
  const identity = resolveEraTeamIdentity(manifest, franchiseId, eraId);
  return { displayLabel: identity.displayLabel, logoCandidates: identity.logoCandidates };
}

/** Initials for a fallback face from any display name. */
export function initialsOf(displayName: string): string {
  const parts = displayName
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}
