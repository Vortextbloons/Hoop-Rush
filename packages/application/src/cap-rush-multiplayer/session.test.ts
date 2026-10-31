import { describe, expect, test, vi } from 'bun:test';
import { createEngineContext, simulateCapRushMultiplayerSlot } from '@hoop-rush/engine';
import { createSessionTestRoom } from './session-test-fixtures.ts';

describe('cap rush multiplayer application session', () => {
  test('coalesces realtime refreshes, skips overlapping polls, and drops work after disposal', async () => {
    const room = await createSessionTestRoom();
    const { transport } = room;
    const session = room.session('p1');
    await session.attach();
    const initial = session.current;
    const response = await transport.sync(room.roomId);
    let resolve!: (value: typeof response) => void;
    const pending = new Promise<typeof response>((yes) => {
      resolve = yes;
    });
    const sync = vi
      .spyOn(transport, 'sync')
      .mockReturnValueOnce(pending)
      .mockResolvedValue(response);
    const first = session.refresh(false);
    const poll = session.refresh(false);
    expect(sync).toHaveBeenCalledTimes(1);
    const notified = session.refresh();
    void session.refresh(false);
    resolve(response);
    await Promise.all([first, poll, notified]);
    expect(sync).toHaveBeenCalledTimes(2);
    const beforeDisposal = session.current;
    const delayed = new Promise<typeof response>((yes) => {
      resolve = yes;
    });
    sync.mockReturnValueOnce(delayed);
    const refresh = session.refresh();
    session.dispose();
    resolve({
      ...response,
      snapshot: {
        ...response.snapshot,
        revision: 1,
        state: { ...initial, ready: { p1: true, p2: false } },
      },
    });
    await refresh;
    expect(session.current).toBe(beforeDisposal);
  });

  test('does not subscribe when disposed during attachment', async () => {
    const room = await createSessionTestRoom();
    const { transport } = room;
    const response = await transport.sync(room.roomId);
    let resolve!: (value: typeof response) => void;
    vi.spyOn(transport, 'sync').mockImplementation(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const subscribe = vi.spyOn(transport, 'subscribe');
    const session = room.session('p1');
    const attaching = session.attach();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    session.dispose();
    resolve(response);
    await attaching;
    expect(subscribe).not.toHaveBeenCalled();
    expect(session.room).toBeNull();
  });

  test('opens two seats, locks a recruited league, and advances one shared slot', async () => {
    let nowMs = Date.parse('2026-11-01T00:00:00.000Z');
    const room = await createSessionTestRoom({ now: () => nowMs, commandPrefix: 'session' });
    const { transport, roomId } = room;

    const host = room.session('p1');
    await host.attach();
    const joined = await transport.join(room.code);
    expect(joined.participantId).toBe('p2');
    const guest = room.session('p2');
    await guest.attach();

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
