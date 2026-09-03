import { hoopRushManifestSchema, type HoopRushManifest } from '../manifest.ts';
import { loadAsset } from './index.ts';

export function parseManifest(value: unknown): HoopRushManifest {
  return hoopRushManifestSchema.parse(value);
}

export function loadManifest(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<HoopRushManifest>;
export function loadManifest(url: string, init?: RequestInit): Promise<HoopRushManifest>;
export function loadManifest(
  url: string,
  expectedHashOrInit?: string | RequestInit,
  init?: RequestInit,
): Promise<HoopRushManifest> {
  let expectedHash: string | undefined;
  let fetchInit: RequestInit | undefined;
  if (typeof expectedHashOrInit === 'string') {
    expectedHash = expectedHashOrInit;
    fetchInit = init;
  } else {
    fetchInit = expectedHashOrInit;
  }
  return loadAsset(url, hoopRushManifestSchema, 'manifest', expectedHash, fetchInit);
}
