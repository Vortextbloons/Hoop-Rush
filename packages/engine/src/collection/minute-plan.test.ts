import { describe, expect, it } from 'vitest';
import {
  buildCollectionMinutePlans,
  overallWeightOf,
  planCollectionMinutes,
  policyWeightOf,
  strategyForDifficulty,
  tryCollectionMinuteDnp,
  type CollectionMinuteEntry,
} from './minute-plan.ts';

function entriesTwelve(): CollectionMinuteEntry[] {
  const entries: CollectionMinuteEntry[] = [];
  for (let index = 0; index < 12; index += 1) {
    const starter = index < 5;
    const overall = starter ? 88 - index : 78 - (index - 5);
    entries.push({
      cardId: `card-${String(index).padStart(2, '0')}`,
      starter,
      overall,
      weight: overallWeightOf(overall),
    });
  }
  return entries;
}

describe('collection minute plan', () => {
  it('totals 240 with starter floors and caps on a full roster', () => {
    for (const strategy of ['tight', 'balanced', 'deep'] as const) {
      const plan = planCollectionMinutes(entriesTwelve(), strategy, 48);
      const total = plan.targetMinutes.reduce((sum, row) => sum + row.minutes, 0);
      expect(total).toBe(240);
      for (const row of plan.targetMinutes) {
        expect(row.minutes).toBeGreaterThanOrEqual(0);
        expect(row.minutes).toBeLessThanOrEqual(48);
      }
      for (const row of plan.targetMinutes.slice(0, 5)) {
        expect(row.minutes).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('orders starter share tight > balanced > deep', () => {
    const plans = buildCollectionMinutePlans(entriesTwelve(), 48);
    const share = new Map(plans.map((plan) => [plan.strategy, plan.starterTotal]));
    expect(share.get('tight') ?? 0).toBeGreaterThan(share.get('balanced') ?? 0);
    expect(share.get('balanced') ?? 0).toBeGreaterThan(share.get('deep') ?? 0);
  });

  it('gives more minutes to higher-overall starters', () => {
    const entries: CollectionMinuteEntry[] = [
      { cardId: 'card-star', starter: true, overall: 95, weight: overallWeightOf(95) },
      { cardId: 'card-a', starter: true, overall: 80, weight: overallWeightOf(80) },
      { cardId: 'card-b', starter: true, overall: 80, weight: overallWeightOf(80) },
      { cardId: 'card-c', starter: true, overall: 80, weight: overallWeightOf(80) },
      { cardId: 'card-d', starter: true, overall: 80, weight: overallWeightOf(80) },
      { cardId: 'card-bench', starter: false, overall: 75, weight: overallWeightOf(75) },
    ];
    const plan = planCollectionMinutes(entries, 'balanced', 48);
    const minutes = new Map(plan.targetMinutes.map((row) => [row.cardId, row.minutes]));
    expect(minutes.get('card-star') ?? 0).toBeGreaterThan(minutes.get('card-a') ?? 0);
  });

  it('is deterministic for identical input', () => {
    const first = planCollectionMinutes(entriesTwelve(), 'tight', 48);
    const second = planCollectionMinutes(entriesTwelve(), 'tight', 48);
    expect(second).toEqual(first);
  });

  it('fits bench totals when starter share would exceed bench capacity', () => {
    const entries: CollectionMinuteEntry[] = [];
    for (let index = 0; index < 5; index += 1) {
      entries.push({
        cardId: `card-s${String(index)}`,
        starter: true,
        overall: 90,
        weight: overallWeightOf(90),
      });
    }
    for (let index = 0; index < 3; index += 1) {
      entries.push({
        cardId: `card-b${String(index)}`,
        starter: false,
        overall: 70,
        weight: overallWeightOf(70),
      });
    }
    const plan = planCollectionMinutes(entries, 'balanced', 48);
    expect(plan.targetMinutes.reduce((sum, row) => sum + row.minutes, 0)).toBe(240);
    for (const row of plan.targetMinutes) {
      expect(row.minutes).toBeLessThanOrEqual(48);
    }
  });

  it('clamps small rosters to 240 without breaking caps', () => {
    const entries: CollectionMinuteEntry[] = [
      { cardId: 'card-00', starter: true, overall: 90, weight: overallWeightOf(90) },
      { cardId: 'card-01', starter: true, overall: 85, weight: overallWeightOf(85) },
      { cardId: 'card-02', starter: true, overall: 84, weight: overallWeightOf(84) },
      { cardId: 'card-03', starter: true, overall: 83, weight: overallWeightOf(83) },
      { cardId: 'card-04', starter: true, overall: 82, weight: overallWeightOf(82) },
      { cardId: 'card-05', starter: false, overall: 70, weight: overallWeightOf(70) },
    ];
    const plan = planCollectionMinutes(entries, 'deep', 48);
    const total = plan.targetMinutes.reduce((sum, row) => sum + row.minutes, 0);
    expect(total).toBe(240);
    for (const row of plan.targetMinutes) {
      expect(row.minutes).toBeLessThanOrEqual(48);
    }
  });

  it('covers a five-card roster with no bench at the cap', () => {
    const entries: CollectionMinuteEntry[] = [60, 61, 62, 63, 64].map((overall, index) => ({
      cardId: `card-0${String(index)}`,
      starter: true,
      overall,
      weight: overallWeightOf(overall),
    }));
    const plan = planCollectionMinutes(entries, 'balanced', 48);
    expect(plan.targetMinutes.reduce((sum, row) => sum + row.minutes, 0)).toBe(240);
    for (const row of plan.targetMinutes) {
      expect(row.minutes).toBeLessThanOrEqual(48);
      expect(row.minutes).toBeGreaterThanOrEqual(1);
    }
  });

  it('maps difficulties deep < balanced < tight', () => {
    expect(strategyForDifficulty('street')).toBe('deep');
    expect(strategyForDifficulty('pro')).toBe('balanced');
    expect(strategyForDifficulty('legend')).toBe('tight');
  });

  it('DNPs a far-weaker bench straggler on legend without losing quality', () => {
    const entries: CollectionMinuteEntry[] = [];
    for (let index = 0; index < 5; index += 1) {
      entries.push({
        cardId: `card-s${String(index)}`,
        starter: true,
        overall: 90,
        weight: overallWeightOf(90),
      });
    }
    for (let index = 0; index < 6; index += 1) {
      entries.push({
        cardId: `card-g${String(index)}`,
        starter: false,
        overall: 85,
        weight: overallWeightOf(85),
      });
    }
    entries.push({ cardId: 'card-weak', starter: false, overall: 60, weight: overallWeightOf(60) });
    const plan = planCollectionMinutes(entries, 'tight', 48);
    const dnp = tryCollectionMinuteDnp(entries, plan, 48);
    expect(dnp).not.toBeNull();
    const minutes = new Map(dnp?.targetMinutes.map((row) => [row.cardId, row.minutes]) ?? []);
    expect(minutes.get('card-weak')).toBe(0);
    const total = (dnp?.targetMinutes ?? []).reduce((sum, row) => sum + row.minutes, 0);
    expect(total).toBe(240);
    expect(dnp?.quality ?? 0).toBeGreaterThanOrEqual(plan.quality);
  });

  it('does not DNP a flat bench', () => {
    const plan = planCollectionMinutes(entriesTwelve(), 'balanced', 48);
    expect(tryCollectionMinuteDnp(entriesTwelve(), plan, 48)).toBeNull();
  });

  it('weights policy bonuses toward higher overall cards', () => {
    const policy = {
      starterWeightBp: 20_000,
      benchWeightBp: 8000,
      overallBonusFloor: 75,
      overallBonusPerPointBp: 400,
      maxMinutes: 42,
      closingFivePolicy: 'best-legal-five' as const,
    };
    expect(policyWeightOf(90, true, policy)).toBeGreaterThan(policyWeightOf(76, true, policy));
    expect(policyWeightOf(90, true, policy)).toBeGreaterThan(policyWeightOf(90, false, policy));
  });
});
