import { franchiseEraPoolSchema, type FranchiseEraPool } from '../player-season.ts';
import { loadJsonAsset } from './load-json.ts';

/** Validate an unknown pool value at a runtime boundary. */
export function parsePool(value: unknown): FranchiseEraPool {
  return franchiseEraPoolSchema.parse(value);
}

/**
 * Fetch, hash-verify, and validate a franchise-era pool asset. When
 * `expectedHash` is provided (manifest content hash), the response bytes must
 * match before the pool is parsed.
 */
export function loadPool(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<FranchiseEraPool> {
  return loadJsonAsset(url, { label: 'pool', expectedHash, parse: parsePool, init });
}
