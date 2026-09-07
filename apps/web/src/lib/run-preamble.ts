import type {
  EraSimulationProfile,
  HoopRushManifest,
  OpponentBracket,
} from '@hoop-rush/data-contracts';
import { getBracket, getEraSimulationProfile, getManifest } from '$lib/data';
export const FIXED_SANDBOX_ERA = '2010s';
export type ChallengeDifficulty = 'medium' | 'casual';
export async function loadRunPreamble(difficulty: ChallengeDifficulty = 'medium'): Promise<{
  manifest: HoopRushManifest;
  profile: EraSimulationProfile;
  bracket: OpponentBracket;
}> {
  const manifest = await getManifest();
  const profileEntry = manifest.eraSimulationProfiles.find((p) => p.eraId === FIXED_SANDBOX_ERA);
  if (!profileEntry) {
    throw new Error('The decade simulation profile is unavailable.');
  }
  const bracketEntry =
    difficulty === 'casual' ? (manifest.bracketCasual ?? manifest.bracket) : manifest.bracket;
  if (!bracketEntry) {
    throw new Error('The opponent bracket is unavailable.');
  }
  const [profile, bracket] = await Promise.all([
    getEraSimulationProfile(profileEntry),
    getBracket(bracketEntry),
  ]);
  return { manifest, profile, bracket };
}
