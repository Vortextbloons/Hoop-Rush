export async function sha256Hex(
  bytes: Uint8Array<ArrayBuffer> | ArrayBuffer,
): Promise<string | null> {
  const subtle: { digest?: unknown } | undefined = (globalThis.crypto as Crypto | undefined)
    ?.subtle;
  if (typeof subtle?.digest !== 'function') {
    return null;
  }
  const digest = await (subtle.digest as typeof globalThis.crypto.subtle.digest)('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifySha256(bytes: ArrayBuffer, expectedHash: string): Promise<void> {
  const digest = await sha256Hex(new Uint8Array(bytes));
  if (digest !== null && digest !== expectedHash) {
    throw new Error(`content hash mismatch: expected ${expectedHash}, got ${digest}`);
  }
}
