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
import { cachedAssets } from '#lib/assets/cached-assets.js';
import { loadEraProfile } from '#lib/assets/era-profile.js';
import { loadPlayerCatalog } from '#lib/assets/player-catalog.js';
import { getManifest } from '#lib/data.js';

export interface DraftDuelAssets {
  catalog: DraftDuelCatalog;
  manifest: HoopRushManifest;
  profile: EraSimulationProfile;
  context: EngineContext;
}

const assets = cachedAssets(async () => {
  const [catalog, profile, manifest] = await Promise.all([
    loadPlayerCatalog(),
    loadEraProfile('2020s'),
    getManifest(),
  ]);
  return {
    catalog: buildDraftDuelCatalog(buildDraftDuelCatalogSource(catalog)),
    manifest,
    profile,
    context: createEngineContext(),
  };
});

/** Concurrent calls share one load; a rejection is retried by the next call. */
export function loadDraftDuelAssets(): Promise<DraftDuelAssets> {
  return assets.load();
}
