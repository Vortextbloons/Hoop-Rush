import { playersIndexSchema, type PlayersIndex } from '../player-season.ts';
import { loadJsonAsset } from './load-json.ts';

/** Validate an unknown draft-index value at a runtime boundary. */
export function parsePlayersIndex(value: unknown): PlayersIndex {
  return playersIndexSchema.parse(value);
}

/**
 * Fetch, hash-verify, and validate the draft index asset (compact identity
 * and summary-rating rows for the free-form draft and roster browser). When
 * `expectedHash` is provided (manifest content hash), the response bytes must
 * match before the index is parsed (verification is skipped when WebCrypto is
 * unavailable).
 */
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
