import { hoopRushManifestSchema, type HoopRushManifest } from '../manifest.ts';
export async function loadManifest(url: string, init?: RequestInit): Promise<HoopRushManifest> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`manifest request failed: ${String(response.status)} ${response.statusText}`);
  }
  return hoopRushManifestSchema.parse(await response.json());
}
