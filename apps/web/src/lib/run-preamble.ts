import type {
  EraSimulationProfile,
  HoopRushManifest,
  OpponentBracket,
} from '@hoop-rush/data-contracts';
import { getBracket, getEraSimulationProfile, getManifest } from '$lib/data';
export const FIXED_SANDBOX_ERA = '2010s';
export async function loadRunPreamble(): Promise<{
  manifest: HoopRushManifest;
  profile: EraSimulationProfile;
  bracket: OpponentBracket;
}> {
  const manifest = await getManifest();
  const profileEntry = manifest.eraSimulationProfiles.find((p) => p.eraId === FIXED_SANDBOX_ERA);
  if (!profileEntry) {
    throw new Error('The decade simulation profile is unavailable.');
  }
  if (!manifest.bracket) {
    throw new Error('The opponent bracket is unavailable.');
  }
  const [profile, bracket] = await Promise.all([
    getEraSimulationProfile(profileEntry),
    getBracket(manifest.bracket),
  ]);
  return { manifest, profile, bracket };
}
