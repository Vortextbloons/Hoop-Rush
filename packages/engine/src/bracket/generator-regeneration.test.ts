import { describe, expect, it } from 'vitest';
import { seedFromString } from '@hoop-rush/test-fixtures';
import { generateBracket } from './generator.js';
import { fixtureBracket, generationOptions } from './generator-testing.js';

/**
 * Deterministic regeneration tests (spec/01): the same seed and inputs must
 * reproduce the shared fixture bracket byte-for-byte, and a different seed
 * must diverge. Each test performs a fresh multi-second generation, so they
 * live in their own file and run on a separate worker from the shared-bracket
 * property tests in generator.test.ts.
 */

describe('generateBracket (deterministic regeneration)', () => {
  it('regenerates byte-identically with the same seed and inputs', () => {
    const a = fixtureBracket();
    const b = generateBracket(generationOptions());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  }, 60_000);

  it('regenerates differently with a different seed', () => {
    const a = fixtureBracket();
    const b = generateBracket(generationOptions({ seed: seedFromString('fixture-bracket-2') }));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  }, 60_000);
});
