import { buildDraftDuelCatalogSource, type EraSimulationProfile } from '@hoop-rush/data-contracts';
import {
  buildDraftDuelCatalog,
  createEngineContext,
  type DraftDuelCatalog,
  type EngineContext,
} from '@hoop-rush/engine';
import { loadCollectionCatalog } from '$lib/collection/collection-assets';
import { loadCollectionProfile } from '$lib/collection/collection-hub';

export interface DraftDuelAssets {
  catalog: DraftDuelCatalog;
  profile: EraSimulationProfile;
  context: EngineContext;
}
let assetsPromise: Promise<DraftDuelAssets> | null = null;
export function loadDraftDuelAssets(): Promise<DraftDuelAssets> {
  assetsPromise ??= (async () => {
    const [catalog, profile] = await Promise.all([
      loadCollectionCatalog(),
      loadCollectionProfile(),
    ]);
    return {
      catalog: buildDraftDuelCatalog(buildDraftDuelCatalogSource(catalog)),
      profile,
      context: createEngineContext(),
    };
  })();
  return assetsPromise;
}
