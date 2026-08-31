import { describe, expect, it } from 'vitest';
import {
  aggregateMechanismEvidence,
  deltaToPp,
  fatigueBand,
  fatiguePercent,
  projectedFatigueBand,
} from './season-effects-view';
describe('M2.4 season effects view', () => {
  it('maps fatigue basis points to the frozen bands', () => {
    expect(fatigueBand(0)).toBe('fresh');
    expect(fatigueBand(1499)).toBe('fresh');
    expect(fatigueBand(1500)).toBe('ready');
    expect(fatigueBand(3499)).toBe('ready');
    expect(fatigueBand(3500)).toBe('tired');
    expect(fatigueBand(5999)).toBe('tired');
    expect(fatigueBand(6000)).toBe('heavy');
    expect(fatigueBand(10000)).toBe('heavy');
    expect(fatiguePercent(2500)).toBe(25);
  });
  it('aggregates retained-detail mechanism evidence per mechanism and side', () => {
    const base = {
      mechanism: 'shooter-fatigue' as const,
      side: 'home' as const,
      opportunities: 3,
      inputTotals: { shooter: 1500000, handler: 0, defenseMean: 0, unitChemistry: 0 },
      deltaTotals: -37500,
      deltaMin: -12500,
      deltaMax: -12500,
    };
    const rows = aggregateMechanismEvidence([
      {
        schemaVersion: 1,
        runId: 'r',
        gameId: 's000001',
        round: 1,
        homeFranchiseId: 'lakers',
        awayFranchiseId: 'celtics',
        result: {} as never,
        injuryEvents: [],
        mechanismEvidence: [base],
      },
      {
        schemaVersion: 1,
        runId: 'r',
        gameId: 's000002',
        round: 2,
        homeFranchiseId: 'lakers',
        awayFranchiseId: 'celtics',
        result: {} as never,
        injuryEvents: [],
        mechanismEvidence: [
          {
            mechanism: 'shooter-fatigue',
            side: 'home',
            opportunities: 1,
            inputTotals: { shooter: 500000, handler: 0, defenseMean: 0, unitChemistry: 0 },
            deltaTotals: -12500,
            deltaMin: -12500,
            deltaMax: -12500,
          },
          {
            mechanism: 'assist-conversion',
            side: 'home',
            opportunities: 2,
            inputTotals: { shooter: 0, handler: 0, defenseMean: 0, unitChemistry: 1200000 },
            deltaTotals: 42000,
            deltaMin: 21000,
            deltaMax: 21000,
          },
        ],
      },
    ]);
    const shooter = rows.find((row) => row.mechanism === 'shooter-fatigue' && row.side === 'home');
    expect(shooter).toBeDefined();
    expect(shooter?.opportunities).toBe(4);
    expect(shooter?.deltaTotals).toBe(-50000);
    expect(shooter?.deltaMin).toBe(-12500);
    expect(shooter?.deltaMax).toBe(-12500);
    expect(shooter?.avgInputFraction).toBeCloseTo(0.5, 6);
    const assist = rows.find((row) => row.mechanism === 'assist-conversion' && row.side === 'home');
    expect(assist?.avgInputFraction).toBeCloseTo(0.6, 6);
    expect(rows.length).toBe(2);
    expect(deltaToPp(25000)).toBe(2.5);
    expect(deltaToPp(-12500)).toBe(-1.25);
  });
  it('projects fatigue bands deterministically and monotonically with minutes', () => {
    expect(projectedFatigueBand(0, 0, 80, 10)).toBe('fresh');
    const light = projectedFatigueBand(0, 8, 80, 10);
    const heavy = projectedFatigueBand(0, 48, 80, 10);
    const bands = ['fresh', 'ready', 'tired', 'heavy'] as const;
    expect(bands.indexOf(heavy)).toBeGreaterThanOrEqual(bands.indexOf(light));
    expect(bands.indexOf(projectedFatigueBand(10000, 48, 45, 1))).toBeGreaterThanOrEqual(
      bands.indexOf('tired'),
    );
    expect(projectedFatigueBand(10000, 48, 45, 10)).not.toBe('heavy');
  });
});
