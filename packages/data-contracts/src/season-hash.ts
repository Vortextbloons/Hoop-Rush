/**
 * Canonical FNV-1a 32-bit hash helpers (FNV-1a 32-bit offset basis
 * 0x811c9dc5, prime 0x01000193). This module is the single source of the
 * hash primitive and its 8-hex-digit form: the engine's `sim/rng.ts`
 * re-exports them, the importer's reconstruction fold assignment uses them,
 * and the fixture packages derive seeds from them, so every derivation
 * vector behaves identically across the repo.
 *
 * `seasonDigestHex` (128-bit, four offset bases) is the Season Run identity
 * and seed derivation digest; `fnv1a32` alone is the classic game/RNG hash.
 */

/** FNV-1a 32-bit offset basis. */
export const FNV_OFFSET_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

/** FNV-1a 32-bit hash of a string from an optional offset basis. */
export function fnv1a32(material: string, offset = FNV_OFFSET_32): number {
  let hash = offset | 0;
  for (let i = 0; i < material.length; i += 1) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME_32);
  }
  return hash >>> 0;
}

/** 8-hex-digit form of a 32-bit value. */
export function hex32(value: number): string {
  return value.toString(16).padStart(8, '0');
}

/** Deterministic 32-hex seed from any string (canonical FNV-1a form). */
export function seedFromString(value: string): string {
  return fnv1a32(value).toString(16).padStart(8, '0').repeat(4);
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

/**
 * Order-independent JSON serialization (algorithm-identical to the engine's
 * `canonicalJson` in `season/checkpoint.ts`): object keys are sorted
 * recursively, array order is preserved, undefined values are skipped. Used
 * by data-contracts digest contracts (e.g. the command log) so a digest is a
 * pure function of the recorded facts, never of key insertion order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const entry = record[key];
      if (entry === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canonicalJson(entry)}`);
    }
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value);
}
