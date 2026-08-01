import type { Seed } from '@hoop-rush/data-contracts';

/**
 * Per-game seed derivation (spec/01 challenge seeds). Every game of a run
 * gets an independent deterministic seed derived from the run seed and game
 * number through a versioned stable hash. The version string participates in
 * the hash so a derivation-rule change makes every derived seed differ.
 *
 * The 64-bit output is built from two FNV-1a hashes over the versioned
 * material so no BigInt or platform API is needed and the engine stays pure.
 */

export const SEED_DERIVATION_VERSION = 'seed-v1';

const FNV_OFFSET_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

function fnv1a32(material: string, offset: number): number {
  let hash = offset | 0;
  for (let i = 0; i < material.length; i += 1) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME_32);
  }
  return hash >>> 0;
}

function hex32(value: number): string {
  return value.toString(16).padStart(8, '0');
}

/** Derives the seed of game `gameNumber` (1-based, 1..82) from the run seed. */
export function deriveGameSeed(runSeed: Seed, gameNumber: number): Seed {
  if (!Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > 82) {
    throw new Error(`gameNumber must be an integer in 1..82 (got ${String(gameNumber)})`);
  }
  const material = `hoop-rush:${SEED_DERIVATION_VERSION}:${runSeed}:game-${String(gameNumber)}`;
  const high = fnv1a32(material, FNV_OFFSET_32);
  const low = fnv1a32(`${material}:tail`, FNV_OFFSET_32 ^ high);
  return `${hex32(high)}${hex32(low)}` as Seed;
}
