import { playersIndexSchema, type PlayersIndex } from '../player-season.ts';
export function parsePlayersIndex(value: unknown): PlayersIndex {
  return playersIndexSchema.parse(value);
}
