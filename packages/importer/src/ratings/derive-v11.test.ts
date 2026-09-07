import { describe, expect, it } from 'vitest';
import { derivePlayerRecord, type DerivationInput } from './v2.ts';
import { MODERN_ERA, starterStats } from './ratings-test-support.ts';

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
    stats,
    era: MODERN_ERA,
    ...overrides,
  };
}

describe('derive-v11 ability-vs-opportunity separation', () => {
  it('gives equal per-minute producers equal ability ratings across workloads', () => {
    const full = derivePlayerRecord(
      input('2023-24', starterStats({ gamesPlayed: 78, minutes: 2808 })),
    );
    const half = derivePlayerRecord(
      input(
        '2023-24',
        starterStats({
          gamesPlayed: 78,
          minutes: 1404,
          points: 840,
          rebounds: 210,
          offensiveRebounds: 40,
          defensiveRebounds: 170,
          assists: 155,
          steals: 48,
          blocks: 15,
          turnovers: 105,
          fgm: 315,
          fga: 675,
          tpm: 80,
          tpa: 205,
          ftm: 130,
          fta: 155,
        }),
      ),
    );
    for (const field of ['steal', 'passing', 'offensiveRebound', 'defensiveRebound'] as const) {
      expect(
        Math.abs(full.ratings[field] - half.ratings[field]),
        `${field} ability should not depend on minutes`,
      ).toBeLessThanOrEqual(6);
    }
    expect(half.provenance['steal']?.confidence).not.toBe('high');
    expect(half.tendencies.usageRate).toBeCloseTo(full.tendencies.usageRate, 0);
    expect(half.anchors.minutesPerGame).toBeLessThan(full.anchors.minutesPerGame);
  });
  it('uses rebound chances when available and marks the fallback', () => {
    const withChances = derivePlayerRecord(
      input('2023-24', starterStats({ offRebChances: 320, defRebChances: 900 })),
    );
    expect(withChances.provenance['offensiveRebound']?.sourceFields).toContain('offRebChances');
    expect(withChances.provenance['defensiveRebound']?.sourceFields).toContain('defRebChances');
    const withoutChances = derivePlayerRecord(input('2023-24', starterStats()));
    expect(withoutChances.provenance['offensiveRebound']?.notesCode).toBe('no-rebound-chances');
  });
  it('keeps workload and volume in tendencies and anchors, not ability', () => {
    const derived = derivePlayerRecord(input('2023-24', starterStats()));
    expect(derived.tendencies.shotRate).toBeGreaterThan(0);
    expect(derived.anchors.pointsPerGame).toBeCloseTo(1680 / 78, 5);
    expect(derived.provenance['usageRate']?.kind).toBe('observed');
  });
});

describe('derive-v11 shooting attribution', () => {
  it('prefers observed zone efficiency over volume for close/inside/mid', () => {
    const zoned = derivePlayerRecord(
      input(
        '2023-24',
        starterStats({
          closeFgm: 320,
          closeFga: 460,
          insideFgm: 380,
          insideFga: 640,
          midFgm: 120,
          midFga: 260,
        }),
        'C',
      ),
    );
    expect(zoned.provenance['closeShot']?.sourceFields).toContain('closeFga');
    expect(zoned.provenance['insideScoring']?.sourceFields).toContain('insideFga');
    expect(zoned.provenance['midrange']?.sourceFields).toContain('midFga');
    expect(zoned.ratings.closeShot).toBeGreaterThan(70);
    const noZones = derivePlayerRecord(input('2023-24', starterStats(), 'C'));
    expect(noZones.provenance['closeShot']?.notesCode).toBe('no-shot-location');
    expect(noZones.provenance['insideScoring']?.notesCode).toBe('no-shot-location');
  });
  it('lets well-observed three-point accuracy stand without TS%/FT% help', () => {
    const elite = derivePlayerRecord(
      input('2023-24', starterStats({ tpm: 300, tpa: 680, tsPct: 0.5, ftm: 100, fta: 200 })),
    );
    const average = derivePlayerRecord(
      input('2023-24', starterStats({ tpm: 150, tpa: 450, tsPct: 0.65, ftm: 280, fta: 320 })),
    );
    expect(elite.ratings.threePoint).toBeGreaterThan(average.ratings.threePoint + 10);
  });
});

describe('derive-v11 passing and handling', () => {
  it('grades creation without a PER bonus and protects high-creation ball security', () => {
    const creator = derivePlayerRecord(
      input('2023-24', starterStats({ assists: 700, turnovers: 320, usageRate: 30 }), 'PG'),
    );
    const role = derivePlayerRecord(
      input('2023-24', starterStats({ assists: 120, turnovers: 60, usageRate: 14 }), 'C'),
    );
    expect(creator.ratings.passing).toBeGreaterThan(role.ratings.passing + 10);
    expect(creator.ratings.ballHandling).toBeGreaterThan(role.ratings.ballHandling);
    const sameCreationMoreTurnovers = derivePlayerRecord(
      input('2023-24', starterStats({ assists: 700, turnovers: 500, usageRate: 30 }), 'PG'),
    );
    expect(creator.ratings.ballHandling).toBeGreaterThan(
      sameCreationMoreTurnovers.ratings.ballHandling,
    );
  });
  it('defines offensive IQ from decision quality, not PER/BPM', () => {
    const derived = derivePlayerRecord(input('2023-24', starterStats()));
    expect(derived.provenance['offensiveIq']?.sourceFields).toEqual(
      expect.arrayContaining(['assists', 'usageRate', 'turnovers', 'tsPct', 'minutes']),
    );
    expect(derived.provenance['offensiveIq']?.sourceFields).not.toContain('per');
    expect(derived.provenance['offensiveIq']?.sourceFields).not.toContain('boxPlusMinus');
  });
});

describe('derive-v11 evidence-limited defense and athleticism', () => {
  it('marks pre-1974 blocks as a positional prior, not historical evidence', () => {
    const wiltLike = derivePlayerRecord(
      input(
        '1962-63',
        {
          gamesPlayed: 80,
          minutes: 3806,
          points: 3586,
          rebounds: 1946,
          assists: 200,
          steals: null,
          blocks: null,
          turnovers: null,
          fouls: 120,
          fgm: 1400,
          fga: 2700,
          tpm: null,
          tpa: null,
          ftm: 700,
          fta: 1100,
        },
        'C',
        { heightInches: 85 },
      ),
    );
    expect(wiltLike.provenance['block']?.notesCode).toBe('positional-prior-pre1974');
    expect(wiltLike.provenance['block']?.confidence).toBe('low');
    expect(wiltLike.provenance['interiorDefense']?.confidence).toBe('low');
    expect(wiltLike.provenance['vertical']?.confidence).toBe('low');
    expect(wiltLike.ratings.block).toBeLessThan(100);
  });
  it('does not boost speed from minutes, usage, or position reputation', () => {
    const lowMinutes = derivePlayerRecord(
      input('2023-24', starterStats({ minutes: 900, usageRate: 30, steals: 120 }), 'PG', {
        heightInches: 74,
      }),
    );
    const highMinutes = derivePlayerRecord(
      input('2023-24', starterStats({ minutes: 2800, usageRate: 16, steals: 40 }), 'PG', {
        heightInches: 74,
      }),
    );
    expect(Math.abs(lowMinutes.ratings.speed - highMinutes.ratings.speed)).toBeLessThanOrEqual(4);
    expect(lowMinutes.provenance['speed']?.confidence).toBe('low');
  });
});

describe('derive-v11 provenance and uncertainty', () => {
  it('records sample size on every rating and downgrades thin samples', () => {
    const thin = derivePlayerRecord(
      input('2023-24', starterStats({ gamesPlayed: 9, minutes: 120 })),
    );
    for (const field of ['threePoint', 'passing', 'perimeterDefense', 'speed'] as const) {
      expect(thin.provenance[field]?.sampleGames).toBe(9);
      expect(thin.provenance[field]?.sampleMinutes).toBe(120);
      expect(thin.provenance[field]?.confidence).toBe('low');
    }
    const full = derivePlayerRecord(input('2023-24', starterStats()));
    expect(full.provenance['threePoint']?.sampleGames).toBe(78);
    expect(full.provenance['threePoint']?.confidence).not.toBe('low');
  });
  it('propagates estimated blocks into interior defense and vertical confidence', () => {
    const estimated = derivePlayerRecord(
      input(
        '2023-24',
        starterStats({ blocks: null, offensiveRebounds: null, defensiveRebounds: null }),
        'C',
      ),
    );
    expect(estimated.provenance['interiorDefense']?.confidence).toBe('low');
    expect(estimated.provenance['vertical']?.confidence).toBe('low');
  });
});
