/**
 * Deterministic seeded RNG (port inventory: Dynasty Desk `src/game/core/seededRandom.ts`
 * and `src/game/sim/rng.ts`, ported after cleanup). The mulberry32 stream is
 * retained; the seed hash switches from the legacy Java-style string hash to
 * FNV-1a so seeds produced by `seedFromString` behave consistently. State is
 * serializable as { seed, position } and seeking replays draws from scratch.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** True with probability p (p<=0 never, p>=1 always). */
  chance(probability: number): boolean;
  /** Uniform integer in [min, max], inclusive; throws when max < min. */
  nextInt(min: number, max: number): number;
  /** Uniform element; throws on an empty list. */
  pick<T>(items: readonly T[]): T;
  /** Element selected by relative weights (nonpositive weights contribute 0). */
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T;
}

export interface RngState {
  seed: string;
  position: number;
}

function hashStringFnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Creates an RNG whose next draw is the `position`-th draw of the seed. */
export function createRng(seed: string, position = 0): Rng {
  const next = mulberry32(hashStringFnv1a(seed));
  for (let i = 0; i < position; i += 1) next();

  function draw(): number {
    return next();
  }

  return {
    next: draw,
    chance(probability) {
      if (probability <= 0) return false;
      if (probability >= 1) return true;
      return draw() < probability;
    },
    nextInt(min, max) {
      if (max < min) throw new Error(`nextInt: max (${String(max)}) < min (${String(min)})`);
      if (max === min) return min;
      return Math.floor(draw() * (max - min + 1)) + min;
    },
    pick(items) {
      if (items.length === 0) throw new Error('pick: cannot pick from an empty list');
      const item = items[this.nextInt(0, items.length - 1)];
      if (item === undefined) {
        throw new Error('pick: index out of range');
      }
      return item;
    },
    weightedPick(items, weights) {
      if (items.length === 0) throw new Error('weightedPick: cannot pick from an empty list');
      if (items.length !== weights.length) {
        throw new Error(
          `weightedPick: items (${String(items.length)}) and weights (${String(weights.length)}) length mismatch`,
        );
      }
      let total = 0;
      for (const w of weights) total += Math.max(0, w);
      if (total <= 0) return this.pick(items);
      let roll = draw() * total;
      for (let i = 0; i < items.length; i += 1) {
        const w = Math.max(0, weights[i] ?? 0);
        if (roll < w) {
          const item = items[i];
          if (item === undefined) {
            throw new Error(`weightedPick: no item at index ${String(i)}`);
          }
          return item;
        }
        roll -= w;
      }
      const last = items[items.length - 1];
      if (last === undefined) {
        throw new Error('weightedPick: index out of range');
      }
      return last;
    },
  };
}
