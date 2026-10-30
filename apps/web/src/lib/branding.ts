import {
  franchiseAbbreviation,
  resolveEraTeamIdentity,
  type HoopRushManifest,
} from '@hoop-rush/data-contracts';

export interface FranchiseIdentity {
  franchiseId: string;
  displayName: string;
  abbreviation: string;
  teamExternalId: string;
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

export function eraName(manifest: HoopRushManifest | null, eraId: string): string {
  return manifest?.eras.find((era) => era.eraId === eraId)?.label ?? eraId;
}
