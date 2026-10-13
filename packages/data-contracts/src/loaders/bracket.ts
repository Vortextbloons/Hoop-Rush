import { opponentBracketSchema, type OpponentBracket } from '../bracket.ts';
export function parseOpponentBracket(value: unknown): OpponentBracket {
  return opponentBracketSchema.parse(value);
}
