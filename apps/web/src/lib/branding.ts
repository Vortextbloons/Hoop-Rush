import {
  franchiseAbbreviation,
  resolveEraTeamIdentity,
  type HoopRushManifest,
  type PlayersIndexAltIds,
  type PlayersIndexEntry,
  type SeasonDraftCandidate,
} from '@hoop-rush/data-contracts';

export interface FaceRef {
  playerId: string;
  playerExternalId: string;
  altIds: PlayersIndexAltIds;
  initials: string;
}

export interface VersionTuple {
  playerVersionId: string;
  playerId: string;
  franchiseId: string;
  eraId: string;
  seasonKey: string;
  displayName: string;
}

export function versionTupleOfRosterEntry(
  entry: VersionTuple,
  catalogCandidate?: Pick<SeasonDraftCandidate, 'franchiseId' | 'eraId' | 'seasonKey'> | null,
): VersionTuple {
  return {
    playerVersionId: entry.playerVersionId,
    playerId: entry.playerId,
    franchiseId: catalogCandidate?.franchiseId ?? entry.franchiseId,
    eraId: catalogCandidate?.eraId ?? entry.eraId,
    seasonKey: catalogCandidate?.seasonKey ?? entry.seasonKey,
    displayName: entry.displayName,
  };
}

export interface FranchiseIdentity {
  franchiseId: string;
  displayName: string;
  abbreviation: string;
  teamExternalId: string;
}

export function buildVersionFaceIndex(
  playersIndex: readonly PlayersIndexEntry[],
  rosterEntries: readonly VersionTuple[],
): Map<string, FaceRef> {
  const byTuple = new Map<string, PlayersIndexEntry>();
  for (const entry of playersIndex) {
    byTuple.set(tupleKey(entry.playerId, entry.franchiseId, entry.eraId, entry.seasonKey), entry);
  }
  const faces = new Map<string, FaceRef>();
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

export function franchiseIdentityOf(
  manifest: HoopRushManifest,
  franchiseId: string,
): FranchiseIdentity | null {
  const slot = manifest.modernFranchiseSlots.find((s) => s.franchiseId === franchiseId);
  if (slot === undefined) return null;
  return {
    franchiseId,
    displayName: slot.displayName,
    abbreviation: franchiseAbbreviation(franchiseId),
    teamExternalId: slot.teamExternalId,
  };
}

export function eraIdentityOf(
  manifest: HoopRushManifest,
  franchiseId: string,
  eraId: string,
): {
  displayLabel: string | null;
  logoCandidates: readonly string[];
} {
  const identity = resolveEraTeamIdentity(manifest, franchiseId, eraId);
  return { displayLabel: identity.displayLabel, logoCandidates: identity.logoCandidates };
}

export function initialsOf(displayName: string): string {
  const parts = displayName
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  if (parts.length === 0) return '?';
  const firstChar = (part: string | undefined): string =>
    part === undefined || part.length === 0 ? '' : (part[0] ?? '');
  if (parts.length === 1) {
    const only = parts[0];
    return only === undefined ? '?' : only.slice(0, 2).toUpperCase();
  }
  const initials = `${firstChar(parts[0])}${firstChar(parts[parts.length - 1])}`.toUpperCase();
  return initials === '' ? '?' : initials;
}

export function eraLabelOf(
  manifest: HoopRushManifest,
  franchiseId: string,
  eraId: string,
): string | null {
  return eraIdentityOf(manifest, franchiseId, eraId).displayLabel;
}

export function faceOf(
  faces: ReadonlyMap<string, FaceRef> | null | undefined,
  playerVersionId: string,
): FaceRef | null {
  return faces?.get(playerVersionId) ?? null;
}

export function teamLabelFor(
  manifest: HoopRushManifest,
  franchiseId: string,
  eraId: string,
): string {
  const identity = resolveEraTeamIdentity(manifest, franchiseId, eraId);
  return identity.abbreviationLabel ?? franchiseAbbreviation(franchiseId);
}

export function teamNameFor(
  manifest: HoopRushManifest,
  franchiseNames: ReadonlyMap<string, string>,
  franchiseId: string,
  eraId: string,
): string {
  const identity = resolveEraTeamIdentity(manifest, franchiseId, eraId);
  return identity.displayLabel ?? franchiseNames.get(franchiseId) ?? franchiseId;
}

export function teamExternalIdOf(manifest: HoopRushManifest | null, franchiseId: string): string {
  if (manifest === null) return '';
  return franchiseIdentityOf(manifest, franchiseId)?.teamExternalId ?? '';
}

export function eraName(manifest: HoopRushManifest | null, eraId: string): string {
  return manifest?.eras.find((era) => era.eraId === eraId)?.label ?? eraId;
}
