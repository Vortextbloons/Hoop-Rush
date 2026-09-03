import { playersIndexSchema, type PlayersIndex } from '../player-season.ts';
import { loadAsset } from './index.ts';
export function parsePlayersIndex(value: unknown): PlayersIndex {
  return playersIndexSchema.parse(value);
}
export function loadPlayersIndex(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<PlayersIndex> {
  return loadAsset(url, playersIndexSchema, 'players index', expectedHash, init);
}
