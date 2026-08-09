import { franchiseAbbreviation } from './franchise.ts';
import type { FranchiseLineageEntry } from './franchise.ts';
import type { HoopRushManifest } from './manifest.ts';

/**
 * Era-scoped historical team identity resolution (spec/12). Given the
 * manifest's lineage table, a modern franchise slot, and an era, this module
 * returns the historical identities that owned the slot during the era,
 * clamped to the era's season range and ordered chronologically.
 *
 * Callers use `resolveEraTeamIdentity` and fall back to the modern slot
 * identity when the era has no lineage (`spans` empty). Display labels join
 * multi-identity eras with " → " ("Seattle SuperSonics → Oklahoma City
 * Thunder"); logo candidates come from the first and last identities so a
 * crossover decade shows both historical marks. Pure TypeScript: no Svelte,
 * DOM, or network access.
 */

/** The largest season key any lineage segment may own (current segments have none). */
const INFINITE_SEASON = '9999-99';

/** One historical identity active within an era, clamped to the era range. */
export interface HistoricalIdentitySpan {
  /** The manifest lineage segment that owns this span. */
  segment: FranchiseLineageEntry;
  /** Historical display name (e.g. "Seattle SuperSonics"). */
  displayName: string;
  /** Historical city (e.g. "Seattle"). */
  city: string;
  /** Historical abbreviation when the segment publishes one. */
  abbreviation: string | null;
  /** First season of this identity within the era, inclusive. */
  fromSeasonKey: string;
  /** Last season of this identity within the era, inclusive. */
  throughSeasonKey: string;
  /** Ordered verified logo candidates for this identity. */
  logoCandidates: string[];
}

/** Resolved era identity: spans plus display helpers, empty when unavailable. */
export interface EraTeamIdentity {
  /** Chronological identities active within the era; empty when none. */
  spans: HistoricalIdentitySpan[];
  /**
   * Historical display names joined with " → "
   * ("Seattle SuperSonics → Oklahoma City Thunder"), or null when the era
   * has no lineage for the slot.
   */
  displayLabel: string | null;
  /**
   * Historical abbreviations joined with " → " ("SEA → OKC"), or null when
   * the era has no lineage for the slot.
   */
  abbreviationLabel: string | null;
  /**
   * Ordered logo candidates across the era: the first identity's candidates
   * followed by the last identity's (deduplicated). Empty when unavailable.
   */
  logoCandidates: string[];
}

function maxSeason(a: string, b: string): string {
  return a >= b ? a : b;
}

function minSeason(a: string, b: string): string {
  return a <= b ? a : b;
}

/**
 * All lineage segments owned by the slot that overlap the era, clamped to
 * the era's inclusive season range and ordered chronologically. A gap inside
 * the era (e.g. the Charlotte Hornets 2002-03/2003-04 suspension) simply
 * produces non-adjacent spans.
 */
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

/**
 * The era-scoped identity for a franchise slot, with display labels and logo
 * candidates ready for UI consumption. `spans` empty means the slot has no
 * NBA lineage in the era; callers then keep the modern slot identity.
 *
 * Memoized per manifest identity and (franchise, era) key: the league/roster
 * pages resolve identities for the same manifest thousands of times, and the
 * manifest is immutable for the lifetime of a loaded session. The returned
 * object is shared; callers must treat it as read-only.
 */
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
