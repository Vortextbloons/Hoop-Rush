import { describe, expect, it } from 'vitest';
import {
  ratingProfileSchema,
  ratingsModelArtifactSchema,
  overallForScore,
  overallScaleSchema,
  REQUIRED_RATING_KEYS,
  type SimulationRatings,
} from '@hoop-rush/data-contracts';
import { DEFAULT_RATINGS_MODEL_ARTIFACT } from './artifact.ts';
import { buildOverallScale, fitRecognitionPriors } from './overall-calibration.ts';
import {
  deriveRatingProfile,
  offensiveAbilityFor,
  defensiveAbilityFor,
  tendenciesForProfile,
  type RatingProfileInput,
} from './v3.ts';
import { normalizePoolOveralls } from '../pools/compute.ts';
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
        0.65 * offensiveAbilityFor(ratings, input.tendencies) + 0.35 * defensiveAbilityFor(ratings),
        1,
      );
      expect(ratingProfileSchema.safeParse(result.profile).success).toBe(true);
    }
    const elite = profiles[4];
    const starter = profiles[2];
    if (elite === undefined || starter === undefined) throw new Error('fixture profiles missing');
    expect(derive({ ratings: elite }).profile.rawOverallScore).toBeGreaterThan(
      derive({ ratings: starter }).profile.rawOverallScore,
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
      'offensiveRebounds',
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

  it('values comparable scoring routes without requiring guard skills from every scorer', () => {
    const interior = { ...ratings, insideScoring: 90, midrange: 60, threePoint: 40 };
    const perimeter = { ...ratings, insideScoring: 40, midrange: 60, threePoint: 90 };
    expect(derive({ ratings: interior }).profile.rawOverallScore).toBe(
      derive({ ratings: perimeter }).profile.rawOverallScore,
    );
    const finisher = derive({
      ratings: { ...interior, passing: 35, ballHandling: 35 },
      stats: { ...input.stats, points: 900, usageRate: 16 },
    });
    const creator = derive({
      ratings: interior,
      stats: { ...input.stats, points: 1800, usageRate: 28 },
    });
    expect(creator.profile.rawOverallScore).toBeGreaterThan(finisher.profile.rawOverallScore);
  });

  it('does not dilute defensive ability when offensive production evidence increases', () => {
    const stronger = {
      ...ratings,
      interiorDefense: 75,
      perimeterDefense: 75,
      defensiveIq: 75,
      block: 75,
      steal: 75,
      defensiveRebound: 75,
      speed: 75,
      strength: 75,
      vertical: 75,
    };
    const gains = [{ ...input.stats, gamesPlayed: 10, minutes: 300 }, input.stats].map(
      (stats) =>
        derive({ stats, ratings: stronger }).profile.rawOverallScore -
        derive({ stats }).profile.rawOverallScore,
    );
    expect(gains[0]).toBeCloseTo(gains[1] ?? 0, 2);
    expect(gains[1]).toBeCloseTo(3.5, 2);
  });

  it('normalizes individual production by possession exposure rather than team success', () => {
    const slower: RatingProfileInput['stats'] = { ...input.stats, possessionPace: 90 };
    const faster: RatingProfileInput['stats'] = { ...input.stats, possessionPace: 120 };
    for (const key of ['points', 'assists', 'offensiveRebounds', 'fga', 'fta', 'turnovers'])
      faster[key] = (Number(slower[key]) * 120) / 90;
    expect(derive({ stats: slower }).profile.rawOverallScore).toBe(
      derive({ stats: faster }).profile.rawOverallScore,
    );
  });

  it('fits shared recognition priors deterministically and preserves small-sample shrinkage', () => {
    const samples = [
      { key: 'a', score: 65, defense: 70, honors: ['MVP-1', 'DEF1'] as const },
      { key: 'b', score: 75, defense: 80, honors: ['MVP-1', 'DEF1'] as const },
      { key: 'c', score: 55, defense: 60, honors: [] },
    ];
    const priors = fitRecognitionPriors(samples);
    expect(fitRecognitionPriors([...samples].reverse())).toEqual(priors);
    const first = samples[0];
    if (!first) throw new Error('missing fixture sample');
    expect(fitRecognitionPriors([...samples, first])).toEqual(priors);
    expect(() => fitRecognitionPriors([...samples, { ...first, score: 66 }])).toThrow(
      'conflicting',
    );
    const artifact = { ...input.artifact, recognitionPriors: priors };
    const full = derive({ artifact, stats: { ...input.stats, honors: ['MVP-1'] } }).profile;
    const small = derive({
      artifact,
      stats: { ...input.stats, honors: ['MVP-1'], gamesPlayed: 10, minutes: 300 },
    }).profile;
    const diagnostics = full.overallDiagnostics;
    const smallDiagnostics = small.overallDiagnostics;
    if (diagnostics?.schemaVersion !== 2 || smallDiagnostics?.schemaVersion !== 2)
      throw new Error('missing diagnostics');
    expect(smallDiagnostics.recognitionWeight).toBeLessThan(diagnostics.recognitionWeight);
    expect(ratingProfileSchema.safeParse(full).success).toBe(true);
    expect(
      derive({ artifact, playerId: 'another', stats: { ...input.stats, honors: ['MVP-1'] } })
        .profile.rawOverallScore,
    ).toBe(full.rawOverallScore);
    expect(
      derive({ artifact, stats: { ...input.stats, honors: ['MVP-1', 'NBA1', 'NBA2'] } }).profile
        .rawOverallScore,
    ).toBe(full.rawOverallScore);
    expect(ratingsModelArtifactSchema.safeParse({ ...artifact, schemaVersion: 4 }).success).toBe(
      true,
    );
    expect(
      ratingsModelArtifactSchema.safeParse({
        ...artifact,
        schemaVersion: 4,
        recognitionPriors: undefined,
      }).success,
    ).toBe(false);
    const evidenced = Object.fromEntries(
      ['insideScoring', 'midrange', 'passing', 'interiorDefense', 'perimeterDefense'].map((key) => [
        key,
        {
          kind: 'derived' as const,
          confidence: 'high' as const,
          methodVersion: 'test',
          sourceVersion: 'test',
          sourceFields: ['observed'],
        },
      ]),
    );
    const complete = derive({
      artifact,
      abilityProvenance: evidenced,
      stats: { ...input.stats, honors: ['MVP-1'] },
    }).profile.overallDiagnostics;
    if (complete?.schemaVersion !== 2) throw new Error('missing diagnostics');
    expect(complete.recognitionWeight).toBe(0);
    const unrecognized = derive({ artifact, stats: input.stats }).profile.overallDiagnostics;
    if (unrecognized?.schemaVersion !== 2) throw new Error('missing diagnostics');
    expect(unrecognized.recognitionHonor).toBeNull();
    expect(unrecognized.recognitionPrior).toBe(priors.population?.mean);
    expect(unrecognized.recognitionWeight).toBeGreaterThan(0);
    const observedUnrecognized = derive({ artifact, abilityProvenance: evidenced }).profile
      .overallDiagnostics;
    if (observedUnrecognized?.schemaVersion !== 2) throw new Error('missing diagnostics');
    expect(observedUnrecognized.recognitionWeight).toBe(0);
  });

  it('values interior and perimeter defensive routes symmetrically', () => {
    const interior = {
      ...ratings,
      interiorDefense: 90,
      perimeterDefense: 50,
      block: 90,
      steal: 50,
    };
    const perimeter = {
      ...ratings,
      interiorDefense: 50,
      perimeterDefense: 90,
      block: 50,
      steal: 90,
    };
    expect(defensiveAbilityFor(interior)).toBe(defensiveAbilityFor(perimeter));
    expect(derive({ ratings: interior, position: 'C' }).profile.rawOverallScore).toBe(
      derive({ ratings: perimeter, position: 'PG' }).profile.rawOverallScore,
    );
  });

  it('requires matching frozen scales in v3 artifacts while retaining legacy readability', () => {
    expect(ratingsModelArtifactSchema.safeParse(DEFAULT_RATINGS_MODEL_ARTIFACT).success).toBe(true);
    expect(
      ratingsModelArtifactSchema.safeParse({ ...DEFAULT_RATINGS_MODEL_ARTIFACT, schemaVersion: 3 })
        .success,
    ).toBe(false);
    expect(
      ratingsModelArtifactSchema.safeParse({ ...input.artifact, schemaVersion: 3 }).success,
    ).toBe(true);
    expect(
      ratingsModelArtifactSchema.safeParse({
        ...input.artifact,
        schemaVersion: 3,
        modelVersion: 'different',
      }).success,
    ).toBe(false);
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
    const duplicate = samples[0];
    if (duplicate === undefined) throw new Error('fixture sample missing');
    expect(buildOverallScale([...samples, duplicate])).toEqual(
      buildOverallScale([...samples].reverse()),
    );
    expect(() => buildOverallScale([...samples, { key: 'a|2000-01', score: 51 }])).toThrow(
      'conflicting',
    );
  });
  it('maps identical profiles independently of pool additions and order', () => {
    const makeRow = (id: string) => ({
      playerId: id,
      franchiseId: 'lakers',
      seasonKey: '2000-01',
      summaryRatings: { ...derive().summaryRatings },
      ratingProfile: { ...derive().profile },
    });
    const alone = [makeRow('a')];
    const together = [makeRow('b'), makeRow('a')];
    normalizePoolOveralls(alone, scale);
    normalizePoolOveralls(together, scale);
    expect(together[1]?.summaryRatings).toEqual(alone[0]?.summaryRatings);
    expect(together[1]?.ratingProfile.overallPercentile).toEqual(
      alone[0]?.ratingProfile.overallPercentile,
    );
    normalizePoolOveralls(together.reverse(), scale);
    expect(together[0]?.summaryRatings).toEqual(alone[0]?.summaryRatings);
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
