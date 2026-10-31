import { describe, expect, test } from 'bun:test';
import type { CapRushMultiplayerSettings } from '@hoop-rush/data-contracts';
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
  createEngineContext,
  simulateCapRushMultiplayerSlot,
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

function setup() {
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
  const environment = {
    variant: 'clash' as const,
    bracket: buildFixtureBracket(),
    seasonCatalog: catalog,
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
  return { environment, settings };
}

describe('cap rush multiplayer application session', () => {
  test('opens two seats, locks a recruited league, and advances one shared slot', async () => {
    const { environment, settings } = setup();
    let nowMs = Date.parse('2026-11-01T00:00:00.000Z');
    const transport = new CapRushMultiplayerInMemoryTransport({
      environment,
      defaultSettings: settings,
      rootSeed: ROOT,
      now: () => nowMs,
    });
    const created = await transport.create({ variant: 'clash', settings });
    const roomId = created.roomId;

    const counters = { p1: 0, p2: 0 };
    const makeSession = (seat: 'p1' | 'p2') =>
      new CapRushMultiplayerSession({
        transport,
        environment,
        roomId,
        seat,
        newCommandId: () => `${seat}-cmd-${String((counters[seat] += 1))}`,
      });

    const host = makeSession('p1');
    await host.attach();
    const joined = await transport.join(created.code);
    expect(joined.participantId).toBe('p2');
    const guest = makeSession('p2');
    await guest.attach();

    await host.ready(true);
    await guest.ready(true);
    await host.start();
    await host.refresh();
    await guest.refresh();
    expect(host.current.phase).toBe('recruiting');
    expect(guest.current.recruitment?.market.players).toHaveLength(60);

    for (let round = 0; round < 5; round += 1) {
      nowMs += 61_000;
      const receipt = await transport.closeDueAuctions(roomId);
      expect(receipt?.accepted).toBe(true);
      await host.refresh();
      await guest.refresh();
    }
    expect(host.current.phase).toBe('preparation');
    expect(guest.current.locked?.seats.p2.picks).toHaveLength(5);

    await host.confirmLock();
    await guest.confirmLock();
    await host.refresh();
    await guest.refresh();
    expect(host.current.phase).toBe('season');
    expect(guest.current.phase).toBe('season');

    await host.chooseBlockPlan(0, 'sim');
    await guest.chooseBlockPlan(0, 'sim');
    await host.refresh();
    await guest.refresh();
    expect(host.current.season?.block.status).toBe('running');

    const locked = host.current.locked;
    if (locked === null) throw new Error('no locked inputs');
    const simulated = simulateCapRushMultiplayerSlot({
      locked,
      slot: 1,
      context: createEngineContext(),
    });
    const accepted = await host.acceptSlot(1, simulated.games);
    expect(accepted.accepted).toBe(true);
    await host.ackSlot(1);
    await guest.ackSlot(1);
    await host.refresh();
    await guest.refresh();
    expect(host.current.season?.frontierSlot).toBe(1);
    expect(guest.current.season?.frontierSlot).toBe(1);
    expect(host.nextSlot()).toBe(2);

    expect(await host.verifyLog()).toBe(true);
    expect(await guest.verifyLog()).toBe(true);
    host.dispose();
    guest.dispose();
  }, 300_000);
});
