import { describe, expect, it } from 'bun:test';
import { estimateAttributes } from './statistical-attributes.ts';
import { derivePlayerRecord, type DerivationInput } from './v2.ts';
import { starterStats } from './ratings-test-support.ts';

const input: DerivationInput = {
  season: '1989-90',
  position: 'SG',
  heightInches: 78,
  weightLbs: 200,
  age: 27,
  stats: starterStats(),
  era: { pace: 100, league3PARate: 0.1, leaguePpg: 105 },
};

describe('statistical attribute evidence', () => {
  it('does not mistake efficient two-point finishing for measured midrange ability', () => {
    const ordinary = estimateAttributes(input);
    const finishing = estimateAttributes({ ...input, stats: starterStats({ fgm: 850 }) });
    expect(finishing.insideScoring.value).toBeGreaterThan(ordinary.insideScoring.value);
    expect(finishing.midrange.value).toBe(ordinary.midrange.value);
    expect(finishing.midrange.kind).toBe('estimated');
  });

  it('does not turn additional three-point scoring into better interior skills', () => {
    const original = estimateAttributes(input);
    const shooting = estimateAttributes({
      ...input,
      stats: starterStats({ points: 1980, fgm: 730, fga: 1550, tpm: 260, tpa: 610 }),
    });
    expect(shooting.insideScoring.value).toBeCloseTo(original.insideScoring.value, 8);
    expect(shooting.closeShot.value).toBeCloseTo(original.closeShot.value, 8);
    expect(shooting.midrange.value).toBeCloseTo(original.midrange.value, 8);
  });

  it('lets measured rim and midrange evidence override historical estimates', () => {
    const measured = estimateAttributes({
      ...input,
      stats: starterStats({ insideFgm: 350, insideFga: 500, midFgm: 250, midFga: 500 }),
    });
    const missing = estimateAttributes(input);
    expect(measured.insideScoring.kind).toBe('derived');
    expect(measured.midrange.kind).toBe('derived');
    expect(measured.midrange.value).toBeGreaterThan(missing.midrange.value);
    expect(missing.midrange.confidence).toBe('low');
  });

  it('requires creation evidence for high usage to imply strong ball handling', () => {
    const estimate = (assists: number) =>
      estimateAttributes({
        ...input,
        stats: starterStats({ usageRate: 32, assists, turnovers: 180 }),
      });
    expect(estimate(80).ballHandling.value).toBeLessThan(estimate(500).ballHandling.value);
  });

  it('varies athletic estimates with size and age without inventing measured confidence', () => {
    const guard = estimateAttributes({
      ...input,
      position: 'PG',
      heightInches: 74,
      weightLbs: 185,
    });
    const center = estimateAttributes({
      ...input,
      position: 'C',
      heightInches: 85,
      weightLbs: 280,
    });
    const older = estimateAttributes({ ...input, age: 38 });
    const prime = estimateAttributes(input);
    expect(guard.speed.value).toBeGreaterThan(center.speed.value);
    expect(older.speed.value).toBeLessThan(prime.speed.value);
    expect(older.vertical.value).toBeLessThan(prime.vertical.value);
    expect(guard.speed.confidence).toBe('low');
    expect(prime.vertical.confidence).toBe('low');
    expect(prime.vertical.fields).toContain('age');
  });

  it('bounds movement tracking influence and ignores absent tracking samples', () => {
    const base = estimateAttributes(input).speed.value;
    const tracked = estimateAttributes({
      ...input,
      stats: starterStats({ avgSpeed: 20, drives: 500, drivesMinutes: 2850 }),
    });
    expect(tracked.speed.value - base).toBeLessThanOrEqual(6);
    expect(estimateAttributes({ ...input, stats: starterStats({ drives: 500 }) }).speed.value).toBe(
      base,
    );
  });

  it('uses a measured vertical rather than the positional fallback', () => {
    const jump = estimateAttributes({
      ...input,
      stats: starterStats({ maxVerticalInches: 40 }),
    }).vertical;
    expect(jump.kind).toBe('derived');
    expect(jump.value).toBe(94);
  });

  it('derives missing usage consistently for historical tendencies and attributes', () => {
    const record = derivePlayerRecord({ ...input, stats: starterStats({ usageRate: null }) });
    expect(record.tendencies.usageRate).toBeGreaterThan(25);
    expect(record.provenance.usageRate?.kind).toBe('derived');
    expect(record.provenance.usageRate?.sourceFields).toContain('fga');
  });
});
