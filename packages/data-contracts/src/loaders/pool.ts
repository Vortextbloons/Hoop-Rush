import { franchiseEraPoolSchema, type FranchiseEraPool } from '../player-season.js';
import { sha256Hex } from './verify-hash.js';

/** Validate an unknown pool value at a runtime boundary. */
export function parsePool(value: unknown): FranchiseEraPool {
  return franchiseEraPoolSchema.parse(value);
}

/**
 * Fetch, hash-verify, and validate a franchise-era pool asset. When
 * `expectedHash` is provided (manifest content hash), the response bytes must
 * match before the pool is parsed.
 */
export async function loadPool(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<FranchiseEraPool> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`pool request failed: ${String(response.status)} ${response.statusText}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (expectedHash !== undefined) {
    const digest = await sha256Hex(bytes);
    if (digest !== expectedHash) {
      throw new Error(`pool content hash mismatch: expected ${expectedHash}, got ${digest}`);
    }
  }
  const text = new TextDecoder().decode(bytes);
  return parsePool(JSON.parse(text) as unknown);
}
