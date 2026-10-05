import { describe, expect, it } from 'vitest';
import {
  ratingProfileSchema,
  overallForScore,
  overallScaleSchema,
  REQUIRED_RATING_KEYS,
  type SimulationRatings,
} from '@hoop-rush/data-contracts';
import { DEFAULT_RATINGS_MODEL_ARTIFACT } from './artifact.ts';
import { buildOverallScale } from './overall-calibration.ts';
import { deriveRatingProfile, tendenciesForProfile, type RatingProfileInput } from './v3.ts';
import { starterStats } from './ratings-test-support.ts';

const scale = buildOverallScale(
  Array.from({ length: 100 }, (_, index) => ({ key: String(index), score: 40 + index / 2 })),
);
const ratings = Object.fromEntries(
  REQUIRED_RATING_KEYS.map((key) => [key, 65]),
) as SimulationRatings;
const player = { ratings, tendencies: tendenciesForProfile(starterStats(), ratings) };
const input: RatingProfileInput = {
  ratings: { ...player.ratings },
  tendencies: { ...player.tendencies },
  stats: starterStats(),
  position: 'SG',
  heightInches: 78,
  artifact: { ...DEFAULT_RATINGS_MODEL_ARTIFACT, overallScale: scale },
  eraPace: 100,
  eraThreeRate: 0.36,
};
const derive = (overrides: Partial<RatingProfileInput> = {}) =>
  deriveRatingProfile({ ...input, ...overrides });

describe('total ability overall', () => {
  it('does not reward team wins, identity, or estimated advanced metrics', () => {
    const original = derive();
    expect(derive({ teamWinPct: 0.2 }).summaryRatings).toEqual(original.summaryRatings);
    expect(derive({ teamWinPct: 0.9 }).summaryRatings).toEqual(original.summaryRatings);
    expect(
      derive({
        playerId: 'different',
        artifact: {
          ...input.artifact,
          playerAdjustments: { different: { adjustment: 6, confidence: 1, sampleCount: 1280 } },
        },
      }).summaryRatings,
    ).toEqual(original.summaryRatings);
    expect(derive({ stats: { ...input.stats, per: 40, boxPlusMinus: 15, efgPct: 0.9 } })).toEqual(
      original,
    );
    const sparse = { ...input.stats, tsPct: null, per: null, boxPlusMinus: null };
    expect(derive({ stats: { ...sparse, per: 40, boxPlusMinus: 15 } }).profile.production).toEqual(
      derive({ stats: sparse }).profile.production,
    );
    expect(derive({ stats: sparse }).profile.production.confidence).toBe('medium');
  });

  it('uses the same holistic base for creators, finishers, anchors, connectors, and two-way stars', () => {
    const neutral = Object.fromEntries(
      Object.keys(player.ratings).map((key) => [key, 60]),
    ) as typeof player.ratings;
    const profiles = [
      { ...neutral, ballHandling: 90, passing: 88, offensiveIq: 90, insideScoring: 85 },
      { ...neutral, insideScoring: 95, closeShot: 95, passing: 35, ballHandling: 35 },
      {
        ...neutral,
        interiorDefense: 95,
        block: 95,
        defensiveRebound: 95,
        passing: 35,
        ballHandling: 35,
      },
      { ...neutral, passing: 90, offensiveIq: 85, defensiveIq: 80 },
      Object.fromEntries(Object.keys(neutral).map((key) => [key, 88])) as typeof player.ratings,
    ];
    for (const ratings of profiles) {
      const result = derive({ ratings });
      expect(result.profile.baseScore).toBeCloseTo(
        0.65 * result.summaryRatings.offenseRating + 0.35 * result.summaryRatings.defenseRating,
        8,
      );
      expect(ratingProfileSchema.safeParse(result.profile).success).toBe(true);
    }
    expect(derive({ ratings: profiles[4]! }).profile.rawOverallScore).toBeGreaterThan(
      derive({ ratings: profiles[2]! }).profile.rawOverallScore,
    );
  });

  it('is monotonic in scoring, creation and defensive ability', () => {
    const original = derive();
    for (const key of [
      'insideScoring',
      'midrange',
      'threePoint',
      'passing',
      'ballHandling',
      'offensiveIq',
      'interiorDefense',
      'perimeterDefense',
      'defensiveIq',
      'block',
      'steal',
      'defensiveRebound',
    ] as const) {
      const improved = derive({
        ratings: { ...input.ratings, [key]: Math.min(100, input.ratings[key] + 10) },
      });
      expect(improved.profile.rawOverallScore, key).toBeGreaterThanOrEqual(
        original.profile.rawOverallScore,
      );
      expect(improved.summaryRatings.overallRating, key).toBeGreaterThanOrEqual(
        original.summaryRatings.overallRating,
      );
    }
    expect(
      derive({ stats: { ...input.stats, points: Number(input.stats.points) + 300 } }).profile
        .rawOverallScore,
    ).toBeGreaterThan(original.profile.rawOverallScore);
  });

  it('grades production by rates, caps defensive events, and shrinks small samples', () => {
    const original = derive().profile.production;
    const half = { ...input.stats };
    for (const key of [
      'gamesPlayed',
      'minutes',
      'points',
      'rebounds',
      'assists',
      'steals',
      'blocks',
      'fga',
      'fta',
      'turnovers',
    ])
      half[key] = Number(half[key]) / 2;
    const smaller = derive({ stats: half }).profile.production;
    expect(smaller.score).toBeCloseTo(original.score, 10);
    expect(smaller.weight).toBeLessThan(original.weight);
    const enormous = derive({ stats: { ...input.stats, steals: 10000, blocks: 10000 } }).profile
      .production.score;
    const saturated = derive({ stats: { ...input.stats, steals: 1000, blocks: 1000 } }).profile
      .production.score;
    expect(enormous).toBe(saturated);
    const missing = derive({ stats: { ...input.stats, steals: null, blocks: null } });
    const zero = derive({ stats: { ...input.stats, steals: 0, blocks: 0 } });
    expect(missing.profile.production.score).toBe(zero.profile.production.score);
    expect(input.stats.steals).not.toBeNull();
  });

  it('requires reconciling diagnostics for v3 while reading legacy v2 profiles', () => {
    const profile = derive().profile;
    const legacy = { ...profile, schemaVersion: 2, overallDiagnostics: undefined };
    expect(ratingProfileSchema.safeParse(legacy).success).toBe(true);
    expect(
      ratingProfileSchema.safeParse({ ...profile, overallDiagnostics: undefined }).success,
    ).toBe(false);
    expect(
      ratingProfileSchema.safeParse({ ...profile, rawOverallScore: profile.rawOverallScore + 1 })
        .success,
    ).toBe(false);
  });
});

describe('frozen overall scale', () => {
  it('deduplicates player-seasons and is independent of sample order', () => {
    const samples = [
      { key: 'a|2000-01', score: 50 },
      { key: 'b|2000-01', score: 60 },
      { key: 'c|2000-01', score: 70 },
    ];
    expect(buildOverallScale([...samples, samples[0]!])).toEqual(
      buildOverallScale([...samples].reverse()),
    );
    expect(() => buildOverallScale([...samples, { key: 'a|2000-01', score: 51 }])).toThrow(
      'conflicting',
    );
  });
  it('interpolates monotonically with bounds and rejects malformed mappings', () => {
    let last = 40;
    for (let score = 20; score < 110; score += 0.1) {
      const result = overallForScore(score, scale);
      expect(result.overall).toBeGreaterThanOrEqual(last);
      last = result.overall;
    }
    expect(overallForScore(-100, scale).overall).toBe(40);
    expect(overallForScore(1000, scale).overall).toBe(99);
    expect(
      overallScaleSchema.safeParse({ ...scale, knots: [...scale.knots].reverse() }).success,
    ).toBe(false);
    expect(() => overallForScore(NaN, scale)).toThrow();
  });
});
