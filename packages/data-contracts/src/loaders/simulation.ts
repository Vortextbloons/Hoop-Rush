import type { EraSimulationProfile } from '../era-sim-profile.ts';
import { eraSimulationProfileSchema } from '../era-sim-profile.ts';
import type { OpponentTeam } from '../opponent.ts';
import { opponentTeamSchema } from '../opponent.ts';
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
export function parseOpponentTeam(value: unknown): OpponentTeam {
  return opponentTeamSchema.parse(value);
}
