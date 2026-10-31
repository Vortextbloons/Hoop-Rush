import {
  adaptCapRushCatalog,
  buildCapRushCatalogIndex,
  ENGINE_VERSION,
  type CapRushMultiplayerEnvironment,
} from '@hoop-rush/engine';
import type {
  CapRushCatalogSource,
  CapRushMultiplayerVersionLocks,
  SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_MULTIPLAYER_MARKET_VERSION,
  CAP_RUSH_MULTIPLAYER_PRICING_VERSION,
  CAP_RUSH_MULTIPLAYER_RULES_VERSION,
  CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
  CAP_RUSH_MULTIPLAYER_SEED_DERIVATION_VERSION,
  CAP_RUSH_MULTIPLAYER_VERSION,
  capRushMultiplayerVersionLocksSchema,
} from '@hoop-rush/data-contracts';
import { loadCapRushRosterMetadata, loadDraftCatalog } from '#lib/data-assets.js';
import { loadRunPreamble } from '#lib/run-preamble.js';
import { capRushBracketWithRosterMetadata } from '../cap-rush/cap-rush-opponent-metadata.js';

export interface CapRushMultiplayerData {
  readonly environment: CapRushMultiplayerEnvironment;
  readonly versionLocks: CapRushMultiplayerVersionLocks;
  readonly catalog: SeasonDraftCatalog;
}

let dataPromise: Promise<CapRushMultiplayerData> | null = null;

async function buildData(): Promise<CapRushMultiplayerData> {
  const [catalog, preamble, metadata] = await Promise.all([
    loadDraftCatalog(),
    loadRunPreamble((manifest) => manifest.capRushBracket),
    loadCapRushRosterMetadata(),
  ]);
  const manifest = preamble.manifest;
  const catalogEntry = manifest.draftCatalog;
  const profileEntry = manifest.eraSimulationProfiles.find((entry) => entry.eraId === '2010s');
  const bracketEntry = manifest.capRushBracket ?? manifest.bracket;
  if (catalogEntry === undefined || profileEntry === undefined || bracketEntry === undefined) {
    throw new Error('The Cap Rush multiplayer data assets are unavailable.');
  }
  const catalogSource: CapRushCatalogSource = {
    catalogVersion: catalog.catalogVersion,
    catalogHash: catalogEntry.contentHash,
    dataVersion: catalog.dataVersion,
    ratingsVersion: catalog.ratingsVersion,
    playerVersionIdVersion: catalog.playerVersionIdVersion,
    positionNormalizationVersion: catalog.positionNormalizationVersion,
  };
  const bracket = capRushBracketWithRosterMetadata(
    preamble.bracket,
    metadata,
    bracketEntry.contentHash,
  );
  const versionLocks = capRushMultiplayerVersionLocksSchema.parse({
    schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
    multiplayerVersion: CAP_RUSH_MULTIPLAYER_VERSION,
    rulesVersion: CAP_RUSH_MULTIPLAYER_RULES_VERSION,
    marketVersion: CAP_RUSH_MULTIPLAYER_MARKET_VERSION,
    pricingVersion: CAP_RUSH_MULTIPLAYER_PRICING_VERSION,
    seedDerivationVersion: CAP_RUSH_MULTIPLAYER_SEED_DERIVATION_VERSION,
    engineVersion: ENGINE_VERSION,
    profileVersion: preamble.profile.profileVersion,
    dataVersion: catalog.dataVersion,
    catalogVersion: catalog.catalogVersion,
    catalogHash: catalogEntry.contentHash,
    bracketHash: bracketEntry.contentHash,
    profileHash: profileEntry.contentHash,
  });
  return {
    environment: {
      variant: 'clash',
      bracket,
      seasonCatalog: catalog,
      index: buildCapRushCatalogIndex(adaptCapRushCatalog(catalog, catalogSource)),
      profile: preamble.profile,
      catalogSource,
      versionLocks,
    },
    versionLocks,
    catalog,
  };
}

export function getCapRushMultiplayerData(): Promise<CapRushMultiplayerData> {
  if (dataPromise === null) dataPromise = buildData();
  return dataPromise;
}

export async function loadCapRushMultiplayerVersionLocks(): Promise<CapRushMultiplayerVersionLocks> {
  return (await getCapRushMultiplayerData()).versionLocks;
}
