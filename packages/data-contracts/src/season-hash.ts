/**
 * Internal FNV-1a hash helper shared by Season Run identity and seed
 * derivation. It intentionally mirrors the constants and algorithm of the
 * engine's `sim/rng.ts` so Season Run derivation vectors behave like the
 * rest of the seeded simulation, but it lives at the contract boundary where
 * the engine cannot be imported (dependency direction: engine -> contracts).
 *
 * Not exported from the package index; use `playerVersionId` and
 * `seasonNamespaceSeed` instead.
 */

const FNV_OFFSET_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

/** FNV-1a 32-bit hash of a string from a custom offset basis. */
function fnv1a32(material: string, offset: number): number {
  let hash = offset | 0;
  for (let i = 0; i < material.length; i += 1) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME_32);
  }
  return hash >>> 0;
}

/** 8-hex-digit form of a 32-bit value. */
function hex32(value: number): string {
  return value.toString(16).padStart(8, '0');
}

const HASH_OFFSETS = [FNV_OFFSET_32, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];

/**
 * 32-hex-digit (128-bit) deterministic digest of the material: four FNV-1a
 * passes over distinct offset bases, concatenated in fixed order. Pure
 * function of the input; call order never matters.
 */
export function seasonDigestHex(material: string): string {
  let out = '';
  for (const offset of HASH_OFFSETS) {
    out += hex32(fnv1a32(material, offset));
  }
  return out;
}
