import { playersIndexSchema, type PlayersIndex } from '../player-season.js';
import { sha256Hex } from './verify-hash.js';

/** Validate an unknown draft-index value at a runtime boundary. */
export function parsePlayersIndex(value: unknown): PlayersIndex {
  return playersIndexSchema.parse(value);
}

/**
 * Fetch, hash-verify, and validate the draft index asset (compact identity
 * and summary-rating rows for the free-form draft and roster browser). When
 * `expectedHash` is provided (manifest content hash), the response bytes must
 * match before the index is parsed.
 */
export async function loadPlayersIndex(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<PlayersIndex> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(
      `players index request failed: ${String(response.status)} ${response.statusText}`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (expectedHash !== undefined) {
    const digest = await sha256Hex(bytes);
    if (digest !== expectedHash) {
      throw new Error(
        `players index content hash mismatch: expected ${expectedHash}, got ${digest}`,
      );
    }
  }
  const text = new TextDecoder().decode(bytes);
  return parsePlayersIndex(JSON.parse(text) as unknown);
}
