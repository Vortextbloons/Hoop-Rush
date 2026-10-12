import {
  buildDraftDuelCatalogSource,
  type EraSimulationProfile,
  type HoopRushManifest,
} from '@hoop-rush/data-contracts';
import {
  buildDraftDuelCatalog,
  createEngineContext,
  type DraftDuelCatalog,
  type EngineContext,
} from '@hoop-rush/engine';
import { getManifest } from '$lib/data';
import { loadCollectionCatalog } from '$lib/features/collection/collection-assets';
import { loadCollectionProfile } from '$lib/features/collection/collection-hub';

export interface DraftDuelAssets {
  catalog: DraftDuelCatalog;
  manifest: HoopRushManifest;
  profile: EraSimulationProfile;
  context: EngineContext;
}
let assetsPromise: Promise<DraftDuelAssets> | null = null;
export function loadDraftDuelAssets(): Promise<DraftDuelAssets> {
  assetsPromise ??= (async () => {
    const [catalog, profile, manifest] = await Promise.all([
      loadCollectionCatalog(),
      loadCollectionProfile(),
      getManifest(),
    ]);
    return {
      catalog: buildDraftDuelCatalog(buildDraftDuelCatalogSource(catalog)),
      manifest,
      profile,
      context: createEngineContext(),
    };
  })();
  return assetsPromise;
}
