import { describe, expect, it } from 'vitest';
import { seedSchema } from '@hoop-rush/data-contracts';
import { SEED_DERIVATION_VERSION, deriveGameSeed } from './seeds.ts';

describe('deriveGameSeed (spec/01 per-game seeds)', () => {
  it('is deterministic for the same run seed and game number', () => {
    const runSeed = 'abcd1234abcd1234abcd1234abcd1234' as const;
    expect(deriveGameSeed(runSeed, 1)).toBe(deriveGameSeed(runSeed, 1));
    expect(deriveGameSeed(runSeed, 42)).toBe(deriveGameSeed(runSeed, 42));
  });

  it('produces different seeds for different game numbers', () => {
    const runSeed = 'abcd1234abcd1234abcd1234abcd1234' as const;
    const seeds = new Set<string>();
    for (let game = 1; game <= 82; game += 1) {
      seeds.add(deriveGameSeed(runSeed, game));
    }
    expect(seeds.size).toBe(82);
  });

  it('produces different seeds for different run seeds', () => {
    const a = deriveGameSeed('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1);
    const b = deriveGameSeed('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 1);
    expect(a).not.toBe(b);
  });

  it('emits schema-valid hex seeds', () => {
    for (let game = 1; game <= 82; game += 1) {
      expect(
        seedSchema.safeParse(deriveGameSeed('cafe1234cafe1234cafe1234cafe1234', game)).success,
      ).toBe(true);
    }
  });

  it('is unique across a range of run seeds and every game (property)', () => {
    // Uniqueness within every run is the invariant that makes interrupted
    // and uninterrupted execution agree byte-for-byte.
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

  it('the derivation version participates in the seed material', () => {
    const runSeed = 'abcd1234abcd1234abcd1234abcd1234' as const;
    // A different version constant would change every derived seed; this
    // test pins the current version so a version bump is intentional.
    expect(SEED_DERIVATION_VERSION).toBe('seed-v1');
    const derived = deriveGameSeed(runSeed, 7);
    expect(derived).toHaveLength(16);
    expect(derived).toMatch(/^[0-9a-f]{16}$/);
  });
});
