import { describe, expect, it } from 'vitest';
import { collectionErrorMessage } from './collection-errors';

describe('collectionErrorMessage', () => {
  it('explains a stale collection instead of leaking a raw code', () => {
    const stale = new Error('stale collection state for cmd-1');
    (stale as { code?: string }).code = 'stale-state';
    expect(collectionErrorMessage(stale, 'fallback')).toContain('changed in another tab');
  });

  it('explains an invalid progression artifact', () => {
    const invalid = new Error('progression rules rejected');
    (invalid as { code?: string }).code = 'invalid-progression-rules';
    expect(collectionErrorMessage(invalid, 'fallback')).toContain('progression rules');
  });

  it('maps known rejection codes to actionable text', () => {
    const insufficient = new Error('collection command rejected: insufficient-funds');
    (insufficient as { code?: string }).code = 'insufficient-funds';
    expect(collectionErrorMessage(insufficient, 'fallback')).toBe(
      'The balance is too low for this purchase.',
    );
    const unchanged = new Error('collection command rejected: target-unchanged');
    (unchanged as { code?: string }).code = 'target-unchanged';
    expect(collectionErrorMessage(unchanged, 'fallback')).toBe(
      'That player is already the active target.',
    );
  });

  it('passes through ordinary errors and falls back for unknown failures', () => {
    expect(collectionErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
    expect(collectionErrorMessage(new Error(''), 'fallback')).toBe('fallback');
    expect(collectionErrorMessage('not an error', 'fallback')).toBe('fallback');
    expect(collectionErrorMessage(null, 'fallback')).toBe('fallback');
  });
});
