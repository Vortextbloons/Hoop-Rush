import { playersIndexSchema, type PlayersIndex } from '../player-season.js';
import { verifySha256 } from './verify-hash.js';

/** Validate a global players index at a runtime boundary. */
export function parsePlayersIndex(value: unknown): PlayersIndex {
  return playersIndexSchema.parse(value);
}

/**
 * Fetch, hash-verify, and validate the global players index asset. When
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
    throw new Error(`players index request failed: ${response.status} ${response.statusText}`);
  }
  const bytes = await response.arrayBuffer();
  if (expectedHash !== undefined) {
    await verifySha256(bytes, expectedHash);
  }
  return parsePlayersIndex(JSON.parse(new TextDecoder().decode(bytes)));
}
