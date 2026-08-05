import { describe, expect, it } from 'vitest';
import type { HoopRushManifest, FranchiseLineageEntry } from './index.ts';
import { resolveEraTeamIdentity, resolveHistoricalIdentitySpans } from './historical-identity.ts';

/**
 * Compact manifest builder for identity-resolution tests. The lineage set
 * mirrors the authoritative table (spec/12) for the franchises under test.
 */

const logo = (url: string) => ({ url, source: 'sportslogos' });
const cdn = (id: string) => ({
  url: `https://cdn.nba.com/logos/nba/${id}/global/L/logo.svg`,
  source: 'nba-cdn',
});

function segment(
  modernFranchiseId: string,
  displayName: string,
  abbreviation: string,
  from: string,
  to?: string,
  logos = [cdn('1610610000')],
): FranchiseLineageEntry {
  return {
    modernFranchiseId,
    historicalTeamId: '1610610000',
    validFromSeasonKey: from,
    ...(to !== undefined ? { validThroughSeasonKey: to } : {}),
    displayName,
    city: displayName.split(' ')[0] ?? '',
    abbreviation,
    sourceIdentityIds: ['1610610000'],
    lineageRuleVersion: 'lineage-v1',
    logoCandidates: logos,
  };
}

function manifest(lineage: FranchiseLineageEntry[]): HoopRushManifest {
  return {
    schemaVersion: 4,
    dataVersion: 'test-v1',
    modernFranchiseSlots: [
      {
        franchiseId: 'thunder',
        displayName: 'Oklahoma City Thunder',
        teamExternalId: '1610612760',
      },
      { franchiseId: 'celtics', displayName: 'Boston Celtics', teamExternalId: '1610612738' },
      { franchiseId: 'grizzlies', displayName: 'Memphis Grizzlies', teamExternalId: '1610612763' },
      { franchiseId: 'kings', displayName: 'Sacramento Kings', teamExternalId: '1610612758' },
      { franchiseId: 'hornets', displayName: 'Charlotte Hornets', teamExternalId: '1610612766' },
      { franchiseId: 'raptors', displayName: 'Toronto Raptors', teamExternalId: '1610612761' },
    ],
    franchiseLineage: lineage,
    eras: [
      { eraId: '1960s', label: '1960s', fromSeasonKey: '1960-61', toSeasonKey: '1969-70' },
      { eraId: '1970s', label: '1970s', fromSeasonKey: '1970-71', toSeasonKey: '1979-80' },
      { eraId: '1980s', label: '1980s', fromSeasonKey: '1980-81', toSeasonKey: '1989-90' },
      { eraId: '1990s', label: '1990s', fromSeasonKey: '1990-91', toSeasonKey: '1999-00' },
      { eraId: '2000s', label: '2000s', fromSeasonKey: '2000-01', toSeasonKey: '2009-10' },
      { eraId: '2010s', label: '2010s', fromSeasonKey: '2010-11', toSeasonKey: '2019-20' },
      { eraId: '2020s', label: '2020s', fromSeasonKey: '2020-21', toSeasonKey: '2029-30' },
    ],
    pools: [],
    availability: [],
    eraSimulationProfiles: [],
    assets: {
      headshotUrlTemplate: null,
      headshotUrlTemplateSecondary: null,
      logoUrlTemplate: null,
      logoUrlTemplateSecondary: null,
      source: 'test',
      cacheVersion: 'test-v1',
    },
  };
}

const FULL_LINEAGE: FranchiseLineageEntry[] = [
  // Thunder: Seattle SuperSonics through 2007-08, Oklahoma City from 2008-09
  segment('thunder', 'Seattle SuperSonics', 'SEA', '1967-68', '2007-08', [
    logo('https://example.com/sea-1.png'),
    logo('https://example.com/sea-2.png'),
  ]),
  segment('thunder', 'Oklahoma City Thunder', 'OKC', '2008-09', undefined, [
    logo('https://example.com/okc-1.png'),
  ]),
  // Celtics: one identity for the whole era range
  segment('celtics', 'Boston Celtics', 'BOS', '1946-47', undefined),
  // Grizzlies: Vancouver then Memphis
  segment('grizzlies', 'Vancouver Grizzlies', 'VAN', '1995-96', '2000-01', [
    logo('https://example.com/van-1.png'),
  ]),
  segment('grizzlies', 'Memphis Grizzlies', 'MEM', '2001-02', undefined),
  // Kings: four identities across the 1970s
  segment('kings', 'Cincinnati Royals', 'CIN', '1957-58', '1971-72', [
    logo('https://example.com/cin-1.png'),
  ]),
  segment('kings', 'Kansas City-Omaha Kings', 'KCO', '1972-73', '1974-75', [
    logo('https://example.com/kco-1.png'),
  ]),
  segment('kings', 'Kansas City Kings', 'KCK', '1975-76', '1984-85', [
    logo('https://example.com/kck-1.png'),
  ]),
  segment('kings', 'Sacramento Kings', 'SAC', '1985-86', undefined),
  // Hornets: original era, suspension gap, Bobcats
  segment('hornets', 'Charlotte Hornets', 'CHH', '1988-89', '2001-02', [
    logo('https://example.com/chh-1.png'),
  ]),
  segment('hornets', 'Charlotte Bobcats', 'CHA', '2004-05', '2013-14', [
    logo('https://example.com/cha-1.png'),
  ]),
];

describe('resolveHistoricalIdentitySpans', () => {
  it('resolves the inclusive SuperSonics/Thunder boundary inside the 2000s era', () => {
    const spans = resolveHistoricalIdentitySpans(manifest(FULL_LINEAGE), 'thunder', '2000s');
    expect(spans).toHaveLength(2);
    expect(spans[0]?.displayName).toBe('Seattle SuperSonics');
    expect(spans[0]?.fromSeasonKey).toBe('2000-01');
    expect(spans[0]?.throughSeasonKey).toBe('2007-08');
    expect(spans[1]?.displayName).toBe('Oklahoma City Thunder');
    expect(spans[1]?.fromSeasonKey).toBe('2008-09');
    expect(spans[1]?.throughSeasonKey).toBe('2009-10');
  });

  it('keeps SuperSonics through 2007-08 and Thunder from 2008-09 (inclusive edges)', () => {
    const spans = resolveHistoricalIdentitySpans(manifest(FULL_LINEAGE), 'thunder', '2000s');
    const sea = spans[0];
    const okc = spans[1];
    expect(sea?.segment.validThroughSeasonKey).toBe('2007-08');
    expect(okc?.segment.validFromSeasonKey).toBe('2008-09');
  });

  it('clamps a same-name era to the era range', () => {
    const spans = resolveHistoricalIdentitySpans(manifest(FULL_LINEAGE), 'celtics', '1990s');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.displayName).toBe('Boston Celtics');
    expect(spans[0]?.fromSeasonKey).toBe('1990-91');
    expect(spans[0]?.throughSeasonKey).toBe('1999-00');
  });

  it('resolves a renamed/relocated era with both identities', () => {
    const spans = resolveHistoricalIdentitySpans(manifest(FULL_LINEAGE), 'grizzlies', '2000s');
    expect(spans.map((s) => s.displayName)).toEqual(['Vancouver Grizzlies', 'Memphis Grizzlies']);
    expect(spans[0]?.fromSeasonKey).toBe('2000-01');
    expect(spans[0]?.throughSeasonKey).toBe('2000-01');
    expect(spans[1]?.fromSeasonKey).toBe('2001-02');
    expect(spans[1]?.throughSeasonKey).toBe('2009-10');
  });

  it('resolves a three-identity crossover era (Kings 1970s)', () => {
    const spans = resolveHistoricalIdentitySpans(manifest(FULL_LINEAGE), 'kings', '1970s');
    expect(spans.map((s) => s.displayName)).toEqual([
      'Cincinnati Royals',
      'Kansas City-Omaha Kings',
      'Kansas City Kings',
    ]);
    expect(spans[0]?.fromSeasonKey).toBe('1970-71');
    expect(spans[0]?.throughSeasonKey).toBe('1971-72');
    expect(spans[1]?.throughSeasonKey).toBe('1974-75');
    expect(spans[2]?.fromSeasonKey).toBe('1975-76');
  });

  it('produces non-adjacent spans across an era gap (Hornets 2000s)', () => {
    const spans = resolveHistoricalIdentitySpans(manifest(FULL_LINEAGE), 'hornets', '2000s');
    expect(spans.map((s) => s.displayName)).toEqual(['Charlotte Hornets', 'Charlotte Bobcats']);
    expect(spans[0]?.throughSeasonKey).toBe('2001-02');
    expect(spans[1]?.fromSeasonKey).toBe('2004-05');
  });

  it('returns an empty span list when the slot has no lineage in the era', () => {
    const spans = resolveHistoricalIdentitySpans(manifest(FULL_LINEAGE), 'raptors', '1960s');
    expect(spans).toEqual([]);
  });

  it('returns an empty span list for an unknown era id', () => {
    const spans = resolveHistoricalIdentitySpans(manifest(FULL_LINEAGE), 'celtics', '1940s');
    expect(spans).toEqual([]);
  });

  it('orders spans chronologically regardless of table order', () => {
    const reversed = manifest([...FULL_LINEAGE].reverse());
    const spans = resolveHistoricalIdentitySpans(reversed, 'thunder', '2000s');
    expect(spans[0]?.displayName).toBe('Seattle SuperSonics');
    expect(spans[1]?.displayName).toBe('Oklahoma City Thunder');
  });
});

describe('resolveEraTeamIdentity', () => {
  it('joins display names and abbreviations of a crossover era', () => {
    const identity = resolveEraTeamIdentity(manifest(FULL_LINEAGE), 'thunder', '2000s');
    expect(identity.displayLabel).toBe('Seattle SuperSonics → Oklahoma City Thunder');
    expect(identity.abbreviationLabel).toBe('SEA → OKC');
    expect(identity.logoCandidates).toEqual([
      'https://example.com/sea-1.png',
      'https://example.com/sea-2.png',
      'https://example.com/okc-1.png',
    ]);
  });

  it('orders first-identity logos before last-identity logos, deduplicated', () => {
    const identity = resolveEraTeamIdentity(manifest(FULL_LINEAGE), 'kings', '1970s');
    expect(identity.logoCandidates).toEqual([
      'https://example.com/cin-1.png',
      'https://example.com/kck-1.png',
    ]);
  });

  it('returns a single-identity label for a same-name era', () => {
    const identity = resolveEraTeamIdentity(manifest(FULL_LINEAGE), 'celtics', '1990s');
    expect(identity.displayLabel).toBe('Boston Celtics');
    expect(identity.abbreviationLabel).toBe('BOS');
    expect(identity.spans).toHaveLength(1);
  });

  it('returns empty labels and logos when the era has no lineage', () => {
    const identity = resolveEraTeamIdentity(manifest(FULL_LINEAGE), 'raptors', '1960s');
    expect(identity.spans).toEqual([]);
    expect(identity.displayLabel).toBeNull();
    expect(identity.abbreviationLabel).toBeNull();
    expect(identity.logoCandidates).toEqual([]);
  });

  it('falls back to the modern abbreviation for a segment without one', () => {
    const m = manifest([
      segment('thunder', 'Seattle SuperSonics', 'SEA', '1967-68', '2007-08'),
      { ...segment('thunder', 'Oklahoma City Thunder', 'OKC', '2008-09'), abbreviation: undefined },
    ]);
    const identity = resolveEraTeamIdentity(m, 'thunder', '2010s');
    expect(identity.abbreviationLabel).toBe('OKC');
  });

  it('handles segments without logo metadata gracefully', () => {
    const m = manifest([
      {
        ...segment('thunder', 'Seattle SuperSonics', 'SEA', '1967-68', '2007-08'),
        logoCandidates: undefined,
      },
    ]);
    const identity = resolveEraTeamIdentity(m, 'thunder', '2000s');
    expect(identity.displayLabel).toBe('Seattle SuperSonics');
    expect(identity.logoCandidates).toEqual([]);
  });
});
