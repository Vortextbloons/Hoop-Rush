/** Shared SHA-256 content-hash verification for packaged artifacts. */

/**
 * SHA-256 hex digest of the bytes, or null when WebCrypto is unavailable
 * (insecure contexts such as plain HTTP on a non-localhost host). Callers
 * treat null as "verification not possible" and skip the check rather than
 * fail the load.
 */
export async function sha256Hex(
  bytes: Uint8Array<ArrayBuffer> | ArrayBuffer,
): Promise<string | null> {
  // The DOM lib types crypto/subtle as always present, but insecure contexts
  // can lack subtle at runtime; the optional chains are deliberate.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    return null;
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifySha256(bytes: ArrayBuffer, expectedHash: string): Promise<void> {
  const digest = await sha256Hex(new Uint8Array(bytes));
  if (digest !== null && digest !== expectedHash) {
    throw new Error(`content hash mismatch: expected ${expectedHash}, got ${digest}`);
  }
}
