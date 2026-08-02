/**
 * Deterministic seeded RNG for build-time derivation.
 *
 * The Python importer seeds `random.Random` from `int(sha256(season)[:12], 16) + 42`
 * and draws gauss jitter per player. We keep the same seed derivation so seeds are
 * stable across rebuilds, but use a mulberry32 stream (the same generator family as
 * `@hoop-rush/engine`'s `sim/rng.ts`) plus a Box-Muller transform for gauss draws.
 * Output values are intentionally not bit-identical to Python: determinism is
 * required within this implementation, not across languages.
 */
import { createHash } from 'node:crypto';

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Standard-normal draw scaled to (mean, sigma). */
  gauss(mean?: number, sigma?: number): number;
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

/**
 * Season seed matching the Python pipeline: sha256(season) hex, first 12 hex
 * digits parsed as an integer, plus the constant 42.
 */
export function pythonSeasonSeed(season: string): number {
  const digest = createHash('sha256').update(season, 'utf8').digest('hex');
  return (parseInt(digest.slice(0, 12), 16) + 42) >>> 0;
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  let spare: number | null = null;

  function drawGauss(): number {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = next() * 2 - 1;
      v = next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const factor = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * factor;
    return u * factor;
  }

  return {
    next,
    gauss(mean = 0, sigma = 1) {
      return mean + drawGauss() * sigma;
    },
  };
}
