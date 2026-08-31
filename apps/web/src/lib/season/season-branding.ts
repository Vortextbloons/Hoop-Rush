import {
  franchiseAbbreviation,
  resolveEraTeamIdentity,
  type HoopRushManifest,
  type PlayersIndexAltIds,
  type PlayersIndexEntry,
  type SeasonDraftCatalog,
  type SeasonDraftCandidate,
  type SeasonFreeAgencyCandidate,
  type SeasonFreeAgencyState,
} from '@hoop-rush/data-contracts';
export interface SeasonFaceRef {
  playerId: string;
  playerExternalId: string;
  altIds: PlayersIndexAltIds;
  initials: string;
}
export interface SeasonVersionTuple {
  playerVersionId: string;
  playerId: string;
  franchiseId: string;
  eraId: string;
  seasonKey: string;
  displayName: string;
}
export function versionTupleOfRosterEntry(
  entry: SeasonVersionTuple,
  catalogCandidate?: Pick<SeasonDraftCandidate, 'franchiseId' | 'eraId' | 'seasonKey'> | null,
): SeasonVersionTuple {
  return {
    playerVersionId: entry.playerVersionId,
    playerId: entry.playerId,
    franchiseId: catalogCandidate?.franchiseId ?? entry.franchiseId,
    eraId: catalogCandidate?.eraId ?? entry.eraId,
    seasonKey: catalogCandidate?.seasonKey ?? entry.seasonKey,
    displayName: entry.displayName,
  };
}
export function catalogCandidateOfFreeAgency(
  catalog: SeasonDraftCatalog,
  candidate: SeasonFreeAgencyCandidate,
): SeasonDraftCandidate | null {
  const { catalogRef } = candidate;
  if (
    catalog.catalogVersion === catalogRef.catalogVersion &&
    catalog.dataVersion === catalogRef.dataVersion
  ) {
    const byIndex = catalog.candidates[catalogRef.candidateIndex];
    if (
      byIndex !== undefined &&
      byIndex.playerVersionId === candidate.playerVersionId &&
      byIndex.playerId === candidate.playerId
    ) {
      return byIndex;
    }
  }
  return (
    catalog.candidates.find((entry) => entry.playerVersionId === candidate.playerVersionId) ?? null
  );
}
export function freeAgencyVersionTuples(
  freeAgency: SeasonFreeAgencyState | null | undefined,
  catalog: SeasonDraftCatalog | null,
): SeasonVersionTuple[] {
  if (freeAgency === null || freeAgency === undefined || catalog === null) return [];
  const tuples: SeasonVersionTuple[] = [];
  for (const window of freeAgency.windows) {
    for (const candidate of window.candidates) {
      const catalogCandidate = catalogCandidateOfFreeAgency(catalog, candidate);
      if (catalogCandidate === null) continue;
      tuples.push({
        playerVersionId: candidate.playerVersionId,
        playerId: catalogCandidate.playerId,
        franchiseId: catalogCandidate.franchiseId,
        eraId: catalogCandidate.eraId,
        seasonKey: catalogCandidate.seasonKey,
        displayName: catalogCandidate.displayName,
      });
    }
  }
  return tuples;
}
export function mergeFreeAgencyFaces(
  playersIndex: readonly PlayersIndexEntry[] | null,
  catalog: SeasonDraftCatalog | null,
  freeAgency: SeasonFreeAgencyState | null | undefined,
  rosterFaces: ReadonlyMap<string, SeasonFaceRef>,
): Map<string, SeasonFaceRef> {
  if (
    playersIndex === null ||
    catalog === null ||
    freeAgency === null ||
    freeAgency === undefined
  ) {
    return new Map(rosterFaces);
  }
  const tuples = freeAgencyVersionTuples(freeAgency, catalog);
  if (tuples.length === 0) return new Map(rosterFaces);
  const merged = new Map(rosterFaces);
  for (const [playerVersionId, face] of buildVersionFaceIndex(playersIndex, tuples)) {
    merged.set(playerVersionId, face);
  }
  return merged;
}
export interface SeasonFranchiseIdentity {
  franchiseId: string;
  displayName: string;
  abbreviation: string;
  teamExternalId: string;
}
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
