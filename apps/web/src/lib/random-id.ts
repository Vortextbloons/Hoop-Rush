import { bytesToHex, randomBytes } from './random-hex';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function randomUUID(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto.getRandomValues === 'function') {
    return randomUUIDFromBytes();
  }
  return fallbackUUID();
}

function randomUUIDFromBytes(): string {
  const bytes = randomBytes(16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fallbackUUID(): string {
  const time = Date.now().toString(16).padStart(12, '0');
  const rand = Math.floor(Math.random() * 0xffff_ffff)
    .toString(16)
    .padStart(8, '0');
  const uuid = `${time.slice(0, 8)}-${time.slice(8, 12)}-4${rand.slice(0, 3)}-8${rand.slice(3, 6)}-${rand}${'0'.repeat(4)}`;
  if (!UUID_RE.test(uuid)) {
    throw new Error('failed to generate a UUID');
  }
  return uuid;
}
