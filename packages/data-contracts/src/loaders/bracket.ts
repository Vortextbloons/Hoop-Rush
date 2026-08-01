import type { OpponentBracket } from '../bracket.js';
import { opponentBracketSchema } from '../bracket.js';
import { verifySha256 } from './verify-hash.js';

/** Validates an opponent-bracket artifact at a runtime boundary. */
export function parseOpponentBracket(value: unknown): OpponentBracket {
  return opponentBracketSchema.parse(value);
}

/** Fetches and hash-verifies the OpponentBracket artifact. */
export async function loadOpponentBracket(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<OpponentBracket> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`failed to load opponent bracket from ${url}: HTTP ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  if (expectedHash !== undefined) {
    await verifySha256(bytes, expectedHash);
  }
  return parseOpponentBracket(JSON.parse(new TextDecoder().decode(bytes)));
}
