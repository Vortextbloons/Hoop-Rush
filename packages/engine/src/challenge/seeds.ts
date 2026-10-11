import type { Seed } from '@hoop-rush/data-contracts';
import { seedSchema } from '@hoop-rush/data-contracts';
import { FNV_OFFSET_32, fnv1a32, hex32 } from '../sim/rng.ts';
export { seedFromString } from '@hoop-rush/data-contracts';
export const SEED_DERIVATION_VERSION = 'seed-v1';
function deriveSeed(runSeed: Seed, suffix: string): Seed {
  const material = `hoop-rush:${SEED_DERIVATION_VERSION}:${runSeed}:${suffix}`;
  const high = fnv1a32(material);
  const low = fnv1a32(`${material}:tail`, FNV_OFFSET_32 ^ high);
  return seedSchema.parse(`${hex32(high)}${hex32(low)}`);
}
export function deriveGameSeed(runSeed: Seed, gameNumber: number): Seed {
  if (!Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > 82) {
    throw new Error(`gameNumber must be an integer in 1..82 (got ${String(gameNumber)})`);
  }
  return deriveSeed(runSeed, `game-${String(gameNumber)}`);
}
export function deriveAttemptSeed(runSeed: Seed, attemptIndex: number): Seed {
  if (!Number.isInteger(attemptIndex) || attemptIndex < 0) {
    throw new Error(`attemptIndex must be a nonnegative integer (got ${String(attemptIndex)})`);
  }
  return deriveSeed(runSeed, `attempt-${String(attemptIndex)}`);
}
