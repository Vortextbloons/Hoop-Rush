import { describe, expect, it } from 'vitest';
import { formatDecimal, formatPct, shotPct } from './roster-browser';

describe('roster historical stat display', () => {
  it('preserves missing advanced stats instead of reporting zero', () => {
    expect(formatDecimal(null)).toBe('—');
    expect(formatPct(null)).toBe('—');
    expect(formatDecimal(0)).toBe('0.0');
    expect(formatPct(0)).toBe('0%');
  });

  it('distinguishes unavailable shooting from observed zero makes', () => {
    expect(formatPct(shotPct(null, null))).toBe('—');
    expect(formatPct(shotPct(0, 0))).toBe('—');
    expect(formatPct(shotPct(0, 10))).toBe('0%');
  });
});
