import {
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
  HAVOC_SEED_DERIVATION_VERSION,
  defaultHavocMultiplayerVersionLocks,
  type HavocCatalog,
  type HavocCatalogSource,
  type HavocMultiplayerVersionLocks,
  type HavocVersionSet,
} from '@hoop-rush/data-contracts';
import {
  AdaptHavocCatalog,
  ENGINE_VERSION,
  HAVOC_MUTATION_DEFINITIONS,
  createEngineContext,
  createHavocCommandEnvironment,
  createRng,
  type HavocCommandEnvironment,
} from '@hoop-rush/engine';
import type { HavocMultiplayerSessionAssets } from '@hoop-rush/application/havoc-multiplayer';
import { loadRunPreamble } from '$lib/run-preamble';
import { loadSeasonDraftCatalog } from '$lib/season/season-assets';

const HAVOC_ERA_ID = '2010s';

export interface HavocMultiplayerDraftAssets {
  catalog: HavocCatalog;
  environment: HavocCommandEnvironment;
}

let assetsPromise: Promise<HavocMultiplayerSessionAssets> | null = null;

export function loadHavocMultiplayerAssets(): Promise<HavocMultiplayerSessionAssets> {
  assetsPromise ??= (async () => {
    const [preamble, seasonCatalog] = await Promise.all([
      loadRunPreamble(),
      loadSeasonDraftCatalog(),
    ]);
    const catalogEntry = preamble.manifest.season?.draftCatalog;
    const profileEntry = preamble.manifest.eraSimulationProfiles.find(
      (entry) => entry.eraId === HAVOC_ERA_ID,
    );
    const bracketEntry = preamble.manifest.bracket;
    if (!catalogEntry || !profileEntry || !bracketEntry) {
      throw new Error('The havoc multiplayer data assets are unavailable.');
    }
    const catalogSource: HavocCatalogSource = {
      catalogVersion: seasonCatalog.catalogVersion,
      catalogHash: catalogEntry.contentHash,
      dataVersion: seasonCatalog.dataVersion,
      ratingsVersion: seasonCatalog.ratingsVersion,
      playerVersionIdVersion: seasonCatalog.playerVersionIdVersion,
      positionNormalizationVersion: seasonCatalog.positionNormalizationVersion,
    };
    const versionSet: HavocVersionSet = {
      schemaVersion: HAVOC_SCHEMA_VERSION,
      rulesVersion: HAVOC_RULES_VERSION,
      mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
      seedDerivationVersion: HAVOC_SEED_DERIVATION_VERSION,
      engineVersion: ENGINE_VERSION,
      profileVersion: preamble.profile.profileVersion,
      dataVersion: seasonCatalog.dataVersion,
      catalogVersion: seasonCatalog.catalogVersion,
      catalogHash: catalogEntry.contentHash,
      bracketHash: bracketEntry.contentHash,
      profileHash: profileEntry.contentHash,
    };
    return {
      catalog: AdaptHavocCatalog(seasonCatalog, catalogSource),
      manifest: preamble.manifest,
      profile: preamble.profile,
      versionSet,
      context: createEngineContext(),
    };
  })();
  return assetsPromise;
}

let draftAssetsPromise: Promise<HavocMultiplayerDraftAssets> | null = null;

export function loadHavocMultiplayerDraftAssets(): Promise<HavocMultiplayerDraftAssets> {
  draftAssetsPromise ??= loadHavocMultiplayerAssets().then((assets) => ({
    catalog: assets.catalog,
    environment: createHavocCommandEnvironment(assets.catalog, {
      rngFactory: createRng,
      definitions: HAVOC_MUTATION_DEFINITIONS,
    }),
  }));
  return draftAssetsPromise;
}

export async function loadHavocMultiplayerVersionLocks(): Promise<HavocMultiplayerVersionLocks> {
  const assets = await loadHavocMultiplayerAssets();
  return defaultHavocMultiplayerVersionLocks({
    engineVersion: assets.versionSet.engineVersion,
    rulesVersion: assets.versionSet.rulesVersion,
    mutationCatalogVersion: assets.versionSet.mutationCatalogVersion,
    profileVersion: assets.versionSet.profileVersion,
    dataVersion: assets.versionSet.dataVersion,
    catalogVersion: assets.versionSet.catalogVersion,
    catalogHash: assets.versionSet.catalogHash,
    profileHash: assets.versionSet.profileHash,
  });
}
