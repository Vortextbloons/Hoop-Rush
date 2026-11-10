import { z } from 'zod';
const hex32Digest = z.string().regex(/^[0-9a-f]{32}$/);
export const seasonCheckpointDigestSchema = hex32Digest;
export const FNV_OFFSET_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
export function fnv1a32(material: string, offset = FNV_OFFSET_32): number {
  let hash = offset | 0;
  for (let i = 0; i < material.length; i += 1) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME_32);
  }
  return hash >>> 0;
}
export function hex32(value: number): string {
  return value.toString(16).padStart(8, '0');
}
export function seedFromString(value: string): string {
  return fnv1a32(value).toString(16).padStart(8, '0').repeat(4);
}
const HASH_OFFSETS = [FNV_OFFSET_32, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35] as const;
export type SeasonDigestState = readonly [number, number, number, number];
export function seasonDigestState(
  material: string,
  offsets: SeasonDigestState = HASH_OFFSETS,
): SeasonDigestState {
  let h0 = offsets[0] | 0;
  let h1 = offsets[1] | 0;
  let h2 = offsets[2] | 0;
  let h3 = offsets[3] | 0;
  for (let i = 0; i < material.length; i += 1) {
    const code = material.charCodeAt(i);
    h0 ^= code;
    h0 = Math.imul(h0, FNV_PRIME_32);
    h1 ^= code;
    h1 = Math.imul(h1, FNV_PRIME_32);
    h2 ^= code;
    h2 = Math.imul(h2, FNV_PRIME_32);
    h3 ^= code;
    h3 = Math.imul(h3, FNV_PRIME_32);
  }
  return [h0, h1, h2, h3];
}
export function seasonDigestHex(material: string, offsets?: SeasonDigestState): string {
  const [h0, h1, h2, h3] = seasonDigestState(material, offsets);
  return hex32(h0 >>> 0) + hex32(h1 >>> 0) + hex32(h2 >>> 0) + hex32(h3 >>> 0);
}
const immutableJson = new WeakMap<object, string>();

function freezeCanonicalJson<T extends object>(value: T): T {
  function freeze(entry: unknown): void {
    if (entry === null || typeof entry !== 'object') return;
    if (immutableJson.has(entry)) return;
    for (const child of Object.values(entry)) freeze(child);
    Object.freeze(entry);
    immutableJson.set(entry, canonicalJson(entry));
  }
  freeze(value);
  return value;
}

export function immutableCanonicalSchema<T extends object>(schema: z.ZodType<T>) {
  const validated = new WeakSet<object>();
  return z.union([
    z.custom<T>((value) => typeof value === 'object' && value !== null && validated.has(value)),
    schema.transform((value) => {
      freezeCanonicalJson(value);
      validated.add(value);
      return value;
    }),
  ]);
}

export function canonicalJson(value: unknown): string {
  const keys = new Map<string, string>();
  return encode(value);

  function encode(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'object') {
      const cached = immutableJson.get(value);
      if (cached !== undefined) return cached;
    }
    if (Array.isArray(value)) {
      return `[${value.map((entry) => encode(entry)).join(',')}]`;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(record).sort()) {
        const entry = record[key];
        if (entry === undefined) continue;
        let encodedKey = keys.get(key);
        if (encodedKey === undefined) {
          encodedKey = JSON.stringify(key);
          keys.set(key, encodedKey);
        }
        parts.push(`${encodedKey}:${encode(entry)}`);
      }
      return `{${parts.join(',')}}`;
    }
    return JSON.stringify(value);
  }
}
