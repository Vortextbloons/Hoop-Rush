import type {
  EraSimulationProfile,
  HoopRushManifest,
  OpponentBracket,
  OpponentIndexEntry,
} from '@hoop-rush/data-contracts';
import { getBracket, getEraSimulationProfile, getManifest } from '#lib/data.js';
export const FIXED_SANDBOX_ERA = '2010s';
export async function loadRunPreamble(
  selectBracket: (manifest: HoopRushManifest) => OpponentIndexEntry | undefined = (manifest) =>
    manifest.bracket,
): Promise<{
  manifest: HoopRushManifest;
  profile: EraSimulationProfile;
  bracket: OpponentBracket;
}> {
  const manifest = await getManifest();
  const profileEntry = manifest.eraSimulationProfiles.find((p) => p.eraId === FIXED_SANDBOX_ERA);
  if (!profileEntry) {
    throw new Error('The decade simulation profile is unavailable.');
  }
  const bracketEntry = selectBracket(manifest);
  if (!bracketEntry) {
    throw new Error('The opponent bracket is unavailable.');
  }
  const [profile, bracket] = await Promise.all([
    getEraSimulationProfile(profileEntry),
    getBracket(bracketEntry),
  ]);
  return { manifest, profile, bracket };
}
