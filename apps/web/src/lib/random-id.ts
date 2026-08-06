/**
 * Platform UUID generation for client-side run and draft identity.
 * `crypto.randomUUID` is secure-context only; fall back to v4 bytes from
 * `getRandomValues`, which remains available on plain HTTP.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Fresh RFC 4122 v4 UUID for run, draft, and worker request identity. */
export function randomUUID(): string {
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto?.getRandomValues === 'function') {
    return randomUUIDFromBytes();
  }
  return fallbackUUID();
}

function randomUUIDFromBytes(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Last-resort identity when no CSPRNG is exposed (e.g. SSR). */
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
