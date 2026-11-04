import { describe, expect, test, vi } from 'bun:test';
import {
  createCapRushMultiplayerState,
  createEngineContext,
  simulateCapRushMultiplayerSlot,
} from '@hoop-rush/engine';
import type { CapRushMultiplayerTransport } from '@hoop-rush/data-contracts';
import { CapRushMultiplayerSession } from './session.ts';
import { capRushMultiplayerStateDigest } from '@hoop-rush/engine';
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

  test('adopts a prefetched sync without resuming or refetching', async () => {
    const room = await createSessionTestRoom();
    const { transport } = room;
    const initialSync = await transport.sync(room.roomId);
    const resume = vi.spyOn(transport, 'resume');
    const sync = vi.spyOn(transport, 'sync');
    const session = room.session('p1');

    await session.attach({ resume: false, initialSync });

    expect(resume).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
    expect(session.room?.revision).toBe(initialSync.snapshot.revision);
    session.dispose();
  });

  test('skips unchanged snapshots but still observes presence changes', async () => {
    let nowMs = Date.parse('2026-11-01T00:00:00.000Z');
    const room = await createSessionTestRoom({ now: () => nowMs });
    const session = room.session('p1');
    await session.attach();
    let changes = 0;
    session.subscribe(() => {
      changes += 1;
    });

    await session.refresh();
    expect(changes).toBe(0);

    const state = session.current;
    nowMs += 5_000;
    await room.transport.resume(room.roomId);
    await session.refresh();
    expect(changes).toBe(1);
    expect(session.current).toBe(state);
    session.dispose();
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

test('realtime bursts do not keep a pending sync running indefinitely and publish new progress', async () => {
  const room = await createSessionTestRoom();
  let notify!: () => void;
  vi.spyOn(room.transport, 'subscribe').mockImplementation((_roomId, onChange) => {
    notify = onChange;
    return () => {};
  });
  const session = room.session('p1');
  await session.attach();
  const response = await room.transport.sync(room.roomId);
  let resolve!: (value: typeof response) => void;
  const sync = vi.spyOn(room.transport, 'sync').mockImplementation(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  const publish = vi.fn();
  session.subscribe(publish);
  const pending = session.refresh(false);
  for (let i = 0; i < 20; i += 1) notify();
  resolve({
    ...response,
    snapshot: {
      ...response.snapshot,
      revision: response.snapshot.revision + 1,
      state: { ...session.current, ready: { p1: true, p2: false } },
    },
  });
  await pending;
  expect(sync).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenCalled();
  expect(session.current.ready.p1).toBe(true);
  session.dispose();
});

test('resumes from the checkpoint command count instead of downloading history again', async () => {
  const room = await createSessionTestRoom();
  const initial = await room.transport.sync(room.roomId);
  const sync = vi.spyOn(room.transport, 'sync').mockResolvedValue(initial);
  const session = room.session('p1');
  await session.attach({
    resume: false,
    initialSync: {
      ...initial,
      snapshot: { ...initial.snapshot, revision: 7, commandCount: 7 },
      commands: [],
    },
  });
  await session.refresh(false);
  expect(sync).toHaveBeenCalledWith(room.roomId, 6);
  session.dispose();
});

test('syncs multiple offers and cancellation to the other seat', async () => {
  const room = await createSessionTestRoom({ now: () => Date.parse('2026-11-01T00:00:05.000Z') });
  const host = room.session('p1');
  await host.attach();
  await room.transport.join(room.code);
  const guest = room.session('p2');
  await guest.attach();
  try {
    await host.start();
    const players = host.current.recruitment?.market.players
      .filter((entry) => entry.position === 'PG')
      .slice(0, 2);
    if (!players || players.length !== 2) throw new Error('missing players');
    for (const player of players)
      expect((await host.bid(0, player.playerId, player.minimumBidDollars)).accepted).toBe(true);
    await guest.refresh();
    expect(
      guest.current.recruitment?.rounds[0]?.auctions.filter((entry) => entry.leaderSeat === 'p1'),
    ).toHaveLength(2);
    const player = players[0];
    if (!player) throw new Error('missing player');
    expect((await host.cancelBid(0, player.playerId)).accepted).toBe(true);
    await guest.refresh();
    expect(
      guest.current.recruitment?.rounds[0]?.auctions.filter((entry) => entry.leaderSeat === 'p1'),
    ).toHaveLength(1);
    expect(guest.current).toEqual(host.current);
  } finally {
    host.dispose();
    guest.dispose();
  }
});

test('keeps one command ID across an uncertain transport failure', async () => {
  const room = await createSessionTestRoom();
  const session = room.session('p1');
  await session.attach();
  const ids: string[] = [];
  const original = room.transport.submitCommand.bind(room.transport);
  vi.spyOn(room.transport, 'submitCommand')
    .mockImplementationOnce((input) => {
      ids.push(input.commandId);
      return Promise.reject(new Error('connection lost after send'));
    })
    .mockImplementation((input) => {
      ids.push(input.commandId);
      return original(input);
    });
  await expect(session.start()).rejects.toThrow('connection lost');
  await session.start();
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  session.dispose();
});

test('recovers an accepted intent after its response is lost without submitting it twice', async () => {
  const room = await createSessionTestRoom();
  const session = room.session('p1');
  await session.attach();
  const original = room.transport.submitCommand.bind(room.transport);
  const submit = vi.spyOn(room.transport, 'submitCommand').mockImplementationOnce(async (input) => {
    await original(input);
    throw new Error('response lost after commit');
  });
  await expect(session.start()).rejects.toThrow('response lost');
  const receipt = await session.start();
  expect(receipt.accepted).toBe(true);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(session.current.phase).toBe('recruiting');
  session.dispose();
});

test('retries a stale retry-safe command against the refreshed revision with the same ID', async () => {
  const room = await createSessionTestRoom();
  const draft = await room.transport.snapshot(room.roomId);
  let revision = 0;
  let snapshot = {
    ...draft,
    revision,
    commandCount: 0,
    state: sessionState(),
  };
  const ids: string[] = [];
  const revisions: number[] = [];
  const submitCommand = vi.fn((input: { commandId: string; expectedRevision: number }) => {
    ids.push(input.commandId);
    revisions.push(input.expectedRevision);
    if (revisions.length === 1) {
      revision = 1;
      snapshot = { ...snapshot, revision, commandCount: 1 };
      return Promise.resolve({
        roomId: room.roomId,
        commandId: input.commandId as never,
        ordinal: 0,
        accepted: false,
        rejectionCode: 'stale-revision',
        revision,
      });
    }
    revision = 2;
    snapshot = { ...snapshot, revision, commandCount: 1 };
    return Promise.resolve({
      roomId: room.roomId,
      commandId: input.commandId as never,
      ordinal: 0,
      accepted: true,
      rejectionCode: null,
      revision,
    });
  });
  const transport = {
    sync: vi.fn(() =>
      Promise.resolve({
        snapshot,
        commands: [],
        commandCount: snapshot.commandCount,
      }),
    ),
    subscribe: vi.fn(() => () => {}),
    submitCommand,
    acceptedSnapshot: () => snapshot,
  } as unknown as CapRushMultiplayerTransport;
  const session = new CapRushMultiplayerSession({
    transport,
    environment: room.environment,
    roomId: room.roomId,
    seat: 'p1',
    newCommandId: () => 'stable-command',
  });
  await session.attach({ resume: false });
  const receipt = await session.start();
  expect(receipt.accepted).toBe(true);
  expect(ids).toEqual(['stable-command', 'stable-command']);
  expect(revisions).toEqual([0, 1]);
  session.dispose();
});

function sessionState() {
  return {
    ...createCapRushMultiplayerState(null),
    phase: 'lobby' as const,
  };
}

test('uses the verification port and rejects mismatches and disposed results', async () => {
  const room = await createSessionTestRoom();
  let digest = '';
  const verifyLog = vi.fn(() => Promise.resolve(digest));
  const session = new CapRushMultiplayerSession({
    transport: room.transport,
    environment: room.environment,
    roomId: room.roomId,
    seat: 'p1',
    newCommandId: () => 'verify-test',
    verifyLog,
  });
  await session.attach();
  digest = capRushMultiplayerStateDigest(session.current);
  expect(await session.verifyLog()).toBe(true);
  expect(verifyLog).toHaveBeenCalledTimes(1);
  digest = 'mismatch';
  expect(await session.verifyLog()).toBe(false);
  verifyLog.mockImplementation(() => {
    session.dispose();
    return Promise.resolve(capRushMultiplayerStateDigest(session.current));
  });
  expect(await session.verifyLog()).toBe(false);
});
