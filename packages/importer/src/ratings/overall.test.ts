import { describe, expect, it } from 'bun:test';
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
  combineDomainValues,
  productionEvidence,
  tendenciesForProfile,
  type RatingProfileInput,
} from './v3.ts';
import { starterStats } from './ratings-test-support.ts';
import { estimateAttributes } from './statistical-attributes.ts';
import { observedTeamRecord } from './overall-evidence.ts';
import { ratePer100 } from './season-evidence.ts';

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
  it('does not turn a two-game hustle sample into season-long defensive weakness', () => {
    const stats = starterStats({ minutes: 2700, gamesPlayed: 79, steals: 166 });
    const estimate = (evidence: Record<string, unknown>) =>
      estimateAttributes({
        season: '2015-16',
        position: 'PG',
        heightInches: 75,
        stats: { ...stats, ...evidence },
        era: { pace: 98, league3PARate: 0.27, leaguePpg: 102.7 },
      });
    const missing = estimate({}).perimeterDefense.value;
    const partial = estimate({
      deflections: 9,
      contestedShots3pt: 0,
      hustleMinutes: 78,
      hustleGamesPlayed: 2,
    }).perimeterDefense.value;
    expect(partial).toBeGreaterThan(missing - 5);
    expect(estimate({ deflections: 0, contestedShots3pt: 0 }).perimeterDefense.value).toBe(missing);
  });

  it('uses tracking minutes for rates and matching tracked rebounds for chance conversion', () => {
    const stats = starterStats({
      minutes: 3000,
      potentialAssists: 50,
      passingMinutes: 300,
      offensiveRebounds: 100,
      offRebChances: 20,
      trackedOffensiveRebounds: 10,
    });
    expect(ratePer100(stats, 'potentialAssists', 100)).toBeCloseTo(8, 8);
    const estimate = (overrides: Record<string, unknown>) =>
      estimateAttributes({
        season: '2015-16',
        position: 'PG',
        heightInches: 75,
        stats: { ...stats, ...overrides },
        era: { pace: 100, league3PARate: 0.27, leaguePpg: 102.7 },
      }).offensiveRebound.value;
    const withChances = estimate({});
    const withoutChances = estimate({ offRebChances: null });
    expect(withChances - withoutChances).toBeCloseTo(0.75, 8);
    expect(estimate({ trackedOffensiveRebounds: null })).toBe(withoutChances);
  });

  it('keeps each domain contribution independent of which domain is stronger', () => {
    const defensiveGains = [30, 60, 90].map(
      (offense) => combineDomainValues(offense, 85).score - combineDomainValues(offense, 65).score,
    );
    const offensiveGains = [30, 60, 90].map(
      (defense) => combineDomainValues(85, defense).score - combineDomainValues(65, defense).score,
    );
    for (const gain of defensiveGains) expect(gain).toBeCloseTo(defensiveGains[0] ?? 0, 10);
    for (const gain of offensiveGains) expect(gain).toBeCloseTo(offensiveGains[0] ?? 0, 10);
    expect(defensiveGains[0]).toBeGreaterThan(0);
    expect(offensiveGains[0]).toBeGreaterThan(0);
  });

  it('values efficient supporting production above inefficient scoring volume', () => {
    const volume = starterStats({
      points: 1800,
      fga: 1700,
      fta: 350,
      assists: 180,
      turnovers: 240,
      tsPct: 1800 / (2 * (1700 + 0.44 * 350)),
      leagueTrueShooting: 0.57,
    });
    const support = starterStats({
      points: 1250,
      fga: 850,
      fta: 200,
      assists: 350,
      turnovers: 100,
      tsPct: 1250 / (2 * (850 + 0.44 * 200)),
      leagueTrueShooting: 0.57,
    });
    expect(productionEvidence(support, 100, 0.36).score).toBeGreaterThan(
      productionEvidence(volume, 100, 0.36).score,
    );
    expect(derive({ stats: support }).profile.rawOverallScore).toBeGreaterThan(
      derive({ stats: volume }).profile.rawOverallScore,
    );
  });

  it('does not award production for larger minute roles at identical rates and exposure', () => {
    const full = starterStats({ gamesPlayed: 50, minutes: 1500 });
    const smallerRole = { ...full, gamesPlayed: 100 };
    expect(productionEvidence(smallerRole, 100, 0.36)).toEqual({
      ...productionEvidence(full, 100, 0.36),
      sampleGames: 100,
    });
  });

  it('rewards creation, offensive rebounding and turnover security at fixed scoring', () => {
    const baseline = productionEvidence(input.stats, 100, 0.36).score;
    for (const stats of [
      { ...input.stats, assists: Number(input.stats.assists) + 150 },
      { ...input.stats, offensiveRebounds: Number(input.stats.offensiveRebounds) + 100 },
      { ...input.stats, turnovers: Number(input.stats.turnovers) - 100 },
    ])
      expect(productionEvidence(stats, 100, 0.36).score).toBeGreaterThan(baseline);
  });

  it('does not invent an inefficiency penalty when shooting evidence is absent', () => {
    const missing = derive({
      stats: starterStats({ points: null, fga: null, fta: null, tsPct: null, usageRate: 35 }),
    });
    expect(missing.profile.nonlinear.weaknesses.inefficientUsage).toBe(0);
    expect(missing.profile.production.scoringSurplusPer100).toBeNull();
  });

  it('grades defensive targeting by positional responsibility', () => {
    const anchor = {
      ...ratings,
      interiorDefense: 92,
      perimeterDefense: 35,
      defensiveIq: 85,
      defensiveRebound: 85,
      block: 90,
    };
    const center = derive({ ratings: anchor, position: 'C' });
    const guard = derive({ ratings: anchor, position: 'PG' });
    expect(center.profile.nonlinear.weaknesses.defensiveTargeting).toBe(0);
    expect(guard.profile.nonlinear.weaknesses.defensiveTargeting).toBeGreaterThan(0);
  });

  it('centers inefficient-usage costs on season league efficiency', () => {
    const historical = derive({
      stats: starterStats({ tsPct: 0.52, leagueTrueShooting: 0.5, usageRate: 32 }),
    });
    const modern = derive({
      stats: starterStats({ tsPct: 0.6, leagueTrueShooting: 0.58, usageRate: 32 }),
    });
    expect(historical.profile.nonlinear.weaknesses.inefficientUsage).toBe(0);
    expect(modern.profile.nonlinear.weaknesses.inefficientUsage).toBe(0);
  });

  it('does not reward identity or estimated advanced metrics', () => {
    const original = derive();
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
    expect(derive({ stats: sparse }).profile.production.confidence).toBe('high');
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
        combineDomainValues(
          offensiveAbilityFor(ratings, input.tendencies),
          defensiveAbilityFor(ratings, 'SG'),
        ).score,
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
      'closeShot',
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
      'freeThrow',
      'offensiveRebound',
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
    expect(Math.abs(smaller.score - original.score)).toBeLessThan(1);
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
    const interior = { ...ratings, insideScoring: 90, closeShot: 90, midrange: 60, threePoint: 40 };
    const perimeter = {
      ...ratings,
      insideScoring: 40,
      closeShot: 40,
      midrange: 60,
      threePoint: 90,
    };
    expect(offensiveAbilityFor(interior, input.tendencies)).toBe(
      offensiveAbilityFor(perimeter, input.tendencies),
    );
    expect(
      Math.abs(
        derive({ ratings: interior }).profile.rawOverallScore -
          derive({ ratings: perimeter }).profile.rawOverallScore,
      ),
    ).toBeLessThan(2);
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
    const offense = {
      ...ratings,
      insideScoring: 95,
      midrange: 95,
      threePoint: 95,
      passing: 95,
      ballHandling: 95,
      offensiveIq: 95,
    };
    const stronger = {
      ...offense,
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
        derive({ stats, ratings: offense }).profile.rawOverallScore,
    );
    expect(gains[0]).toBeCloseTo(gains[1] ?? 0, 2);
    expect(gains[1]).toBeGreaterThan(0);
  });

  it('normalizes individual production by possession exposure rather than team success', () => {
    const slower: RatingProfileInput['stats'] = { ...input.stats, possessionPace: 90 };
    const faster: RatingProfileInput['stats'] = { ...input.stats, possessionPace: 120 };
    for (const key of ['points', 'assists', 'offensiveRebounds', 'fga', 'fta', 'turnovers'])
      faster[key] = (Number(slower[key]) * 120) / 90;
    expect(
      Math.abs(
        derive({ stats: slower }).profile.rawOverallScore -
          derive({ stats: faster }).profile.rawOverallScore,
      ),
    ).toBeLessThan(0.05);
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
    expect(diagnostics.recognitionWeight).toBeGreaterThan(0);
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
    expect(complete.recognitionWeight).toBe(diagnostics.recognitionWeight);
    const unrecognized = derive({ artifact, stats: input.stats }).profile.overallDiagnostics;
    if (unrecognized?.schemaVersion !== 2) throw new Error('missing diagnostics');
    expect(unrecognized.recognitionHonor).toBeNull();
    expect(unrecognized.recognitionPrior).toBeNull();
    expect(unrecognized.recognitionWeight).toBe(0);
    const observedUnrecognized = derive({ artifact, abilityProvenance: evidenced }).profile
      .overallDiagnostics;
    if (observedUnrecognized?.schemaVersion !== 2) throw new Error('missing diagnostics');
    expect(observedUnrecognized.recognitionWeight).toBe(0);
  });

  it('keeps a two-way star above a low-usage rim protector', () => {
    const neutral = Object.fromEntries(
      Object.keys(player.ratings).map((key) => [key, 60]),
    ) as typeof player.ratings;
    const anchorRatings = {
      ...neutral,
      interiorDefense: 90,
      block: 94,
      defensiveRebound: 86,
      defensiveIq: 82,
      perimeterDefense: 60,
      steal: 72,
      insideScoring: 58,
      closeShot: 55,
      midrange: 52,
      threePoint: 40,
      passing: 52,
      ballHandling: 50,
      offensiveIq: 60,
    };
    const anchorStats = starterStats({
      points: 780,
      usageRate: 15,
      assists: 140,
      tsPct: 0.5,
      fga: 700,
      fgm: 300,
    });
    const anchor = derive({ ratings: anchorRatings, position: 'C', stats: anchorStats });
    const anchorDiagnostics = anchor.profile.overallDiagnostics;
    if (anchorDiagnostics?.schemaVersion !== 2) throw new Error('missing diagnostics');
    expect(anchorDiagnostics.defensiveAbility).toBeGreaterThanOrEqual(85);
    expect(anchorDiagnostics.defensiveAbility).toBeLessThanOrEqual(93);
    expect(anchorDiagnostics.recognitionWeight).toBeLessThanOrEqual(0.2);
    const role = derive({
      ratings: { ...anchorRatings, interiorDefense: 60, block: 55, defensiveRebound: 62 },
      position: 'C',
      stats: anchorStats,
    });
    const centerLift = anchor.profile.rawOverallScore - role.profile.rawOverallScore;
    expect(centerLift).toBeGreaterThan(4);
    expect(centerLift).toBeLessThan(13);
    const star = derive({
      ratings: {
        ...anchorRatings,
        insideScoring: 94,
        closeShot: 90,
        midrange: 86,
        threePoint: 78,
        freeThrow: 84,
        passing: 80,
        ballHandling: 78,
        offensiveIq: 88,
      },
      position: 'C',
      stats: starterStats({ points: 2200, usageRate: 31, assists: 280, tsPct: 0.58 }),
    });
    expect(star.profile.rawOverallScore).toBeGreaterThan(anchor.profile.rawOverallScore + 8);
    const starDiagnostics = star.profile.overallDiagnostics;
    if (starDiagnostics?.schemaVersion !== 2) throw new Error('missing diagnostics');
    expect(starDiagnostics.offensiveAbility).toBeGreaterThan(80);
    const scorerRatings = {
      ...neutral,
      insideScoring: 92,
      threePoint: 88,
      midrange: 80,
      passing: 84,
      ballHandling: 86,
      offensiveIq: 84,
      perimeterDefense: 42,
      interiorDefense: 40,
      block: 32,
      steal: 40,
    };
    const scorer = derive({ ratings: scorerRatings, position: 'PG' });
    const scorerWithRim = derive({
      ratings: { ...scorerRatings, interiorDefense: 90, block: 94 },
      position: 'PG',
    });
    expect(scorerWithRim.profile.rawOverallScore - scorer.profile.rawOverallScore).toBeLessThan(
      centerLift,
    );
    const population = [
      ...Array.from({ length: 5000 }, (_, index) => {
        const t = index / 4999;
        return { key: `filler-${String(index)}`, score: 40 + 42 * t ** 8 };
      }),
      { key: 'anchor', score: anchor.profile.rawOverallScore },
      { key: 'star', score: star.profile.rawOverallScore },
    ];
    const cohort = buildOverallScale(population);
    const anchorOverall = overallForScore(anchor.profile.rawOverallScore, cohort).overall;
    const starOverall = overallForScore(star.profile.rawOverallScore, cohort).overall;
    expect(anchorOverall).toBeGreaterThanOrEqual(84);
    expect(anchorOverall).toBeLessThanOrEqual(92);
    expect(starOverall).toBeGreaterThanOrEqual(94);
    expect(starOverall).toBeGreaterThan(anchorOverall);
  });

  it('allows elite offense with average defense to outrank defensive specialization', () => {
    const specialist = {
      ...ratings,
      insideScoring: 45,
      midrange: 40,
      threePoint: 35,
      passing: 40,
      ballHandling: 40,
      offensiveIq: 50,
      interiorDefense: 98,
      perimeterDefense: 75,
      defensiveIq: 90,
      defensiveRebound: 98,
    };
    const creator = {
      ...ratings,
      insideScoring: 92,
      midrange: 85,
      threePoint: 88,
      passing: 92,
      ballHandling: 90,
      offensiveIq: 90,
      interiorDefense: 50,
      perimeterDefense: 60,
      defensiveIq: 60,
      defensiveRebound: 60,
    };
    const defense = derive({
      ratings: specialist,
      position: 'C',
      stats: starterStats({ points: 600, assists: 100, tsPct: 0.5, usageRate: 14 }),
    });
    const offense = derive({
      ratings: creator,
      position: 'PG',
      stats: starterStats({ points: 2400, assists: 650, tsPct: 0.62, usageRate: 32 }),
    });
    expect(offense.profile.rawOverallScore).toBeGreaterThan(defense.profile.rawOverallScore);
    expect(
      derive({
        ratings: { ...creator, perimeterDefense: 90, defensiveIq: 85 },
        stats: starterStats({ points: 2400, assists: 650, tsPct: 0.62, usageRate: 32 }),
      }).profile.rawOverallScore,
    ).toBeGreaterThan(offense.profile.rawOverallScore);
  });

  it('uses bounded individual postseason evidence without penalizing absent postseason data', () => {
    const postseason = {
      playerExternalId: 'sample',
      gamesPlayed: 20,
      minutes: 720,
      points: 680,
      assists: 180,
      rebounds: 120,
      offensiveRebounds: 20,
      defensiveRebounds: 100,
      steals: 20,
      blocks: 10,
      turnovers: 40,
      fga: 440,
      fta: 150,
      tsPct: 0.64,
    };
    const regular = derive().profile;
    const strong = derive({ postseason }).profile;
    expect(strong.rawOverallScore).toBeGreaterThan(regular.rawOverallScore);
    expect(strong.rawOverallScore - regular.rawOverallScore).toBeLessThanOrEqual(1.801);
    expect(derive({ postseasonEvidenceAvailable: false }).profile.rawOverallScore).toBe(
      regular.rawOverallScore,
    );
    expect(ratingProfileSchema.safeParse(strong).success).toBe(true);
  });

  it('does not mistake defensive events for IQ or physical measurements', () => {
    const base = {
      season: '2023-24',
      position: 'C',
      heightInches: 82,
      weightLbs: 240,
      stats: starterStats(),
      era: { pace: 100, leaguePpg: 114, league3PARate: 0.4 },
    };
    const regular = estimateAttributes(base);
    const events = estimateAttributes({
      ...base,
      stats: { ...base.stats, blocks: 300, steals: 200 },
    });
    expect(events.block.value).toBeGreaterThan(regular.block.value);
    expect(events.defensiveIq).toEqual(regular.defensiveIq);
    expect(events.vertical).toEqual(regular.vertical);
    expect(events.strength).toEqual(regular.strength);
    const defendedRim = estimateAttributes({
      ...base,
      stats: {
        ...base.stats,
        blocks: 300,
        steals: 200,
        defFgPct: 0.59,
        leagueRimFgPct: 0.62,
        defRimFga: 500,
      },
    });
    expect(defendedRim.interiorDefense.value).toBeLessThan(events.interiorDefense.value);
    expect(defendedRim.interiorDefense.value).toBeGreaterThan(regular.interiorDefense.value);
    const measurement = estimateAttributes({
      ...base,
      stats: { ...base.stats, maxVerticalInches: 38 },
    });
    expect(measurement.vertical.value).toBeGreaterThan(regular.vertical.value);
    expect(regular.vertical.kind).toBe('estimated');
    expect(measurement.vertical.kind).toBe('derived');
  });
});

describe('role and impact contributions', () => {
  it('reconciles contributions even when an exceptional profile reaches the raw-score ceiling', () => {
    const exceptional = derive({
      season: '2000-01',
      teamWinPct: 0.9,
      ratings: Object.fromEntries(
        REQUIRED_RATING_KEYS.map((key) => [key, 100]),
      ) as SimulationRatings,
      stats: {
        ...input.stats,
        points: 10000,
        assists: 2000,
        minutes: 10000,
        tsPct: 1,
        honors: ['MVP-1', 'DEF1'],
      },
      artifact: {
        ...input.artifact,
        eraReference: { mean: 80, standardDeviation: 20, sampleCount: 10000 },
        eraReferences: { '2000s': { mean: 20, standardDeviation: 1, sampleCount: 10000 } },
      },
    }).profile;
    expect(exceptional.rawOverallScore).toBe(100);
    expect(ratingProfileSchema.safeParse(exceptional).success).toBe(true);
  });

  it('adds observed awards without stacking overlapping teams or duplicate honors', () => {
    const baseline = derive().profile.rawOverallScore;
    const award = (honors: string[]) => derive({ stats: { ...input.stats, honors } }).profile;
    expect(award(['MVP-1']).rawOverallScore).toBeGreaterThan(award(['NBA1']).rawOverallScore);
    expect(award(['NBA1']).rawOverallScore).toBeGreaterThan(award(['NBA2']).rawOverallScore);
    expect(award(['NBA2']).rawOverallScore).toBeGreaterThan(award(['NBA3']).rawOverallScore);
    expect(award(['NBA3']).rawOverallScore).toBeGreaterThan(baseline);
    expect(award(['MVP-1', 'NBA1', 'NBA2', 'MVP-1']).rawOverallScore).toBe(
      award(['MVP-1']).rawOverallScore,
    );
    const decorated = award(['MVP-1', 'DEF1', 'DEF2']);
    expect(decorated.rawOverallScore).toBeGreaterThan(award(['MVP-1']).rawOverallScore);
    expect(decorated.rawOverallScore - baseline).toBeLessThanOrEqual(2.5);
    expect(ratingProfileSchema.safeParse(decorated).success).toBe(true);
  });

  it('shrinks team record by player involvement and treats missing records neutrally', () => {
    const baseline = derive().profile.rawOverallScore;
    const winning = derive({ teamWinPct: 0.9 }).profile;
    const losing = derive({ teamWinPct: 0.1 }).profile;
    expect(winning.rawOverallScore).toBeGreaterThan(baseline);
    expect(losing.rawOverallScore).toBeLessThan(baseline);
    expect(winning.rawOverallScore - baseline).toBeLessThanOrEqual(1);
    expect(baseline - losing.rawOverallScore).toBeLessThanOrEqual(1);
    for (const teamWinPct of [null, undefined, 0.5, NaN, -1, 2]) {
      expect(derive({ teamWinPct }).profile.rawOverallScore).toBe(baseline);
    }
    const benchStats = { ...input.stats, minutes: Number(input.stats.gamesPlayed) * 5 };
    const benchGain =
      derive({ stats: benchStats, teamWinPct: 0.9 }).profile.rawOverallScore -
      derive({ stats: benchStats }).profile.rawOverallScore;
    expect(benchGain).toBeLessThan(winning.rawOverallScore - baseline);
    expect(ratingProfileSchema.safeParse(winning).success).toBe(true);
    expect(ratingProfileSchema.safeParse(losing).success).toBe(true);
  });

  it('does not assign the last roster team record to an aggregate multi-team season', () => {
    const records = new Map([['winner', 0.8]]);
    expect(observedTeamRecord({ teamExternalId: 'winner' }, null, records)).toBe(0.8);
    expect(observedTeamRecord({}, 'winner', records)).toBe(0.8);
    expect(observedTeamRecord({ teamExternalId: '0' }, 'winner', records)).toBeNull();
    expect(observedTeamRecord({}, null, records)).toBeNull();
  });

  it('does not lower overall when a basketball skill improves across rating levels', () => {
    for (const position of ['PG', 'SF', 'C']) {
      for (const level of [35, 65, 90]) {
        const baselineRatings = Object.fromEntries(
          REQUIRED_RATING_KEYS.map((key) => [key, level]),
        ) as SimulationRatings;
        const baseline = derive({ position, ratings: baselineRatings }).profile.rawOverallScore;
        for (const key of REQUIRED_RATING_KEYS) {
          const improved = derive({
            position,
            ratings: { ...baselineRatings, [key]: Math.min(100, level + 10) },
          }).profile.rawOverallScore;
          expect(improved, `${position}/${String(level)}/${key}`).toBeGreaterThanOrEqual(baseline);
        }
      }
    }
  });

  it('records bounded role contributions and reconciles the raw score', () => {
    const result = derive({
      ratings: { ...ratings, ballHandling: 95, passing: 95, offensiveIq: 95, speed: 95 },
      tendencies: { ...input.tendencies, turnoverRate: 25, foulRate: 10 },
    });
    const diagnostics = result.profile.overallDiagnostics;
    if (diagnostics?.schemaVersion !== 2) throw new Error('missing diagnostics');
    expect(diagnostics.synergyContribution).toBeGreaterThan(0);
    expect(diagnostics.synergyContribution).toBeLessThanOrEqual(2.5);
    expect(diagnostics.weaknessContribution).toBeLessThan(0);
    expect(diagnostics.weaknessContribution).toBeGreaterThanOrEqual(-3);
    expect(ratingProfileSchema.safeParse(result.profile).success).toBe(true);
    expect(
      ratingProfileSchema.safeParse({
        ...result.profile,
        overallDiagnostics: { ...diagnostics, synergyContribution: 0 },
      }).success,
    ).toBe(false);
  });

  it('values close scoring, defensive events, and athletic skill combinations', () => {
    const original = derive();
    for (const key of ['closeShot', 'steal', 'block'] as const) {
      expect(
        derive({ ratings: { ...ratings, [key]: 95 } }).profile.rawOverallScore,
      ).toBeGreaterThan(original.profile.rawOverallScore);
    }
    const skilled = {
      ...ratings,
      insideScoring: 90,
      ballHandling: 90,
      perimeterDefense: 90,
      interiorDefense: 90,
      block: 90,
    };
    const athletic = { ...skilled, speed: 95, strength: 95, vertical: 95 };
    for (const key of ['speed', 'strength', 'vertical'] as const) {
      expect(
        derive({ ratings: { ...skilled, [key]: 95 } }).profile.rawOverallScore,
      ).toBeGreaterThan(derive({ ratings: skilled }).profile.rawOverallScore);
    }
    expect(derive({ ratings: athletic }).profile.rawOverallScore).toBeGreaterThan(
      derive({ ratings: skilled }).profile.rawOverallScore,
    );
    expect(derive({ ratings: athletic })).toEqual(derive({ ratings: athletic }));
  });

  it('requires current impact metrics and a full context sample, then caps both signs', () => {
    const adjustment = {
      adjustment: 6,
      confidence: 1,
      sampleCount:
        input.artifact.confidenceTargetSamplesPerContext * input.artifact.contexts.length,
      metrics: {
        netRating: 10,
        winProbability: 0.1,
        offensiveEfficiency: 5,
        defensiveEfficiency: 5,
        turnovers: 0,
        rebounds: 1,
        shotQuality: 0.1,
      },
    };
    const impact = (overrides: Partial<typeof adjustment> = {}, current = true) =>
      derive({
        playerId: 'supported',
        artifact: {
          ...input.artifact,
          impactModelVersion: current ? input.artifact.modelVersion : 'old-model',
          playerAdjustments: { supported: { ...adjustment, ...overrides } },
        },
      });
    const baseline = derive().profile.rawOverallScore;
    expect(impact().profile.rawOverallScore - baseline).toBeCloseTo(2, 4);
    expect(impact({ adjustment: -6 }).profile.rawOverallScore - baseline).toBeCloseTo(-2, 4);
    expect(impact({ confidence: 0 }).profile.rawOverallScore).toBe(baseline);
    expect(impact({ sampleCount: adjustment.sampleCount - 1 }).profile.rawOverallScore).toBe(
      baseline,
    );
    expect(impact({}, false).profile.rawOverallScore).toBe(baseline);
    expect(ratingProfileSchema.safeParse(impact().profile).success).toBe(true);
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
