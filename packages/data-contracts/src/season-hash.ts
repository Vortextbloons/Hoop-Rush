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
const HASH_OFFSETS = [FNV_OFFSET_32, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
export function seasonDigestHex(material: string): string {
  let out = '';
  for (const offset of HASH_OFFSETS) {
    out += hex32(fnv1a32(material, offset));
  }
  return out;
}
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
