import { describe, expect, test } from 'bun:test';
import {
  capRushMultiplayerActiveRound,
  capRushMultiplayerCheckpointOf,
  capRushMultiplayerStateDigest,
  createEngineContext,
  simulateCapRushMultiplayerSlot,
} from '@hoop-rush/engine';
import { createSessionTestRoom } from './session-test-fixtures.ts';

describe('cap rush multiplayer disconnect and resume', () => {
  test('resumes bidding and simulation without duplicate signings, games, or acknowledgements', async () => {
    let nowMs = Date.parse('2026-11-01T00:00:00.000Z');
    const room = await createSessionTestRoom({ now: () => nowMs, commandPrefix: 'resume' });
    const { transport, roomId } = room;

    let host = room.session('p1');
    await host.attach();
    await transport.join(room.code);
    let guest = room.session('p2');
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

    host = room.session('p1');
    await host.attach();
    guest = room.session('p2');
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

    host = room.session('p1');
    await host.attach();
    guest = room.session('p2');
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
