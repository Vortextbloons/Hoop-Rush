import { describe, expect, it } from 'vitest';
import { derivePlayerRecord, fieldPublished, type DerivationInput } from './v2.js';
import { computeSummaryRatings } from './summary.js';
import type { StatsRow } from './stats.js';

const MODERN = { leaguePpg: 110, league3PARate: 0.36, pace: 99 };

function input(
  season: string,
  stats: Record<string, unknown>,
  position = 'SG',
  overrides: Partial<DerivationInput> = {},
): DerivationInput {
  return {
    season,
    position,
    heightInches: 79,
    stats: stats as StatsRow,
    era: MODERN,
    ...overrides,
  };
}

/** Full modern-style season totals for a solid starter. */
function starterStats(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gamesPlayed: 78,
    minutes: 2850,
    points: 1680,
    rebounds: 420,
    offensiveRebounds: 80,
    defensiveRebounds: 340,
    assists: 310,
    steals: 95,
    blocks: 30,
    turnovers: 210,
    fouls: 180,
    fgm: 630,
    fga: 1350,
    tpm: 160,
    tpa: 410,
    ftm: 260,
    fta: 310,
    per: 19.5,
    boxPlusMinus: 3.1,
    usageRate: 25,
    tsPct: 0.57,
    efgPct: 0.526,
    ...over,
  };
}

/** The pre-1979 field families are absent from the raw row (null). */
function pre1974Stats(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gamesPlayed: 78,
    minutes: 2850,
    points: 1680,
    rebounds: 420,
    offensiveRebounds: null,
    defensiveRebounds: null,
    assists: 310,
    steals: null,
    blocks: null,
    turnovers: null,
    fouls: 180,
    fgm: 630,
    fga: 1350,
    tpm: null,
    tpa: null,
    ftm: 260,
    fta: 310,
    per: null,
    boxPlusMinus: null,
    usageRate: null,
    tsPct: null,
    efgPct: null,
    ...over,
  };
}

describe('derivePlayerRecord (field-method registry)', () => {
  it('produces the strict engine contracts with no extra keys', () => {
    const derived = derivePlayerRecord(input('1996-97', starterStats()));
    expect(Object.keys(derived.ratings)).toHaveLength(18);
    expect(Object.keys(derived.tendencies)).toHaveLength(23);
    expect(derived.ratings).not.toHaveProperty('overall');
    expect(derived.ratings).not.toHaveProperty('stamina');
    expect(derived.ratings.threePoint).toBeGreaterThan(50);
    expect(derived.ratings.passing).toBeGreaterThan(60);
    expect(derived.tendencies.threePointRate).toBeCloseTo((410 / 1350) * 100, 0);
    expect(derived.anchors.threePointPct).toBeCloseTo(160 / 410, 6);
  });

  it('is deterministic: no random jitter, same inputs same outputs', () => {
    const stats = starterStats();
    const a = derivePlayerRecord(input('1996-97', stats));
    const b = derivePlayerRecord(input('1996-97', stats));
    expect(a.ratings).toEqual(b.ratings);
    expect(a.tendencies).toEqual(b.tendencies);
    expect(a.anchors).toEqual(b.anchors);
    expect(a.provenance).toEqual(b.provenance);
  });

  it('records provenance on every required field with versions', () => {
    const derived = derivePlayerRecord(input('1996-97', starterStats()));
    for (const field of Object.keys(derived.ratings)) {
      const provenance = derived.provenance[field];
      expect(provenance?.kind).toBeDefined();
      expect(provenance?.methodVersion).toBe('derive-v1');
      expect(provenance?.sourceVersion).toBe('source-v1');
      expect(provenance?.sourceFields.length).toBeGreaterThan(0);
    }
    // Observed three-point shooting is derived, not estimated.
    expect(derived.provenance['threePoint']?.kind).toBe('derived');
    expect(derived.provenance['threePoint']?.sourceFields).toContain('tpm');
  });

  it('keeps unclamped diagnostic values alongside final values', () => {
    const derived = derivePlayerRecord(input('1996-97', starterStats({ points: 78 * 40 })));
    expect(derived.ratings.insideScoring).toBeLessThanOrEqual(100);
    // The unclamped raw value must exist and may exceed the clamp.
    expect(typeof derived.unclamped['insideScoring']).toBe('number');
    expect(derived.unclamped['insideScoring']).toBeGreaterThanOrEqual(derived.ratings.insideScoring);
  });

  it('pre-1974 defensive events are estimated with not-applicable provenance', () => {
    const derived = derivePlayerRecord(input('1970-71', pre1974Stats()));
    expect(derived.provenance['steal']?.kind).toBe('estimated');
    expect(derived.provenance['steal']?.sourceStatus).toBe('not-applicable');
    expect(derived.provenance['block']?.kind).toBe('estimated');
    // Anchors still carry numbers (reconstructed), never zero-claims.
    expect(derived.anchors.stealsPerGame).toBeGreaterThan(0);
    expect(derived.anchors.blocksPerGame).toBeGreaterThan(0);
  });

  it('pre-1979 three-point evidence is not-applicable and never an observed zero', () => {
    const derived = derivePlayerRecord(input('1977-78', pre1974Stats()));
    expect(derived.provenance['threePoint']?.sourceStatus).toBe('not-applicable');
    expect(derived.provenance['threePoint']?.kind).toBe('estimated');
    expect(derived.anchors.threePointPct).toBeNull();
    expect(derived.tendencies.threePointRate).toBe(0); // league rule: the shot did not exist
  });

  it('pre-1978 turnovers are estimated from usage context', () => {
    const derived = derivePlayerRecord(input('1975-76', pre1974Stats()));
    expect(derived.provenance['turnoverRate']?.kind).toBe('estimated');
    expect(derived.anchors.turnoversPerGame).toBeGreaterThan(0);
  });

  it('1973-74+ rebound splits and defensive events are observed and derive ratings', () => {
    const derived = derivePlayerRecord(
      input('1975-76', pre1974Stats({ steals: 95, blocks: 30, offensiveRebounds: 80, defensiveRebounds: 340 })),
    );
    expect(derived.provenance['steal']?.kind).toBe('derived');
    expect(derived.provenance['defensiveRebound']?.kind).toBe('derived');
    expect(derived.provenance['offensiveRebound']?.kind).toBe('derived');
  });

  it('caps three-point anchor rate when made exceeds attempts', () => {
    const derived = derivePlayerRecord(
      input(
        '1985-86',
        starterStats({ tpm: 3, tpa: 2 }),
      ),
    );
    expect(derived.anchors.threePointPct).toBe(1);
  });

  it('summary overall uses production-aware real overall, not only the skill blend', () => {
    const derived = derivePlayerRecord(
      input(
        '1996-97',
        starterStats({
          points: 2400,
          per: 28,
          boxPlusMinus: 8,
          usageRate: 32,
          tsPct: 0.62,
        }),
        'SG',
      ),
    );
    const skillOnly = computeSummaryRatings(
      derived.ratings as unknown as Record<string, number>,
      derived.tendencies as unknown as Record<string, number>,
    );
    expect(derived.summaryRatings.overallRating).toBeGreaterThan(skillOnly.overallRating);
  });

  it('fieldPublished follows the source availability table (inclusive first season)', () => {
    expect(fieldPublished('steals', '1972-73')).toBe(false);
    expect(fieldPublished('steals', '1973-74')).toBe(true);
    expect(fieldPublished('turnovers', '1976-77')).toBe(false);
    expect(fieldPublished('turnovers', '1977-78')).toBe(true);
    expect(fieldPublished('threesAttempted', '1979-80')).toBe(true);
    expect(fieldPublished('threesAttempted', '1978-79')).toBe(false);
    expect(fieldPublished('points', '1960-61')).toBe(true);
  });

  it('rating kind follows evidence: high-sample observed inputs derive; sparse inputs estimate', () => {
    // Full modern evidence -> derived defensive ratings.
    const full = derivePlayerRecord(input('1996-97', starterStats()));
    expect(full.provenance['perimeterDefense']?.kind).toBe('derived');
    // Pre-1974 -> estimated.
    const early = derivePlayerRecord(input('1970-71', pre1974Stats()));
    expect(early.provenance['perimeterDefense']?.kind).toBe('estimated');
  });
});
