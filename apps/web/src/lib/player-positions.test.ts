import { describe, expect, it } from 'vitest';
import { formatPositions } from './player-positions';

/**
 * Shared player-position presentation unit tests: canonical slash-joined
 * output in detailed order, plus the stable-array memoization.
 */

describe('formatPositions', () => {
  it('renders detailed positions in canonical order, deduplicated', () => {
    expect(formatPositions(['SG', 'PG'])).toBe('PG/SG');
    expect(formatPositions(['SF', 'PF'])).toBe('SF/PF');
    expect(formatPositions(['C'])).toBe('C');
  });

  it('passes unknown values through after the known positions', () => {
    expect(formatPositions(['X', 'PG', 'Y'])).toBe('PG/X/Y');
    expect(formatPositions([])).toBe('');
  });

  it('never collapses coarse groups', () => {
    expect(formatPositions(['F', 'G'])).toBe('F/G');
  });

  it('memoizes by the positions array identity with identical output', () => {
    const positions = ['PG', 'SG'] as const;
    const first = formatPositions(positions);
    const second = formatPositions(positions);
    expect(second).toBe(first);
    expect(second).toBe('PG/SG');
    // A different array with the same contents computes separately.
    const other = formatPositions(['PG', 'SG']);
    expect(other).toBe('PG/SG');
  });
});
