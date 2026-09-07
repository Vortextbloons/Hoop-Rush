import { describe, expect, it } from 'vitest';
import { loadStandingsMap, resolveTeamWinPct } from './compute.ts';

describe('team win% resolution (standings-aware)', () => {
  it('prefers per-player win% over standings over the BPM estimate', () => {
    expect(resolveTeamWinPct(0.7, 0.5, 0.4)).toBe(0.7);
    expect(resolveTeamWinPct(null, 0.5, 0.4)).toBe(0.5);
    expect(resolveTeamWinPct(null, null, 0.4)).toBe(0.4);
    expect(resolveTeamWinPct(null, null, null)).toBeNull();
  });
  it('loads standings maps defensively', () => {
    expect(loadStandingsMap('C:\\nonexistent-dir-xyz')).toEqual(new Map());
  });
});
