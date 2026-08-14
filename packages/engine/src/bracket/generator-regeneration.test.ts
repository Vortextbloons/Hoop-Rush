import { describe, expect, it } from 'vitest';
import { seedFromString } from '@hoop-rush/test-fixtures';
import { generateBracket } from './generator.ts';
import { fixtureBracket, generationOptions } from './generator-testing.ts';

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
