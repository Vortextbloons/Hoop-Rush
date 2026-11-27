import {
  fullCourtHealthProfileSetSchema,
  type FullCourtHealthProfileSet,
} from '@hoop-rush/data-contracts';
import { loadManifestAsset } from '#lib/manifest-assets.js';

/**
 * The pinned profile set is optional so legacy manifests and runs without
 * historical injury evidence keep working. The asset itself must match the
 * packaged catalog bytes it was fitted from.
 */
export async function loadFullCourtHealthProfiles(
  catalogAssetHash: string,
): Promise<FullCourtHealthProfileSet | null> {
  const profiles = await loadManifestAsset({
    key: `full-court/health-profiles:${catalogAssetHash}`,
    label: 'Full Court historical injury profiles',
    parse: (value) => fullCourtHealthProfileSetSchema.parse(value),
    find: (manifest) => manifest.fullCourtHealthProfiles ?? null,
    missingMessage: 'The Full Court historical injury profiles artifact is unavailable.',
    optional: true,
  });
  if (profiles !== null && profiles.catalogHash !== catalogAssetHash) {
    throw new Error(
      'The Full Court historical injury profiles were built for a different draft catalog.',
    );
  }
  return profiles;
}
