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
  capRushMultiplayerActiveRound,
  capRushMultiplayerCheckpointOf,
  capRushMultiplayerStateDigest,
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

describe('cap rush multiplayer disconnect and resume', () => {
  test('resumes bidding and simulation without duplicate signings, games, or acknowledgements', async () => {
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

    let counter = 0;
    const makeSession = (seat: 'p1' | 'p2') =>
      new CapRushMultiplayerSession({
        transport,
        environment,
        roomId,
        seat,
        newCommandId: () => `resume-${seat}-${String((counter += 1))}`,
      });

    let host = makeSession('p1');
    await host.attach();
    await transport.join(created.code);
    let guest = makeSession('p2');
    await guest.attach();

    await host.start();
    await host.refresh();
    await guest.refresh();

    const recruitment = host.current.recruitment;
    if (recruitment === null) throw new Error('no recruitment');
    const lot = capRushMultiplayerActiveRound(recruitment).auctions[0];
    if (lot === undefined) throw new Error('no lot');
    const player = recruitment.market.players.find((entry) => entry.playerId === lot.playerId);
    if (player === undefined) throw new Error('no player');
    await host.bid(0, lot.playerId, player.minimumBidDollars);

    nowMs += 61_000;
    const closed = await transport.closeDueAuctions(roomId);
    expect(closed?.accepted).toBe(true);
    await host.refresh();
    await guest.refresh();

    const signingsBefore = host.current.recruitment?.signings.length ?? 0;
    const commandsBefore = host.room?.commandCount ?? 0;
    const digestBefore = capRushMultiplayerStateDigest(host.current);
    host.dispose();
    guest.dispose();

    host = makeSession('p1');
    await host.attach();
    guest = makeSession('p2');
    await guest.attach();
    expect(host.current.recruitment?.signings.length).toBe(signingsBefore);
    expect(host.room?.commandCount).toBe(commandsBefore);
    expect(capRushMultiplayerStateDigest(host.current)).toBe(digestBefore);

    const log = await transport.sync(roomId);
    const bidCommand = log.commands.find((command) => command.payload.kind === 'bid');
    if (bidCommand === undefined) throw new Error('no bid command');
    const retried = await transport.submitCommand({
      roomId,
      commandId: bidCommand.commandId,
      actorParticipantId: 'p1',
      expectedRevision: log.snapshot.revision,
      payload: bidCommand.payload,
    });
    expect(retried.accepted).toBe(true);
    expect(retried.ordinal).toBe(bidCommand.ordinal);
    await host.refresh();
    expect(host.current.recruitment?.signings.length).toBe(signingsBefore);

    for (let round = 1; round < 5; round += 1) {
      nowMs += 61_000;
      const receipt = await transport.closeDueAuctions(roomId);
      expect(receipt?.accepted).toBe(true);
    }
    await host.refresh();
    await guest.refresh();
    await host.confirmLock();
    await guest.confirmLock();
    await host.refresh();
    await guest.refresh();
    expect(host.current.phase).toBe('season');

    await host.chooseBlockPlan(0, 'sim');
    await guest.chooseBlockPlan(0, 'sim');
    await host.refresh();
    await guest.refresh();

    const locked = host.current.locked;
    if (locked === null) throw new Error('no locked inputs');
    const simulated = simulateCapRushMultiplayerSlot({
      locked,
      slot: 1,
      context: createEngineContext(),
    });
    await host.acceptSlot(1, simulated.games);
    await host.ackSlot(1);
    await guest.ackSlot(1);
    await host.refresh();
    await guest.refresh();
    expect(host.current.season?.games).toHaveLength(15);
    expect(host.current.season?.frontierSlot).toBe(1);

    const gamesBefore = host.current.season?.games.length ?? 0;
    const slotAcksBefore = host.current.season?.slotAcks;
    const checkpointBefore = capRushMultiplayerCheckpointOf({
      state: host.current,
      revision: host.room?.revision ?? 0,
      commandCount: host.room?.commandCount ?? 0,
    });
    host.dispose();
    guest.dispose();

    host = makeSession('p1');
    await host.attach();
    guest = makeSession('p2');
    await guest.attach();
    expect(host.current.season?.games).toHaveLength(gamesBefore);
    expect(host.current.season?.slotAcks).toEqual(slotAcksBefore);
    expect(host.current.season?.frontierSlot).toBe(1);
    const checkpointAfter = capRushMultiplayerCheckpointOf({
      state: host.current,
      revision: host.room?.revision ?? 0,
      commandCount: host.room?.commandCount ?? 0,
    });
    expect(checkpointAfter.stateDigest).toBe(checkpointBefore.stateDigest);
    expect(checkpointAfter.gamesDigest).toBe(checkpointBefore.gamesDigest);
    expect(checkpointAfter.commandCount).toBe(checkpointBefore.commandCount);

    await host.ackSlot(1);
    await host.refresh();
    expect(host.current.season?.slotAcks).toEqual(slotAcksBefore);
    expect(host.current.season?.games).toHaveLength(gamesBefore);

    const duplicate = await host.acceptSlot(1, simulated.games);
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.rejectionCode).toBe('frontier-gap');
    await host.refresh();
    expect(host.current.season?.games).toHaveLength(gamesBefore);

    const game = host.current.season?.games.find((entry) => entry.slot === 1);
    if (game === undefined) throw new Error('no game');
    await host.ackBroadcast({ gameId: game.gameId, cursor: 1, total: 1, resolved: true });
    await host.ackBroadcast({ gameId: game.gameId, cursor: 1, total: 1, resolved: true });
    await host.refresh();
    const acks = host.current.season?.playbackAcks.filter(
      (ack) => ack.gameId === game.gameId && ack.seat === 'p1',
    );
    expect(acks).toHaveLength(1);

    expect(await host.verifyLog()).toBe(true);
    expect(await guest.verifyLog()).toBe(true);
    host.dispose();
    guest.dispose();
  }, 300_000);
});
