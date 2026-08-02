import { describe, expect, it } from 'vitest';
import { createRng } from '../rng.js';
import { computeOverall } from './weights.js';
import { computeProductionImpact, computeRealOverall, computeSummaryRatings } from './summary.js';
import { deriveContract } from './contracts.js';
import { deriveRatings, mapPosition } from './derive.js';
import type { StatsRow } from './stats.js';

function baseRatings(over: Record<string, number> = {}): Record<string, number> {
  return { ...base, ...over };
}

const base: Record<string, number> = {
  insideScoring: 70,
  closeShot: 70,
  midrange: 65,
  threePoint: 60,
  freeThrow: 75,
  ballHandling: 70,
  passing: 70,
  offensiveIq: 70,
  offensiveRebound: 55,
  defensiveRebound: 60,
  perimeterDefense: 65,
  interiorDefense: 60,
  steal: 60,
  block: 55,
  defensiveIq: 65,
  speed: 65,
  strength: 65,
  vertical: 65,
  stamina: 75,
  durability: 75,
  clutch: 65,
  consistency: 65,
  potential: 75,
};

function starStats(over: Record<string, unknown> = {}): StatsRow {
  return {
    gamesPlayed: 66,
    minutes: 66 * 38.2,
    points: 66 * 21.1,
    rebounds: 66 * 4.5,
    assists: 66 * 4.0,
    steals: 66 * 1.3,
    blocks: 66 * 0.4,
    turnovers: 66 * 3.1,
    fga: 66 * 17.2,
    fgm: 66 * 8.2,
    tpa: 66 * 3.8,
    tpm: 66 * 1.3,
    fta: 66 * 5.6,
    ftm: 66 * 4.8,
    per: 19.1,
    boxPlusMinus: 3.2,
    usageRate: 26.1,
    tsPct: 0.559,
    efgPct: 0.517,
    age: 21,
    ...over,
  };
}

describe('mapPosition', () => {
  it('maps source positions like Python POS_MAP', () => {
    expect(mapPosition('G')).toBe('SG');
    expect(mapPosition('F')).toBe('SF');
    expect(mapPosition('C')).toBe('C');
    expect(mapPosition('PG')).toBe('PG');
    expect(mapPosition('PF')).toBe('PF');
    expect(mapPosition('')).toBe('SF');
    expect(mapPosition('Z')).toBe('SF');
  });
});

describe('computeOverall', () => {
  it('computes a weighted skill overall and applies the big-man divisor', () => {
    const pg = computeOverall(baseRatings(), 'PG');
    expect(pg).toBeGreaterThanOrEqual(50);
    expect(pg).toBeLessThanOrEqual(99);
    const center = computeOverall(baseRatings({ block: 70 }), 'C');
    expect(center).toBeGreaterThanOrEqual(50);
  });

  it('returns the raw total (rounded) when it is at or below 50', () => {
    const low: Record<string, number> = {};
    for (const key of Object.keys(base)) low[key] = 30;
    const overall = computeOverall(low, 'PG');
    expect(overall).toBeLessThanOrEqual(50);
  });

  it('treats SFs as bigs only with 6\'10"+ height', () => {
    const strong: Record<string, number> = { ...base };
    for (const [key, value] of Object.entries(strong)) strong[key] = Math.max(value, 70);
    strong['interiorDefense'] = 85;
    strong['block'] = 80;
    strong['defensiveRebound'] = 80;
    const short = computeOverall(strong, 'SF', 79);
    const tall = computeOverall(strong, 'SF', 83);
    expect(tall).toBeLessThan(short);
  });
});

describe('computeSummaryRatings', () => {
  it('blends offense 55% / defense 45%', () => {
    const { offenseRating, defenseRating, overallRating } = computeSummaryRatings(baseRatings(), {
      turnoverRate: 12,
      foulRate: 2,
    });
    expect(offenseRating).toBeGreaterThanOrEqual(0);
    expect(offenseRating).toBeLessThanOrEqual(100);
    expect(defenseRating).toBeGreaterThanOrEqual(0);
    expect(overallRating).toBe(Math.trunc(0.55 * offenseRating + 0.45 * defenseRating));
  });

  it('penalizes turnover-prone and foul-heavy tendencies', () => {
    const clean = computeSummaryRatings(baseRatings(), { turnoverRate: 5, foulRate: 1 });
    const sloppy = computeSummaryRatings(baseRatings(), { turnoverRate: 25, foulRate: 6 });
    expect(sloppy.overallRating).toBeLessThan(clean.overallRating);
  });
});

describe('computeProductionImpact', () => {
  it('returns 0 without games or minutes', () => {
    expect(computeProductionImpact({ gamesPlayed: 0, minutes: 0 })).toBe(0);
  });

  it('is clamped to [55, 99]', () => {
    const elite = computeProductionImpact(
      starStats({ per: 30, boxPlusMinus: 10, points: 66 * 30, usageRate: 35 }),
    );
    expect(elite).toBeLessThanOrEqual(99);
    const scrub = computeProductionImpact(starStats({ points: 66 * 3, minutes: 66 * 8 }));
    expect(scrub).toBeGreaterThanOrEqual(55);
  });
});

describe('computeRealOverall floor/cap scenarios', () => {
  // Kobe's 1999-00 season: high-minute, efficient two-way wing below the
  // heliocentric usage threshold. The two-way-star mechanism must floor him.
  it('two-way star (Kobe 1999-00 profile) reaches the 88 floor', () => {
    const stats = starStats({
      gamesPlayed: 66,
      minutes: 66 * 38.2,
      points: 66 * 21.1,
      per: 19.1,
      boxPlusMinus: 3.2,
      usageRate: 26.1,
      tsPct: 0.574,
    });
    const ratings = baseRatings();
    const overall = computeRealOverall(ratings, 'SG', stats);
    expect(overall).toBeGreaterThanOrEqual(88);
  });

  // Magic's 1990-91 season: sustained pass-first playmaking at low usage.
  it('primary creator (Magic 1990-91 profile) reaches the 91 floor', () => {
    const stats = starStats({
      gamesPlayed: 79,
      minutes: 79 * 37.5,
      points: 79 * 19.4,
      assists: 79 * 12.5,
      per: 21.8,
      boxPlusMinus: 4.1,
      usageRate: 20.5,
      tsPct: 0.623,
    });
    const overall = computeRealOverall(baseRatings(), 'PG', stats);
    expect(overall).toBeGreaterThanOrEqual(91);
  });

  // Verified against the current Python engine: floor 90 -> high-usage cap 87
  // -> ppg>=25 wing cap 90 -> final boost 1.0 = 88.
  it('caps high-usage non-bigs with weak BPM', () => {
    const stats = starStats({
      gamesPlayed: 70,
      minutes: 70 * 35,
      points: 70 * 25,
      usageRate: 31,
      boxPlusMinus: 1.0,
      per: 18,
      tsPct: 0.54,
    });
    const overall = computeRealOverall(baseRatings(), 'SG', stats);
    expect(overall).toBe(88);
  });

  it('caps a 25+ ppg wing with limited games below the all-time band', () => {
    const stats = starStats({
      gamesPlayed: 50,
      minutes: 50 * 36,
      points: 50 * 27,
      usageRate: 32,
      boxPlusMinus: 2.5,
      per: 24,
      tsPct: 0.58,
    });
    const overall = computeRealOverall(baseRatings(), 'SG', stats);
    expect(overall).toBeLessThanOrEqual(90);
  });

  it('keeps a tall SF in the big-man cap ladder', () => {
    const stats = starStats({
      gamesPlayed: 75,
      minutes: 75 * 28,
      points: 75 * 11,
      rebounds: 75 * 9,
      usageRate: 18,
      boxPlusMinus: 2.0,
      per: 15,
    });
    const overall = computeRealOverall(
      baseRatings({ interiorDefense: 80, block: 75 }),
      'SF',
      stats,
      83,
    );
    expect(overall).toBeLessThanOrEqual(82);
  });

  it('caps low-volume bigs below the star band', () => {
    const stats = starStats({
      gamesPlayed: 75,
      minutes: 75 * 28,
      points: 75 * 11,
      rebounds: 75 * 9,
      usageRate: 18,
      boxPlusMinus: 2.0,
      per: 15,
    });
    const overall = computeRealOverall(baseRatings({ interiorDefense: 80, block: 75 }), 'C', stats);
    expect(overall).toBeLessThanOrEqual(82);
  });

  it('applies the low-impact rotation penalty', () => {
    const stats = starStats({
      gamesPlayed: 65,
      minutes: 65 * 22,
      points: 65 * 8,
      per: 11,
      boxPlusMinus: 0.2,
      usageRate: 16,
    });
    const ratings = baseRatings({ insideScoring: 60, threePoint: 55, ballHandling: 55 });
    const overall = computeRealOverall(ratings, 'SF', stats);
    expect(overall).toBeLessThanOrEqual(80);
  });
});

describe('deriveRatings', () => {
  it('is deterministic for the same seed and season', () => {
    const stats = starStats();
    const a = deriveRatings(stats, 'SG', '1995-96', createRng(1234));
    const b = deriveRatings(stats, 'SG', '1995-96', createRng(1234));
    expect(a).toEqual(b);
  });

  it('returns replacement-level ratings with no games or minutes', () => {
    const ratings = deriveRatings({ gamesPlayed: 0, minutes: 0 }, 'C', '1995-96', createRng(1));
    expect(ratings['overall']).toBeGreaterThanOrEqual(0);
    expect(ratings['overall']).toBeLessThanOrEqual(100);
  });

  it('produces in-range ratings for a real profile', () => {
    const ratings = deriveRatings(starStats(), 'SG', '1995-96', createRng(42));
    for (const value of Object.values(ratings)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
    expect(ratings['overall']).toBeGreaterThan(0);
  });
});

describe('deriveContract', () => {
  it('uses the salary tier by overall rating', () => {
    const elite = deriveContract(95, 26, createRng(1));
    expect(elite.salaryByYear[0]).toBe(65_000_000);
    expect(elite.yearsRemaining).toBe(4);
    expect(elite.option).toBe('player');
    const min = deriveContract(45, 22, createRng(1));
    expect(min.salaryByYear[0]).toBe(1_500_000);
  });

  it('splits the signing bonus across years', () => {
    const contract = deriveContract(80, 28, createRng(1));
    const bonusTotal = contract.signingBonusByYear.reduce((a, b) => a + b, 0);
    expect(bonusTotal).toBe(Math.trunc(35_000_000 * 0.05));
    expect(contract.guaranteed).toBe(false);
    expect(contract.guaranteedByYear[contract.yearsRemaining - 1]).toBe(false);
  });
});
