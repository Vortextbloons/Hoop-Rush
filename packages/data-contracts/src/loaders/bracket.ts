import { opponentBracketSchema, type OpponentBracket } from '../bracket.ts';
import { loadAsset } from './index.ts';
export function parseOpponentBracket(value: unknown): OpponentBracket {
  return opponentBracketSchema.parse(value);
}
export function loadOpponentBracket(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<OpponentBracket> {
  return loadAsset(url, opponentBracketSchema, 'opponent bracket', expectedHash, init);
}
