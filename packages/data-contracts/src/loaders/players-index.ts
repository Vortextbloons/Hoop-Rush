import { playersIndexSchema, type PlayersIndex } from '../player-season.ts';
import { loadJsonAsset } from './load-json.ts';
export function parsePlayersIndex(value: unknown): PlayersIndex {
  return playersIndexSchema.parse(value);
}
export function loadPlayersIndex(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<PlayersIndex> {
  return loadJsonAsset(url, {
    label: 'players index',
    expectedHash,
    parse: parsePlayersIndex,
    init,
  });
}
