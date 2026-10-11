import { describe, expect, it } from 'vitest';
import {
  HAVOC_EFFECTIVE_HEIGHT_MAX,
  HAVOC_EFFECTIVE_HEIGHT_MIN,
  clampHavocEffectiveHeight,
  clampHavocWingspanDelta,
  havocBaselineHeightInches,
  havocReachUnits,
} from './physical.ts';

describe('havoc physical helpers', () => {
  it('uses the source height when present', () => {
    const baseline = havocBaselineHeightInches({ heightInches: 81, weightLbs: 220 }, 'C');
    expect(baseline).toEqual({ baselineHeightInches: 81, baselineHeightSource: 'source' });
  });

  it('falls back to the documented slot estimates when the height is missing', () => {
    const estimates = {
      PG: 74,
      SG: 77,
      SF: 80,
      PF: 82,
      C: 84,
    } as const;
    for (const [slot, estimate] of Object.entries(estimates)) {
      const baseline = havocBaselineHeightInches(
        { heightInches: null, weightLbs: null },
        slot as keyof typeof estimates,
      );
      expect(baseline.baselineHeightInches).toBe(estimate);
      expect(baseline.baselineHeightSource).toBe('estimated');
    }
  });

  it('computes reach units with the documented formula and clamp', () => {
    expect(havocReachUnits(0, 0)).toBe(0);
    expect(havocReachUnits(12, 0)).toBeCloseTo(1, 10);
    expect(havocReachUnits(0, 24)).toBeCloseTo(1, 10);
    expect(havocReachUnits(24, 0)).toBe(2);
    expect(havocReachUnits(0, 48)).toBe(2);
    expect(havocReachUnits(-24, 0)).toBe(-2);
    expect(havocReachUnits(6, 9)).toBeCloseTo((6 + 4.5) / 12, 10);
  });

  it('clamps effective heights to 50..108', () => {
    expect(HAVOC_EFFECTIVE_HEIGHT_MIN).toBe(50);
    expect(HAVOC_EFFECTIVE_HEIGHT_MAX).toBe(108);
    expect(clampHavocEffectiveHeight(40)).toBe(50);
    expect(clampHavocEffectiveHeight(120)).toBe(108);
    expect(clampHavocEffectiveHeight(84)).toBe(84);
  });

  it('clamps wingspan deltas to 0..36', () => {
    expect(clampHavocWingspanDelta(-4)).toBe(0);
    expect(clampHavocWingspanDelta(18)).toBe(18);
    expect(clampHavocWingspanDelta(60)).toBe(36);
  });
});
