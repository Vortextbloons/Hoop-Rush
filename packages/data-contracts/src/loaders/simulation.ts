import type { EraSimulationProfile } from '../era-sim-profile.js';
import { eraSimulationProfileSchema } from '../era-sim-profile.js';
import type { OpponentTeam } from '../opponent.js';
import { opponentTeamSchema } from '../opponent.js';
import { verifySha256 } from './verify-hash.js';

/** Validates an era simulation profile at a runtime boundary. */
export function parseEraSimulationProfile(value: unknown): EraSimulationProfile {
  return eraSimulationProfileSchema.parse(value);
}

/** Fetches and hash-verifies an EraSimulationProfile artifact. */
export async function loadEraSimulationProfile(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<EraSimulationProfile> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(
      `failed to load era simulation profile from ${url}: HTTP ${String(response.status)}`,
    );
  }
  const bytes = await response.arrayBuffer();
  if (expectedHash !== undefined) {
    await verifySha256(bytes, expectedHash);
  }
  return parseEraSimulationProfile(JSON.parse(new TextDecoder().decode(bytes)));
}

/** Validates an opponent-team artifact at a runtime boundary. */
export function parseOpponentTeam(value: unknown): OpponentTeam {
  return opponentTeamSchema.parse(value);
}
