import type {
  CapRushMultiplayerSeatId,
  CapRushMultiplayerSettings,
} from '@hoop-rush/data-contracts';
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
import {
  adaptCapRushCatalog,
  buildCapRushCatalogIndex,
  type CapRushMultiplayerEnvironment,
} from '@hoop-rush/engine';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCapRushTestCatalog,
  buildFixtureBracket,
  capRushTestCatalogSource,
} from '@hoop-rush/test-fixtures';
import { CapRushMultiplayerInMemoryTransport } from './in-memory-transport.ts';
import { CapRushMultiplayerSession } from './session.ts';

const ROOT = seedSchema.parse('abc123def4567890');

export interface CapRushMultiplayerSessionTestRoom {
  readonly environment: CapRushMultiplayerEnvironment;
  readonly settings: CapRushMultiplayerSettings;
  readonly transport: CapRushMultiplayerInMemoryTransport;
  readonly roomId: string;
  readonly code: string;
  session(seat: CapRushMultiplayerSeatId): CapRushMultiplayerSession;
}

export async function createSessionTestRoom(
  options: { now?: () => number; commandPrefix?: string } = {},
): Promise<CapRushMultiplayerSessionTestRoom> {
  const catalog = buildCapRushTestCatalog();
  const source = capRushTestCatalogSource(catalog);
  const index = buildCapRushCatalogIndex(adaptCapRushCatalog(catalog, source));
  const versionLocks = capRushMultiplayerVersionLocksSchema.parse({
    schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
    multiplayerVersion: CAP_RUSH_MULTIPLAYER_VERSION,
    rulesVersion: CAP_RUSH_MULTIPLAYER_RULES_VERSION,
    marketVersion: CAP_RUSH_MULTIPLAYER_MARKET_VERSION,
    pricingVersion: CAP_RUSH_MULTIPLAYER_PRICING_VERSION,
    seedDerivationVersion: CAP_RUSH_MULTIPLAYER_SEED_DERIVATION_VERSION,
    engineVersion: 'test-engine-v1',
    profileVersion: 'test-profile-v1',
    dataVersion: source.dataVersion,
    catalogVersion: source.catalogVersion,
    catalogHash: source.catalogHash,
    bracketHash: 'b'.repeat(64),
    profileHash: 'c'.repeat(64),
  });
  const bracket = buildFixtureBracket();
  const environment: CapRushMultiplayerEnvironment = {
    variant: 'clash',
    bracket,
    seasonCatalog: {
      ...catalog,
      candidates: bracket.opponents.flatMap((opponent) =>
        catalog.candidates.map((player) => ({ ...player, franchiseId: opponent.teamId })),
      ),
    },
    index,
    profile: DEFAULT_ERA_SIM_PROFILE,
    catalogSource: source,
    versionLocks,
  };
  const settings: CapRushMultiplayerSettings = {
    schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
    variant: 'clash',
    versionLocks,
  };
  const transport = new CapRushMultiplayerInMemoryTransport({
    environment,
    defaultSettings: settings,
    rootSeed: ROOT,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const created = await transport.create({ variant: 'clash', settings });
  const counters: Record<CapRushMultiplayerSeatId, number> = { p1: 0, p2: 0 };
  const commandPrefix = options.commandPrefix ?? 'test';
  return {
    environment,
    settings,
    transport,
    roomId: created.roomId,
    code: created.code,
    session: (seat) =>
      new CapRushMultiplayerSession({
        transport,
        environment,
        roomId: created.roomId,
        seat,
        newCommandId: () => `${commandPrefix}-${seat}-${String((counters[seat] += 1))}`,
      }),
  };
}
