import type { CapRushMultiplayerEnvironment } from './state.ts';
import type { CapRushTestSetup } from '../cap-rush-test-support.ts';
import {
  CAP_RUSH_MULTIPLAYER_MARKET_VERSION,
  CAP_RUSH_MULTIPLAYER_PRICING_VERSION,
  CAP_RUSH_MULTIPLAYER_RULES_VERSION,
  CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
  CAP_RUSH_MULTIPLAYER_SEED_DERIVATION_VERSION,
  CAP_RUSH_MULTIPLAYER_VERSION,
  capRushMultiplayerVersionLocksSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';

export function capRushTestRootSeed() {
  return seedSchema.parse('abc123def4567890');
}

export function capRushTestDate(): number {
  return Date.parse('2026-11-01T00:00:00.000Z');
}

export function capRushTestEnvironment(setup: CapRushTestSetup): CapRushMultiplayerEnvironment {
  const versionLocks = capRushMultiplayerVersionLocksSchema.parse({
    schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
    multiplayerVersion: CAP_RUSH_MULTIPLAYER_VERSION,
    rulesVersion: CAP_RUSH_MULTIPLAYER_RULES_VERSION,
    marketVersion: CAP_RUSH_MULTIPLAYER_MARKET_VERSION,
    pricingVersion: CAP_RUSH_MULTIPLAYER_PRICING_VERSION,
    seedDerivationVersion: CAP_RUSH_MULTIPLAYER_SEED_DERIVATION_VERSION,
    engineVersion: setup.versionSet.engineVersion,
    profileVersion: setup.versionSet.profileVersion,
    dataVersion: setup.versionSet.dataVersion,
    catalogVersion: setup.versionSet.catalogVersion,
    catalogHash: setup.versionSet.catalogHash,
    bracketHash: setup.versionSet.bracketHash,
    profileHash: setup.versionSet.profileHash,
  });
  return {
    variant: 'clash',
    bracket: setup.lockSources.bracket,
    seasonCatalog: setup.catalog,
    index: setup.index,
    profile: setup.lockSources.profile,
    catalogSource: setup.source,
    versionLocks,
  };
}
