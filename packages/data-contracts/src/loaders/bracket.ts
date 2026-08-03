import { opponentBracketSchema } from '../bracket.js';
import { verifySha256 } from './verify-hash.js';

/** Fetches and hash-verifies the OpponentBracket artifact. */
export async function loadOpponentBracket(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<import('../bracket.js').OpponentBracket> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`failed to load opponent bracket from ${url}: HTTP ${String(response.status)}`);
  }
  const bytes = await response.arrayBuffer();
  if (expectedHash !== undefined) {
    await verifySha256(bytes, expectedHash);
  }
  return opponentBracketSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}
