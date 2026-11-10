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
import { cachedAssets } from '#lib/assets/cached-assets.js';
import { loadRunPreamble } from '#lib/run-preamble.js';
import { loadDraftCatalog } from '#lib/data-assets.js';

const HAVOC_ERA_ID = '2010s';

export interface HavocMultiplayerDraftAssets {
  catalog: HavocCatalog;
  environment: HavocCommandEnvironment;
}

const assets = cachedAssets(async (): Promise<HavocMultiplayerSessionAssets> => {
  const [preamble, draftCatalog] = await Promise.all([loadRunPreamble(), loadDraftCatalog()]);
  const catalogEntry = preamble.manifest.draftCatalog;
  const profileEntry = preamble.manifest.eraSimulationProfiles.find(
    (entry) => entry.eraId === HAVOC_ERA_ID,
  );
  const bracketEntry = preamble.manifest.bracket;
  if (!catalogEntry || !profileEntry || !bracketEntry) {
    throw new Error('The havoc multiplayer data assets are unavailable.');
  }
  const catalogSource: HavocCatalogSource = {
    catalogVersion: draftCatalog.catalogVersion,
    catalogHash: catalogEntry.contentHash,
    dataVersion: draftCatalog.dataVersion,
    ratingsVersion: draftCatalog.ratingsVersion,
    playerVersionIdVersion: draftCatalog.playerVersionIdVersion,
    positionNormalizationVersion: draftCatalog.positionNormalizationVersion,
  };
  const versionSet: HavocVersionSet = {
    schemaVersion: HAVOC_SCHEMA_VERSION,
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    seedDerivationVersion: HAVOC_SEED_DERIVATION_VERSION,
    engineVersion: ENGINE_VERSION,
    profileVersion: preamble.profile.profileVersion,
    dataVersion: draftCatalog.dataVersion,
    catalogVersion: draftCatalog.catalogVersion,
    catalogHash: catalogEntry.contentHash,
    bracketHash: bracketEntry.contentHash,
    profileHash: profileEntry.contentHash,
  };
  return {
    catalog: AdaptHavocCatalog(draftCatalog, catalogSource),
    manifest: preamble.manifest,
    profile: preamble.profile,
    versionSet,
    context: createEngineContext(),
  };
});

const draftAssets = cachedAssets(async (): Promise<HavocMultiplayerDraftAssets> => {
  const loaded = await assets.load();
  return {
    catalog: loaded.catalog,
    environment: createHavocCommandEnvironment(loaded.catalog, {
      rngFactory: createRng,
      definitions: HAVOC_MUTATION_DEFINITIONS,
    }),
  };
});

/** Concurrent calls share one load; a rejection is retried by the next call. */
export function loadHavocMultiplayerAssets(): Promise<HavocMultiplayerSessionAssets> {
  return assets.load();
}

/** Concurrent calls share one draft environment; a rejection is retried next call. */
export function loadHavocMultiplayerDraftAssets(): Promise<HavocMultiplayerDraftAssets> {
  return draftAssets.load();
}

export async function loadHavocMultiplayerVersionLocks(): Promise<HavocMultiplayerVersionLocks> {
  const loaded = await assets.load();
  return defaultHavocMultiplayerVersionLocks({
    engineVersion: loaded.versionSet.engineVersion,
    rulesVersion: loaded.versionSet.rulesVersion,
    mutationCatalogVersion: loaded.versionSet.mutationCatalogVersion,
    profileVersion: loaded.versionSet.profileVersion,
    dataVersion: loaded.versionSet.dataVersion,
    catalogVersion: loaded.versionSet.catalogVersion,
    catalogHash: loaded.versionSet.catalogHash,
    profileHash: loaded.versionSet.profileHash,
  });
}
