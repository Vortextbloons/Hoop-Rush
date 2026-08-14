import type { Seed } from '@hoop-rush/data-contracts';
import { FNV_OFFSET_32, fnv1a32, hex32 } from '../sim/rng.ts';

export { seedFromString } from '@hoop-rush/data-contracts';

export const SEED_DERIVATION_VERSION = 'seed-v1';

export function deriveGameSeed(runSeed: Seed, gameNumber: number): Seed {
  if (!Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > 82) {
    throw new Error(`gameNumber must be an integer in 1..82 (got ${String(gameNumber)})`);
  }
  const material = `hoop-rush:${SEED_DERIVATION_VERSION}:${runSeed}:game-${String(gameNumber)}`;
  const high = fnv1a32(material);
  const low = fnv1a32(`${material}:tail`, FNV_OFFSET_32 ^ high);
  return `${hex32(high)}${hex32(low)}`;
}

export function deriveAttemptSeed(runSeed: Seed, attemptIndex: number): Seed {
  if (!Number.isInteger(attemptIndex) || attemptIndex < 0) {
    throw new Error(`attemptIndex must be a nonnegative integer (got ${String(attemptIndex)})`);
  }
  const material = `hoop-rush:${SEED_DERIVATION_VERSION}:${runSeed}:attempt-${String(attemptIndex)}`;
  const high = fnv1a32(material);
  const low = fnv1a32(`${material}:tail`, FNV_OFFSET_32 ^ high);
  return `${hex32(high)}${hex32(low)}`;
}
