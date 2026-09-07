import { describe, expect, it } from 'vitest';
import { derivePlayerRecord, type DerivationInput } from './v2.ts';
import { defenseCreditFor, twoWayBonusFor } from './v3.ts';
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
  it('refuses to rate a 7-for-7 fluke as a rotation shooter', () => {
    const fluke = derivePlayerRecord(
      input('2023-24', starterStats({ tpm: 7, tpa: 7, tsPct: 0.644, ftm: 160, fta: 241 }), 'C'),
    );
    expect(fluke.provenance['threePoint']?.kind).toBe('derived');
    expect(fluke.ratings.threePoint).toBeLessThanOrEqual(60);
  });
  it('reads midrange from free-throw touch for rim-reliant bigs, not dunk efficiency', () => {
    const rimBig = derivePlayerRecord(
      input(
        '2023-24',
        starterStats({
          fgm: 435,
          fga: 703,
          tpm: 6,
          tpa: 7,
          ftm: 160,
          fta: 241,
          efgPct: 0.624,
          tsPct: 0.644,
        }),
        'C',
      ),
    );
    expect(rimBig.provenance['midrange']?.kind).toBe('estimated');
    expect(rimBig.ratings.midrange).toBeLessThan(65);
    const spacer = derivePlayerRecord(
      input(
        '2023-24',
        starterStats({ fgm: 630, fga: 1350, tpm: 160, tpa: 410, efgPct: 0.526 }),
        'SG',
      ),
    );
    expect(spacer.provenance['midrange']?.kind).toBe('derived');
  });
  it('gives rim-reliant finishers a rim-heavy diet with honest estimated provenance', () => {
    const claxtonLike = derivePlayerRecord(
      input(
        '2023-24',
        starterStats({
          points: 958,
          rebounds: 699,
          offensiveRebounds: 182,
          defensiveRebounds: 517,
          assists: 144,
          fgm: 400,
          fga: 571,
          tpm: 0,
          tpa: 1,
          ftm: 158,
          fta: 281,
          usageRate: 15.5,
        }),
        'C',
      ),
    );
    expect(claxtonLike.tendencies.rimFrequency).toBeGreaterThan(55);
    expect(claxtonLike.tendencies.longMidFrequency).toBeLessThan(15);
    expect(claxtonLike.provenance['rimFrequency']?.kind).toBe('estimated');
    expect(claxtonLike.provenance['rimFrequency']?.notesCode).toBeDefined();
    const twoShare =
      claxtonLike.tendencies.rimFrequency +
      claxtonLike.tendencies.shortMidFrequency +
      claxtonLike.tendencies.longMidFrequency;
    expect(twoShare).toBeGreaterThan(85);
  });
  it('uses observed zone volume for rim frequency when present', () => {
    const zoned = derivePlayerRecord(
      input(
        '2023-24',
        starterStats({
          fgm: 400,
          fga: 800,
          tpm: 40,
          tpa: 200,
          insideFga: 420,
          closeFga: 120,
          midFga: 60,
        }),
        'C',
      ),
    );
    expect(zoned.provenance['rimFrequency']?.kind).toBe('derived');
    expect(zoned.provenance['rimFrequency']?.sourceFields).toContain('insideFga');
    expect(zoned.tendencies.rimFrequency).toBeGreaterThan(zoned.tendencies.longMidFrequency);
  });
});

describe('derive-v11 production load-conditioning', () => {
  it('credits efficiency to the creator carrying load, not the finisher dunking it', () => {
    const finisher = derivePlayerRecord(
      input(
        '2023-24',
        starterStats({
          assists: 100,
          usageRate: 16,
          tsPct: 0.62,
          efgPct: 0.58,
          per: 18,
          boxPlusMinus: 2,
        }),
        'C',
      ),
    );
    const creator = derivePlayerRecord(
      input(
        '2023-24',
        starterStats({
          assists: 500,
          usageRate: 30,
          tsPct: 0.62,
          efgPct: 0.58,
          per: 18,
          boxPlusMinus: 2,
        }),
        'PG',
      ),
    );
    expect(creator.ratingProfile.production.score).toBeGreaterThan(
      finisher.ratingProfile.production.score + 5,
    );
  });
  it('grades playmaking by rate, not minutes: same assists per 36, same credit', () => {
    const full = derivePlayerRecord(
      input('2023-24', starterStats({ gamesPlayed: 78, minutes: 2808, assists: 560 })),
    );
    const half = derivePlayerRecord(
      input('2023-24', starterStats({ gamesPlayed: 78, minutes: 1404, assists: 280 })),
    );
    expect(
      Math.abs(full.ratingProfile.production.score - half.ratingProfile.production.score),
    ).toBeLessThan(6);
  });
  it('rewards two-way balance and nothing for one-way stars', () => {
    expect(twoWayBonusFor(80, 72)).toBeGreaterThan(1);
    expect(twoWayBonusFor(81, 58)).toBe(0);
    expect(twoWayBonusFor(60, 74)).toBe(0);
    const twoWay = derivePlayerRecord(
      input(
        '2023-24',
        starterStats({
          points: 2000,
          assists: 500,
          steals: 150,
          blocks: 80,
          usageRate: 28,
          tsPct: 0.6,
          efgPct: 0.55,
          per: 22,
          boxPlusMinus: 4,
        }),
        'SF',
      ),
    );
    const oneWay = derivePlayerRecord(
      input(
        '2023-24',
        starterStats({
          points: 2000,
          assists: 150,
          steals: 40,
          blocks: 20,
          usageRate: 28,
          tsPct: 0.6,
          efgPct: 0.55,
          per: 22,
          boxPlusMinus: 4,
        }),
        'SF',
      ),
    );
    expect(twoWay.summaryRatings.overallRating).toBeGreaterThan(
      oneWay.summaryRatings.overallRating,
    );
  });
  it('caps defense credit without contest evidence', () => {
    expect(defenseCreditFor(74, true)).toBe(3);
    expect(defenseCreditFor(74, false)).toBe(1.5);
    expect(defenseCreditFor(60, false)).toBe(-2.5);
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
  it('caps the oIQ assist-ratio term for extreme distributors', () => {
    const extreme = derivePlayerRecord(
      input('2023-24', starterStats({ assists: 900, usageRate: 22, turnovers: 250 }), 'PG'),
    );
    expect(extreme.ratings.offensiveIq).toBeLessThan(92);
    const moderate = derivePlayerRecord(
      input('2023-24', starterStats({ assists: 500, usageRate: 30, turnovers: 250 }), 'PG'),
    );
    expect(moderate.ratings.offensiveIq).toBeGreaterThan(60);
  });
  it('shrinks garbage-time rates toward priors despite many games', () => {
    const fringeTotals = {
      gamesPlayed: 79,
      minutes: 322,
      points: 190,
      rebounds: 47,
      offensiveRebounds: 9,
      defensiveRebounds: 38,
      assists: 35,
      steals: 11,
      blocks: 3,
      turnovers: 24,
      fouls: 20,
      fgm: 71,
      fga: 153,
      tpm: 18,
      tpa: 46,
      ftm: 29,
      fta: 35,
    };
    const fringe = derivePlayerRecord(
      input('2023-24', starterStats(fringeTotals), 'C', {
        heightInches: 84,
      }),
    );
    expect(fringe.ratings.insideScoring).toBeLessThan(70);
    expect(fringe.ratings.block).toBeLessThan(70);
    const regular = derivePlayerRecord(
      input('2023-24', starterStats({ gamesPlayed: 79, minutes: 2400 }), 'C', {
        heightInches: 84,
      }),
    );
    expect(regular.ratings.insideScoring).toBeGreaterThan(fringe.ratings.insideScoring);
  });
  it('grades unobserved minutes as priors with low confidence, never 100s', () => {
    const noMinutes = derivePlayerRecord(
      input(
        '1961-62',
        {
          gamesPlayed: 79,
          minutes: null,
          points: 2495,
          rebounds: 1461,
          offensiveRebounds: null,
          defensiveRebounds: null,
          assists: null,
          steals: null,
          blocks: null,
          turnovers: null,
          fouls: 281,
          fgm: null,
          fga: null,
          tpm: null,
          tpa: null,
          ftm: 549,
          fta: 853,
        },
        'C',
        { heightInches: 85 },
      ),
    );
    for (const field of Object.keys(noMinutes.ratings)) {
      expect(noMinutes.ratings[field as keyof typeof noMinutes.ratings]).toBeLessThan(100);
    }
    expect(noMinutes.provenance['block']?.confidence).toBe('low');
    expect(noMinutes.provenance['interiorDefense']?.confidence).toBe('low');
    expect(noMinutes.anchors.pointsPerGame).toBeCloseTo(2495 / 79, 5);
  });
  it('caps height-driven strength for very tall frames', () => {
    const giant = derivePlayerRecord(input('2023-24', starterStats({}), 'C', { heightInches: 88 }));
    const center = derivePlayerRecord(
      input('2023-24', starterStats({}), 'C', { heightInches: 82 }),
    );
    expect(giant.ratings.strength - center.ratings.strength).toBeLessThanOrEqual(2);
  });
  it('penalizes hollow anchors: elite rebound/block piles without creation on losing teams', () => {
    const anchorStats = starterStats({
      gamesPlayed: 75,
      minutes: 2500,
      points: 900,
      rebounds: 900,
      offensiveRebounds: 250,
      defensiveRebounds: 650,
      assists: 100,
      steals: 30,
      blocks: 200,
      turnovers: 210,
      fgm: 380,
      fga: 700,
      tpm: 0,
      tpa: 5,
      ftm: 140,
      fta: 220,
      usageRate: 18,
      tsPct: 0.6,
      efgPct: 0.55,
    });
    const hollow = derivePlayerRecord(input('2023-24', anchorStats, 'C', { teamWinPct: 0.4 }));
    const winner = derivePlayerRecord(input('2023-24', anchorStats, 'C', { teamWinPct: 0.75 }));
    expect(hollow.ratingProfile.nonlinear.weaknesses.hollowAnchor ?? 0).toBeGreaterThan(0);
    expect(winner.ratingProfile.nonlinear.weaknesses.hollowAnchor ?? 0).toBe(0);
    expect(hollow.summaryRatings.overallRating).toBeLessThan(winner.summaryRatings.overallRating);
  });
  it('reads perimeter containment from three-point contests, not rim volume', () => {
    const rimAnchor = derivePlayerRecord(
      input(
        '2023-24',
        starterStats({ contestedShots: 900, contestedShots3pt: 60, deflections: 50 }),
        'C',
      ),
    );
    expect(rimAnchor.provenance['perimeterDefense']?.kind).toBe('derived');
    expect(rimAnchor.provenance['perimeterDefense']?.sourceFields).toContain('contestedShots3pt');
    expect(rimAnchor.provenance['perimeterDefense']?.sourceFields).not.toContain('contestedShots');
    const disruptor = derivePlayerRecord(
      input(
        '2023-24',
        starterStats({ contestedShots: 300, contestedShots3pt: 200, deflections: 220 }),
        'SG',
      ),
    );
    expect(disruptor.ratings.perimeterDefense).toBeGreaterThan(
      rimAnchor.ratings.perimeterDefense + 5,
    );
  });
  it('grades burst from drives and cruise speed gently', () => {
    const burner = derivePlayerRecord(
      input('2023-24', starterStats({ avgSpeed: 4.1, drives: 1700 }), 'SG'),
    );
    const cruiser = derivePlayerRecord(
      input('2023-24', starterStats({ avgSpeed: 4.1, drives: 100 }), 'SG'),
    );
    expect(burner.ratings.speed).toBeGreaterThan(cruiser.ratings.speed + 3);
    expect(burner.provenance['speed']?.sourceFields).toContain('drives');
  });
  it('uses observed drives for the drive-rate tendency', () => {
    const derived = derivePlayerRecord(input('2023-24', starterStats({ drives: 1700 }), 'SG'));
    expect(derived.provenance['driveRate']?.kind).toBe('derived');
    expect(derived.provenance['driveRate']?.sourceFields).toContain('drives');
    expect(derived.tendencies.driveRate).toBeGreaterThan(20);
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
