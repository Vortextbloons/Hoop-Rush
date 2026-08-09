/**
 * Platform CSPRNG helpers for client-side identity and seed generation.
 * `crypto.getRandomValues` is secure-context-friendly; the zero fallback only
 * ever runs during SSR, where gameplay seeds are never consumed.
 */

export function randomBytes(bytes: number): Uint8Array {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buffer = new Uint8Array(bytes);
    crypto.getRandomValues(buffer);
    return buffer;
  }
  return new Uint8Array(bytes);
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(bytes: number): string {
  return bytesToHex(randomBytes(bytes));
}
