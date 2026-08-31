import { franchiseAbbreviation } from './franchise.ts';
import type { FranchiseLineageEntry } from './franchise.ts';
import type { HoopRushManifest } from './manifest.ts';
const INFINITE_SEASON = '9999-99';
export interface HistoricalIdentitySpan {
  segment: FranchiseLineageEntry;
  displayName: string;
  city: string;
  abbreviation: string | null;
  fromSeasonKey: string;
  throughSeasonKey: string;
  logoCandidates: string[];
}
export interface EraTeamIdentity {
  spans: HistoricalIdentitySpan[];
  displayLabel: string | null;
  abbreviationLabel: string | null;
  logoCandidates: string[];
}
function maxSeason(a: string, b: string): string {
  return a >= b ? a : b;
}
function minSeason(a: string, b: string): string {
  return a <= b ? a : b;
}
export function resolveHistoricalIdentitySpans(
  manifest: HoopRushManifest,
  franchiseId: string,
  eraId: string,
): HistoricalIdentitySpan[] {
  const era = manifest.eras.find((entry) => entry.eraId === eraId);
  if (!era) return [];
  const spans: HistoricalIdentitySpan[] = [];
  for (const segment of manifest.franchiseLineage) {
    if (segment.modernFranchiseId !== franchiseId) continue;
    const fromSeasonKey = maxSeason(segment.validFromSeasonKey, era.fromSeasonKey);
    const throughSeasonKey = minSeason(
      segment.validThroughSeasonKey ?? INFINITE_SEASON,
      era.toSeasonKey,
    );
    if (fromSeasonKey > throughSeasonKey) continue;
    spans.push({
      segment,
      displayName: segment.displayName,
      city: segment.city,
      abbreviation: segment.abbreviation ?? null,
      fromSeasonKey,
      throughSeasonKey,
      logoCandidates: (segment.logoCandidates ?? []).map((candidate) => candidate.url),
    });
  }
  spans.sort((a, b) => a.fromSeasonKey.localeCompare(b.fromSeasonKey));
  return spans;
}
const eraIdentityCache = new WeakMap<HoopRushManifest, Map<string, EraTeamIdentity>>();
export function resolveEraTeamIdentity(
  manifest: HoopRushManifest,
  franchiseId: string,
  eraId: string,
): EraTeamIdentity {
  let byKey = eraIdentityCache.get(manifest);
  if (byKey === undefined) {
    byKey = new Map();
    eraIdentityCache.set(manifest, byKey);
  }
  const key = `${franchiseId}\0${eraId}`;
  const cached = byKey.get(key);
  if (cached !== undefined) return cached;
  const identity = computeEraTeamIdentity(manifest, franchiseId, eraId);
  byKey.set(key, identity);
  return identity;
}
function computeEraTeamIdentity(
  manifest: HoopRushManifest,
  franchiseId: string,
  eraId: string,
): EraTeamIdentity {
  const spans = resolveHistoricalIdentitySpans(manifest, franchiseId, eraId);
  if (spans.length === 0) {
    return { spans, displayLabel: null, abbreviationLabel: null, logoCandidates: [] };
  }
  const displayLabel = spans.map((span) => span.displayName).join(' → ');
  const abbreviationLabel = spans
    .map((span) => span.abbreviation ?? franchiseAbbreviation(franchiseId))
    .join(' → ');
  const first = spans[0];
  const last = spans[spans.length - 1];
  const logoCandidates: string[] = [];
  if (first) {
    for (const url of first.logoCandidates) {
      if (!logoCandidates.includes(url)) logoCandidates.push(url);
    }
  }
  if (last && last !== first) {
    for (const url of last.logoCandidates) {
      if (!logoCandidates.includes(url)) logoCandidates.push(url);
    }
  }
  return { spans, displayLabel, abbreviationLabel, logoCandidates };
}
