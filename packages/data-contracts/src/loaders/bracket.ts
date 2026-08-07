import { opponentBracketSchema } from '../bracket.ts';
import { loadJsonAsset } from './load-json.ts';

/** Fetches and hash-verifies the OpponentBracket artifact. */
export function loadOpponentBracket(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<import('../bracket.ts').OpponentBracket> {
  return loadJsonAsset(url, {
    label: 'opponent bracket',
    expectedHash,
    parse: (value: unknown) => opponentBracketSchema.parse(value),
    init,
  });
}
