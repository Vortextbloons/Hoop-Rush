import { commandIdSchema, seedSchema, type CommandId, type Seed } from '@hoop-rush/data-contracts';
export function randomBytes(bytes: number): Uint8Array {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buffer = new Uint8Array(bytes);
    crypto.getRandomValues(buffer);
    return buffer;
  }
  throw new Error('Secure random number generation is unavailable.');
}
export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function randomHex(bytes: number): string {
  return bytesToHex(randomBytes(bytes));
}
export function randomUUID(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto.getRandomValues === 'function') {
    return randomUUIDFromBytes();
  }
  throw new Error('secure randomness unavailable: crypto.getRandomValues is required');
}
function randomUUIDFromBytes(): string {
  const bytes = randomBytes(16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function newSeasonId(prefix: string): CommandId {
  const random = randomHex(16);
  return commandIdSchema.parse(`${prefix}-${random}`);
}
export function seasonRootSeed(): Seed {
  return seedSchema.parse(randomHex(32));
}
