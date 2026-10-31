import type { EraSimulationProfile } from '../era-sim-profile.ts';
import { eraSimulationProfileSchema } from '../era-sim-profile.ts';
import { loadAsset } from './index.ts';
export function parseEraSimulationProfile(value: unknown): EraSimulationProfile {
  return eraSimulationProfileSchema.parse(value);
}
export function loadEraSimulationProfile(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<EraSimulationProfile> {
  return loadAsset(url, eraSimulationProfileSchema, 'era simulation profile', expectedHash, init);
}
