import { hoopRushManifestSchema, type HoopRushManifest } from '../manifest.js';

/** Validate an unknown manifest value at a runtime boundary. */
export function parseManifest(value: unknown): HoopRushManifest {
  return hoopRushManifestSchema.parse(value);
}

/** Fetch and validate the Hoop Rush manifest from a base URL. */
export async function loadManifest(url: string): Promise<HoopRushManifest> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`manifest request failed: ${response.status} ${response.statusText}`);
  }
  return parseManifest(await response.json());
}
