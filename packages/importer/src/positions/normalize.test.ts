import { describe, expect, it } from 'vitest';
import {
  normalizePositionLabels,
  positionGroupForSource,
  primaryPositionForSource,
} from './normalize.ts';

describe('source position normalization', () => {
  it.each([
    ['G', 'PG', 'G'],
    ['F', 'SF', 'F'],
    ['F-G', 'PG', 'G'],
    ['G-F', 'PG', 'G'],
    ['F-C', 'SF', 'F'],
    ['C-F', 'SF', 'F'],
  ])('normalizes %s without collapsing it to an unrelated role', (label, primary, group) => {
    expect(primaryPositionForSource(label)).toBe(primary);
    expect(positionGroupForSource(label)).toBe(group);
  });

  it('retains every playable role represented by a compound source label', () => {
    expect(normalizePositionLabels(['F-G'])).toEqual({
      detailed: ['PF', 'PG', 'SF', 'SG'],
      sourceLabels: ['F-G'],
      unknownLabels: [],
    });
  });

  it('falls back only for an unknown source label', () => {
    expect(primaryPositionForSource('unknown')).toBe('SF');
    expect(normalizePositionLabels(['unknown']).unknownLabels).toEqual(['unknown']);
  });
});
