import { describe, expect, it } from 'vitest';
import { createRng } from './rng.ts';
describe('seeded rng', () => {
  it('is deterministic for the same seed', () => {
    const a = createRng('abcd1234abcd1234abcd1234abcd1234');
    const b = createRng('abcd1234abcd1234abcd1234abcd1234');
    const drawsA = Array.from({ length: 100 }, () => a.next());
    const drawsB = Array.from({ length: 100 }, () => b.next());
    expect(drawsA).toEqual(drawsB);
  });
  it('produces different streams for different seeds', () => {
    const a = createRng('aaaa0000aaaa0000aaaa0000aaaa0000');
    const b = createRng('bbbb1111bbbb1111bbbb1111bbbb1111');
    expect(a.next()).not.toBe(b.next());
  });
  it('seeking a position replays the same stream', () => {
    const fresh = createRng('cafe0000cafe0000cafe0000cafe0000');
    fresh.next();
    fresh.next();
    fresh.next();
    const skipped = createRng('cafe0000cafe0000cafe0000cafe0000', 3);
    expect(fresh.next()).toBe(skipped.next());
  });
  it('nextInt is inclusive on both ends', () => {
    const rng = createRng('12345678123456781234567812345678');
    expect(rng.nextInt(5, 5)).toBe(5);
    expect(() => rng.nextInt(5, 3)).toThrow();
  });
  it('weightedPick favors high weights and rejects mismatched lists', () => {
    const rng = createRng('09870987098709870987098709870987');
    const counts: Record<string, number> = { a: 0, b: 0 };
    for (let i = 0; i < 1000; i += 1) {
      const pick = rng.weightedPick(['a', 'b'], [9, 1]);
      counts[pick] = (counts[pick] ?? 0) + 1;
    }
    expect(counts.a).toBeGreaterThan((counts.b ?? 0) * 4);
    expect(() => rng.weightedPick(['a'], [1, 2])).toThrow();
  });
});
