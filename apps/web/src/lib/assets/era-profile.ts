import { loadEraSimulationProfile, type EraSimulationProfile } from '@hoop-rush/data-contracts';
import { resolveAssetUrl } from '#lib/asset-url.js';
import { getManifest } from '#lib/data.js';

export async function loadEraProfile(eraId: string): Promise<EraSimulationProfile> {
  const manifest = await getManifest();
  const entry = manifest.eraSimulationProfiles.find((profile) => profile.eraId === eraId);
  if (!entry) throw new Error(`The ${eraId} simulation profile is unavailable.`);
  return loadEraSimulationProfile(resolveAssetUrl(entry.url), entry.contentHash);
}
