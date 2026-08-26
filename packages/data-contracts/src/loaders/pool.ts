import { franchiseEraPoolSchema, type FranchiseEraPool } from '../player-season.ts';
import { loadJsonAsset } from './load-json.ts';
export function parsePool(value: unknown): FranchiseEraPool {
    return franchiseEraPoolSchema.parse(value);
}
export function loadPool(url: string, expectedHash?: string, init?: RequestInit): Promise<FranchiseEraPool> {
    return loadJsonAsset(url, { label: 'pool', expectedHash, parse: parsePool, init });
}
