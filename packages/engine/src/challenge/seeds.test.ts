import { describe, expect, it } from 'vitest';
import { seedSchema } from '@hoop-rush/data-contracts';
import { deriveGameSeed } from './seeds.ts';
describe('deriveGameSeed (spec/01 per-game seeds)', () => {
  it('emits schema-valid hex seeds', () => {
    for (let game = 1; game <= 82; game += 1) {
      expect(
        seedSchema.safeParse(deriveGameSeed('cafe1234cafe1234cafe1234cafe1234', game)).success,
      ).toBe(true);
    }
  });
  it('is unique across a range of run seeds and every game (property)', () => {
    for (const runSeed of [
      '00000000000000000000000000000000',
      'ffffffffffffffffffffffffffffffff',
      '1234567890abcdef1234567890abcdef',
      'deadbeefdeadbeefdeadbeefdeadbeef',
    ]) {
      const seen = new Set<string>();
      for (let game = 1; game <= 82; game += 1) {
        const derived = deriveGameSeed(runSeed, game);
        expect(seen.has(derived)).toBe(false);
        seen.add(derived);
      }
    }
  });
  it('rejects game numbers outside 1..82', () => {
    expect(() => deriveGameSeed('abcd1234abcd1234abcd1234abcd1234', 0)).toThrow();
    expect(() => deriveGameSeed('abcd1234abcd1234abcd1234abcd1234', 83)).toThrow();
    expect(() => deriveGameSeed('abcd1234abcd1234abcd1234abcd1234', 1.5)).toThrow();
  });
});
