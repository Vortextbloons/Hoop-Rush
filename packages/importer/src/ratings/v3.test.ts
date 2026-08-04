import { describe, expect, it } from 'vitest';
import { DEFAULT_RATINGS_MODEL_ARTIFACT } from './artifact.js';
import { derivePlayerRecord } from './v2.js';

const stats = {
  playerExternalId: 'v3-fixture',
  gamesPlayed: 78,
  minutes: 2_850,
  points: 1_680,
  rebounds: 420,
  offensiveRebounds: 80,
  defensiveRebounds: 340,
  assists: 310,
  steals: 95,
  blocks: 30,
  turnovers: 210,
  fouls: 180,
  fgm: 630,
  fga: 1_350,
  tpm: 160,
  tpa: 410,
  ftm: 260,
  fta: 310,
  per: 19.5,
  boxPlusMinus: 3.1,
  usageRate: 25,
  tsPct: 0.57,
  efgPct: 0.526,
};

describe('Ratings v3 profile', () => {
  it('derives normalized multi-memberships and bounded nonlinear components', () => {
    const record = derivePlayerRecord({
      season: '1996-97',
      position: 'SG',
      heightInches: 79,
      stats,
      era: { leaguePpg: 110, league3PARate: 0.36, pace: 99 },
      artifact: DEFAULT_RATINGS_MODEL_ARTIFACT,
    });
    const memberships = record.ratingProfile.memberships;
    expect(Object.keys(memberships)).toHaveLength(10);
    expect(Object.values(memberships).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5);
    expect(record.ratingProfile.nonlinear.synergyBonus).toBeGreaterThanOrEqual(0);
    expect(record.ratingProfile.nonlinear.synergyBonus).toBeLessThanOrEqual(5);
    expect(record.ratingProfile.nonlinear.weaknessPenalty).toBeGreaterThanOrEqual(-6);
    expect(record.ratingProfile.nonlinear.weaknessPenalty).toBeLessThanOrEqual(0);
  });

  it('is deterministic and keeps canonical overall independent of runtime context', () => {
    const input = {
      season: '1996-97',
      position: 'SG',
      heightInches: 79,
      stats,
      era: { leaguePpg: 110, league3PARate: 0.36, pace: 99 },
      artifact: DEFAULT_RATINGS_MODEL_ARTIFACT,
    };
    const first = derivePlayerRecord(input);
    const second = derivePlayerRecord(input);
    expect(first.ratingProfile).toEqual(second.ratingProfile);
    expect(first.summaryRatings.overallRating).toBe(first.ratingProfile.canonicalOverall);
    expect(first.summaryRatings.overallRating).toBeGreaterThanOrEqual(0);
    expect(first.summaryRatings.overallRating).toBeLessThanOrEqual(100);
  });

  it('shrinks missing or small-sample production evidence toward the archetype base', () => {
    const record = derivePlayerRecord({
      season: '1970-71',
      position: 'C',
      heightInches: 84,
      stats: { ...stats, gamesPlayed: 8, minutes: 80, per: null, boxPlusMinus: null, tsPct: null },
      era: { leaguePpg: 110, league3PARate: 0.08, pace: 115 },
      artifact: DEFAULT_RATINGS_MODEL_ARTIFACT,
    });
    expect(record.ratingProfile.production.confidence).toBe('low');
    expect(record.ratingProfile.production.weight).toBeLessThan(0.1);
    expect(record.ratingProfile.calibratedImpact.confidence).toBe(0);
  });

  it('keeps a sustained efficient star wing out of the ordinary-starter band', () => {
    const record = derivePlayerRecord({
      season: '2025-26',
      position: 'SF',
      heightInches: 83,
      stats: {
        ...stats,
        points: 2_028,
        rebounds: 429,
        assists: 374,
        steals: 62,
        blocks: 70,
        turnovers: 249,
        fgm: 717,
        fga: 1_372,
        tpm: 187,
        tpa: 452,
        ftm: 405,
        fta: 468,
        per: 19.2,
        boxPlusMinus: 1.725,
        usageRate: 26.3,
        tsPct: 0.641,
        efgPct: 0.588,
      },
      era: { leaguePpg: 114.7, league3PARate: 0.39, pace: 99 },
      artifact: DEFAULT_RATINGS_MODEL_ARTIFACT,
    });
    expect(record.summaryRatings.overallRating).toBeGreaterThanOrEqual(88);
  });
});
