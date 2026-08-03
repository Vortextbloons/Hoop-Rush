import { hoopRushManifestSchema, type HoopRushManifest } from '../manifest.js';

/** Validate an unknown manifest value at a runtime boundary. */
export function parseManifest(value: unknown): HoopRushManifest {
  return hoopRushManifestSchema.parse(value);
}

/** Fetch and validate the Hoop Rush manifest from a base URL. */
export async function loadManifest(url: string, init?: RequestInit): Promise<HoopRushManifest> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`manifest request failed: ${String(response.status)} ${response.statusText}`);
  }
  return parseManifest(await response.json());
}
