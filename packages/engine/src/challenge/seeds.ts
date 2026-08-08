import type { Seed } from '@hoop-rush/data-contracts';
import { FNV_OFFSET_32, fnv1a32, hex32 } from '../sim/rng.ts';

/**
 * Per-game seed derivation (spec/01 challenge seeds). Every game of a run
 * gets an independent deterministic seed derived from the run seed and game
 * number through a versioned stable hash. The version string participates in
 * the hash so a derivation-rule change makes every derived seed differ.
 *
 * The 64-bit output is built from two FNV-1a hashes over the versioned
 * material so no BigInt or platform API is needed and the engine stays pure.
 */

/** Canonical deterministic 32-hex seed from any string (FNV-1a form). */
export { seedFromString } from '@hoop-rush/data-contracts';

export const SEED_DERIVATION_VERSION = 'seed-v1';

/** Derives the seed of game `gameNumber` (1-based, 1..82) from the run seed. */
export function deriveGameSeed(runSeed: Seed, gameNumber: number): Seed {
  if (!Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > 82) {
    throw new Error(`gameNumber must be an integer in 1..82 (got ${String(gameNumber)})`);
  }
  const material = `hoop-rush:${SEED_DERIVATION_VERSION}:${runSeed}:game-${String(gameNumber)}`;
  const high = fnv1a32(material);
  const low = fnv1a32(`${material}:tail`, FNV_OFFSET_32 ^ high);
  return `${hex32(high)}${hex32(low)}`;
}

/**
 * Derives the seed of a whole-run attempt `attemptIndex` (0-based) for
 * sandbox best-of-N selection. Attempt seeds share the versioned derivation
 * contract so a rule change deterministically invalidates every attempt.
 */
export function deriveAttemptSeed(runSeed: Seed, attemptIndex: number): Seed {
  if (!Number.isInteger(attemptIndex) || attemptIndex < 0) {
    throw new Error(`attemptIndex must be a nonnegative integer (got ${String(attemptIndex)})`);
  }
  const material = `hoop-rush:${SEED_DERIVATION_VERSION}:${runSeed}:attempt-${String(attemptIndex)}`;
  const high = fnv1a32(material);
  const low = fnv1a32(`${material}:tail`, FNV_OFFSET_32 ^ high);
  return `${hex32(high)}${hex32(low)}`;
}
