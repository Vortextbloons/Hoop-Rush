import { describe, expect, it } from 'vitest';
import type { HavocMutationPackage, HavocSourcePlayer } from '@hoop-rush/data-contracts';
import { SIMULATION_RATINGS, SIMULATION_TENDENCIES } from '@hoop-rush/data-contracts';
import { buildHavocSourcePlayer } from '@hoop-rush/test-fixtures';
import { applyHavocMutationPackage } from './transform.ts';

function sourceWith(
  overrides: {
    ratings?: Partial<typeof SIMULATION_RATINGS>;
    tendencies?: Partial<typeof SIMULATION_TENDENCIES>;
    heightInches?: number | null;
    weightLbs?: number | null;
  } = {},
): HavocSourcePlayer {
  return buildHavocSourcePlayer({
    profile: {
      ratings: { ...SIMULATION_RATINGS, ...overrides.ratings },
      tendencies: { ...SIMULATION_TENDENCIES, ...overrides.tendencies },
    },
    physical: {
      heightInches: overrides.heightInches === undefined ? 76 : overrides.heightInches,
      weightLbs: overrides.weightLbs === undefined ? 200 : overrides.weightLbs,
    },
  });
}

describe('havoc mutation transform', () => {
  it('applies positive floors but keeps an already higher rating', () => {
    const raised = applyHavocMutationPackage(sourceWith(), [{ mutationId: 'super-soldier' }]);
    expect(raised.ratings.speed).toBe(90);
    expect(raised.ratings.strength).toBe(90);
    expect(raised.ratings.vertical).toBe(90);
    const alreadyHigher = applyHavocMutationPackage(
      sourceWith({ ratings: { speed: 99, strength: 100, vertical: 99 } }),
      [{ mutationId: 'super-soldier' }],
    );
    expect(alreadyHigher.ratings.speed).toBe(99);
    expect(alreadyHigher.ratings.strength).toBe(100);
  });

  it('applies caps but keeps an already lower value', () => {
    const capped = applyHavocMutationPackage(sourceWith(), [{ mutationId: 'trigger-happy' }]);
    expect(capped.tendencies.passRate).toBe(2);
    const alreadyLower = applyHavocMutationPackage(sourceWith({ tendencies: { passRate: 0 } }), [
      { mutationId: 'trigger-happy' },
    ]);
    expect(alreadyLower.tendencies.passRate).toBe(0);
  });

  it('applies positive adds before floors and caps', () => {
    const effective = applyHavocMutationPackage(sourceWith(), [
      { mutationId: 'walking-bucket' },
      { mutationId: 'freak-athlete' },
    ]);
    expect(effective.ratings.midrange).toBe(40);
    expect(effective.ratings.closeShot).toBe(99);
    expect(effective.ratings.insideScoring).toBe(100);
  });

  it('sets Mini Monster to 60 inches and raises speed and ball handling to 99', () => {
    const effective = applyHavocMutationPackage(sourceWith(), [{ mutationId: 'mini-monster' }]);
    expect(effective.physical.heightInches).toBe(60);
    expect(effective.physical.baselineHeightInches).toBe(76);
    expect(effective.physical.baselineHeightSource).toBe('source');
    expect(effective.physical.reachUnits).toBeCloseTo(-16 / 12, 10);
    expect(effective.ratings.speed).toBe(99);
    expect(effective.ratings.ballHandling).toBe(99);
  });

  it('clamps Mini Monster height for an already 60-inch source', () => {
    const effective = applyHavocMutationPackage(sourceWith({ heightInches: 60 }), [
      { mutationId: 'mini-monster' },
    ]);
    expect(effective.physical.heightInches).toBe(60);
  });

  it('adds a Growth Spurt sample of 6..12 inches and honors the estimate', () => {
    const plusSix = applyHavocMutationPackage(sourceWith(), [
      { mutationId: 'growth-spurt', sampledHeightDelta: 6 },
    ]);
    expect(plusSix.physical.heightInches).toBe(82);
    const plusTwelve = applyHavocMutationPackage(sourceWith({ heightInches: 96 }), [
      { mutationId: 'growth-spurt', sampledHeightDelta: 12 },
    ]);
    expect(plusTwelve.physical.heightInches).toBe(108);
    const estimated = applyHavocMutationPackage(
      sourceWith({ heightInches: null }),
      [{ mutationId: 'growth-spurt', sampledHeightDelta: 8 }],
      { slot: 'PG' },
    );
    expect(estimated.physical.baselineHeightSource).toBe('estimated');
    expect(estimated.physical.baselineHeightInches).toBe(74);
    expect(estimated.physical.heightInches).toBe(82);
  });

  it('subtracts Reverse Evolution height and clamps to 50 inches', () => {
    const evolved = applyHavocMutationPackage(sourceWith(), [{ mutationId: 'reverse-evolution' }]);
    expect(evolved.physical.heightInches).toBe(66);
    expect(evolved.ratings.perimeterDefense).toBe(99);
    expect(evolved.ratings.steal).toBe(99);
    expect(evolved.tendencies.stealAttemptRate).toBe(20);
    const floored = applyHavocMutationPackage(sourceWith({ heightInches: 60 }), [
      { mutationId: 'reverse-evolution' },
    ]);
    expect(floored.physical.heightInches).toBe(50);
  });

  it('adds Alien Arms reach and derives reach units', () => {
    const effective = applyHavocMutationPackage(sourceWith(), [{ mutationId: 'alien-arms' }]);
    expect(effective.physical.wingspanDeltaInches).toBe(18);
    expect(effective.physical.reachUnits).toBeCloseTo(0.75, 10);
    const combined = applyHavocMutationPackage(sourceWith(), [
      { mutationId: 'growth-spurt', sampledHeightDelta: 8 },
      { mutationId: 'alien-arms' },
    ]);
    expect(combined.physical.heightInches).toBe(84);
    expect(combined.physical.wingspanDeltaInches).toBe(18);
    expect(combined.physical.reachUnits).toBeCloseTo((8 + 9) / 12, 10);
  });

  it('applies Walking Bucket additive deltas and tendency floors', () => {
    const effective = applyHavocMutationPackage(sourceWith(), [{ mutationId: 'walking-bucket' }]);
    expect(effective.ratings.insideScoring).toBe(100);
    expect(effective.ratings.closeShot).toBe(90);
    expect(effective.ratings.midrange).toBe(98);
    expect(effective.tendencies.isolationRate).toBe(85);
    expect(effective.tendencies.shortMidFrequency).toBe(50);
    expect(effective.tendencies.longMidFrequency).toBe(80);
  });

  it('applies Trigger Happy ratings, usage, shot rate, and the pass-rate cap', () => {
    const effective = applyHavocMutationPackage(sourceWith(), [{ mutationId: 'trigger-happy' }]);
    expect(effective.ratings.insideScoring).toBe(99);
    expect(effective.ratings.closeShot).toBe(99);
    expect(effective.ratings.midrange).toBe(99);
    expect(effective.ratings.threePoint).toBe(99);
    expect(effective.ratings.freeThrow).toBe(99);
    expect(effective.tendencies.shotRate).toBe(99);
    expect(effective.tendencies.usageRate).toBe(45);
    expect(effective.tendencies.passRate).toBe(2);
  });

  it('applies Butterfingers covers and the ball-handling cap', () => {
    const effective = applyHavocMutationPackage(sourceWith(), [{ mutationId: 'butterfingers' }]);
    expect(effective.ratings.insideScoring).toBe(99);
    expect(effective.ratings.closeShot).toBe(99);
    expect(effective.ratings.ballHandling).toBe(20);
    expect(effective.tendencies.turnoverRate).toBe(25);
  });

  it('applies Freak Athlete floors and shooting caps', () => {
    const effective = applyHavocMutationPackage(sourceWith(), [{ mutationId: 'freak-athlete' }]);
    expect(effective.ratings.vertical).toBe(99);
    expect(effective.ratings.insideScoring).toBe(99);
    expect(effective.ratings.closeShot).toBe(99);
    expect(effective.ratings.threePoint).toBe(30);
    expect(effective.ratings.midrange).toBe(40);
  });

  it('applies The Statue floors and the speed cap', () => {
    const effective = applyHavocMutationPackage(sourceWith(), [{ mutationId: 'the-statue' }]);
    expect(effective.ratings.strength).toBe(99);
    expect(effective.ratings.insideScoring).toBe(99);
    expect(effective.ratings.closeShot).toBe(99);
    expect(effective.tendencies.postUpRate).toBe(90);
    expect(effective.ratings.speed).toBe(15);
  });

  it('applies Sniper Gene and Point God channels and values', () => {
    const sniper = applyHavocMutationPackage(sourceWith(), [{ mutationId: 'sniper-gene' }]);
    expect(sniper.ratings.threePoint).toBe(97);
    expect(sniper.tendencies.threePointRate).toBe(80);
    expect(sniper.authoritativeChannels).toEqual(['three-point-accuracy', 'three-point-volume']);
    const pointGod = applyHavocMutationPackage(sourceWith(), [{ mutationId: 'point-god' }]);
    expect(pointGod.ratings.passing).toBe(99);
    expect(pointGod.ratings.ballHandling).toBe(99);
    expect(pointGod.tendencies.passRate).toBe(85);
    expect(pointGod.authoritativeChannels).toEqual(['assist-anchor']);
  });

  it('derives authoritative channels from written fields only', () => {
    const brickWall = applyHavocMutationPackage(sourceWith(), [{ mutationId: 'brick-wall' }]);
    expect(brickWall.authoritativeChannels).toEqual(['block-anchor']);
    const glassEater = applyHavocMutationPackage(sourceWith(), [{ mutationId: 'glass-eater' }]);
    expect(glassEater.authoritativeChannels).toEqual(['rebound-weights']);
    const butterfingers = applyHavocMutationPackage(sourceWith(), [
      { mutationId: 'butterfingers' },
    ]);
    expect(butterfingers.authoritativeChannels).toEqual(['two-point-accuracy', 'turnover-blend']);
    const walkingBucket = applyHavocMutationPackage(sourceWith(), [
      { mutationId: 'walking-bucket' },
    ]);
    expect(walkingBucket.authoritativeChannels).toEqual(['two-point-accuracy']);
    const reverseEvolution = applyHavocMutationPackage(sourceWith(), [
      { mutationId: 'reverse-evolution' },
    ]);
    expect(reverseEvolution.authoritativeChannels).toEqual([]);
  });

  it('does not mutate the source or the package', () => {
    const source = sourceWith();
    const mutationPackage: HavocMutationPackage = [
      { mutationId: 'growth-spurt', sampledHeightDelta: 7 },
      { mutationId: 'walking-bucket' },
    ];
    const sourceBefore = structuredClone(source);
    const packageBefore = structuredClone(mutationPackage);
    applyHavocMutationPackage(source, mutationPackage, { slot: 'PF' });
    expect(source).toEqual(sourceBefore);
    expect(mutationPackage).toEqual(packageBefore);
  });

  it('requires a baseline when the source has no height', () => {
    expect(() =>
      applyHavocMutationPackage(sourceWith({ heightInches: null }), [
        { mutationId: 'sniper-gene' },
      ]),
    ).toThrow();
  });

  it('keeps ratings and tendencies inside 0..100', () => {
    const effective = applyHavocMutationPackage(
      sourceWith({ ratings: { insideScoring: 95 }, tendencies: { shotRate: 98 } }),
      [{ mutationId: 'walking-bucket' }, { mutationId: 'trigger-happy' }],
    );
    for (const value of Object.values(effective.ratings)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
      expect(Number.isInteger(value)).toBe(true);
    }
    for (const value of Object.values(effective.tendencies)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});
