import { afterEach, expect, test, vi } from 'bun:test';
import type { CapRushMultiplayerSessionView } from '@hoop-rush/application/cap-rush-multiplayer';
import { idSchema, type CapRushMultiplayerRoomMembership } from '@hoop-rush/data-contracts';
import * as assets from './cap-rush-multiplayer-assets';
import * as transports from './cap-rush-multiplayer-transport';
import { CapRushMultiplayerController } from './cap-rush-multiplayer-controller.svelte';

afterEach(() => {
  vi.restoreAllMocks();
});

function sessionView(error: string | null): CapRushMultiplayerSessionView {
  return {
    roomId: 'room-a',
    seat: 'p1',
    snapshot: null,
    state: { phase: 'recruiting', recruitment: null },
    locked: null,
    postseason: null,
    error,
    connection: 'connected',
    transportError: null,
    bothOnline: true,
    opponentOnline: true,
    localOnline: true,
  } as unknown as CapRushMultiplayerSessionView;
}

test('forwards the bid target and total captured at submission', async () => {
  const controller = new CapRushMultiplayerController('room-a');
  const bid = vi.fn(() => Promise.resolve({ accepted: true, rejectionCode: null }));
  const view = sessionView(null);
  Object.assign(controller, {
    session: { bid, view: () => view },
    view,
  });

  const accepted = await controller.placeBid({
    round: 1,
    playerId: 'p-captured',
    totalDollars: 13_123_456,
  });

  expect(accepted).toBe(true);
  expect(bid).toHaveBeenCalledWith(1, 'p-captured', 13_123_456);
  expect(controller.bidAttempt).toBeNull();
});

test('keeps a rejected bid local to the attempted total', async () => {
  const controller = new CapRushMultiplayerController('room-a');
  const bid = vi.fn(() => Promise.resolve({ accepted: false, rejectionCode: 'bid-too-low' }));
  const view = sessionView('bid-too-low');
  Object.assign(controller, {
    session: { bid, view: () => view },
    view,
  });

  const accepted = await controller.placeBid({
    round: 2,
    playerId: 'p-stale',
    totalDollars: 9_000_000,
  });

  expect(accepted).toBe(false);
  expect(controller.bidAttempt).toEqual({
    round: 2,
    playerId: 'p-stale',
    totalDollars: 9_000_000,
    state: 'rejected',
    code: 'bid-too-low',
  });
  expect(controller.error).toBeNull();
});

test('overlaps asset loading with presence resume and stops before syncing when disposed', async () => {
  let resolveData!: (data: assets.CapRushMultiplayerData) => void;
  vi.spyOn(assets, 'getCapRushMultiplayerData').mockReturnValue(
    new Promise((yes) => {
      resolveData = yes;
    }),
  );
  let resolveResume!: (value: CapRushMultiplayerRoomMembership) => void;
  const membership: CapRushMultiplayerRoomMembership = {
    roomId: idSchema.parse('room-a'),
    participantId: 'p1',
    code: '1234',
  };
  const transport = {
    resume: vi.fn(
      () =>
        new Promise<CapRushMultiplayerRoomMembership>((yes) => {
          resolveResume = yes;
        }),
    ),
    sync: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  };
  vi.spyOn(transports, 'getCapRushMultiplayerTransport').mockReturnValue(
    transport as unknown as transports.CapRushMultiplayerSupabaseTransport,
  );
  const controller = new CapRushMultiplayerController('room-a');
  const loading = controller.load();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(transport.resume).toHaveBeenCalledTimes(1);
  controller.dispose();
  resolveResume(membership);
  resolveData({} as assets.CapRushMultiplayerData);
  await loading;
  expect(transport.sync).not.toHaveBeenCalled();
  expect(controller.view).toBeNull();
});

test('automatically chooses bulk simulation for the season', async () => {
  const controller = new CapRushMultiplayerController('room-a');
  const view = sessionView(null);
  Object.assign(view.state, {
    phase: 'season',
    season: { block: { index: 0, status: 'choosing', plans: { p1: null } } },
  });
  const chooseBlockPlan = vi.fn(() => Promise.resolve());
  Object.assign(controller, { view, session: { chooseBlockPlan, view: () => view } });
  await (controller as unknown as { tick(): Promise<void> }).tick();
  expect(chooseBlockPlan).toHaveBeenCalledWith(0, 'sim');
});

test('waits for the confirmed head-to-head instead of opening it automatically', async () => {
  const controller = new CapRushMultiplayerController('room-a');
  const view = sessionView(null);
  Object.assign(view.state, {
    phase: 'season',
    season: {
      block: { status: 'running' },
      games: [{ slot: 5 }],
      slotAcks: { p1: 4, p2: 4 },
    },
  });
  Object.assign(controller, {
    view,
    session: {
      refresh: () => Promise.resolve(),
      pendingH2H: () => ({ gameId: 'h2h-1', missing: ['p1', 'p2'] }),
    },
  });
  const watch = vi.spyOn(controller, 'watchHeadToHead').mockResolvedValue();
  const ack = vi.spyOn(controller, 'ackSlot').mockResolvedValue();
  const simulate = vi.spyOn(controller, 'simulateNextSlot').mockResolvedValue();
  await (controller as unknown as { tick(): Promise<void> }).tick();
  expect(watch).not.toHaveBeenCalled();
  expect(ack).not.toHaveBeenCalled();
  expect(simulate).not.toHaveBeenCalled();
});

test('confirms the head-to-head broadcast without acknowledging its slot', async () => {
  const controller = new CapRushMultiplayerController('room-a');
  const view = sessionView(null);
  const ackBroadcast = vi.fn(() => Promise.resolve({ accepted: true, rejectionCode: null }));
  const ackSlot = vi.fn(() => Promise.resolve({ accepted: true, rejectionCode: null }));
  Object.assign(controller, {
    view,
    session: { ackBroadcast, ackSlot, view: () => view },
    broadcast: {
      gameId: 'game-1',
      speed: 2,
      kind: 'h2h',
      slot: 5,
      input: {},
      result: {},
      tape: { events: [{}], scoring: [{}] },
    },
  });

  await controller.completeBroadcast();

  expect(ackBroadcast).toHaveBeenCalledWith({
    gameId: 'game-1',
    cursor: 2,
    total: 2,
    resolved: true,
  });
  expect(ackSlot).not.toHaveBeenCalled();
  expect(controller.broadcast).toBeNull();
});

test('acknowledges the accepted high-water slot once instead of issuing per-slot commands', async () => {
  const controller = new CapRushMultiplayerController('room-a');
  const view = sessionView(null);
  Object.assign(view.state, {
    phase: 'season',
    season: {
      block: { index: 0, status: 'running', plans: { p1: 'sim', p2: 'sim' } },
      games: [{ slot: 1 }, { slot: 2 }, { slot: 3 }],
      slotAcks: { p1: 0, p2: 0 },
      h2hSlots: [],
    },
  });
  const ackSlot = vi.fn(() => Promise.resolve({ accepted: true, rejectionCode: null }));
  Object.assign(controller, {
    view,
    session: {
      ackSlot,
      pendingH2H: () => null,
      nextSlot: () => null,
      refresh: () => Promise.resolve(),
      view: () => view,
      dispose: vi.fn(),
    },
  });
  await (controller as unknown as { tick(): Promise<void> }).tick();
  expect(ackSlot).toHaveBeenCalledWith(3);
  controller.dispose();
});

test('continues the season immediately after a successful step instead of waiting for the poll', async () => {
  const controller = new CapRushMultiplayerController('room-a');
  const view = sessionView(null);
  const season = {
    block: { index: 0, status: 'choosing', plans: { p1: null, p2: null } },
    games: [],
    slotAcks: { p1: 0, p2: 0 },
    h2hSlots: [],
  };
  Object.assign(view.state, { phase: 'season', season });
  let revision = 0;
  const chooseBlockPlan = vi.fn(() => {
    season.block.status = 'running';
    revision += 1;
    return Promise.resolve();
  });
  Object.assign(controller, {
    view,
    session: {
      room: {
        get revision() {
          return revision;
        },
      },
      chooseBlockPlan,
      pendingH2H: () => null,
      nextSlot: () => (revision < 2 ? 1 : null),
      refresh: () => Promise.resolve(),
      dispose: vi.fn(),
      view: () => view,
    },
  });
  const simulate = vi.spyOn(controller, 'simulateNextSlot').mockImplementation(() => {
    revision += 1;
    return Promise.resolve();
  });

  await (controller as unknown as { tick(): Promise<void> }).tick();
  expect(chooseBlockPlan).toHaveBeenCalledWith(0, 'sim');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(simulate).toHaveBeenCalledTimes(1);
  controller.dispose();
});

test('automatically runs the playoff series only when both seats choose sim', async () => {
  for (const plans of [
    { p1: 'sim', p2: 'sim' },
    { p1: 'sim', p2: null },
    { p1: 'sim', p2: 'simcast' },
  ] as const) {
    const controller = new CapRushMultiplayerController('room-a');
    const view = sessionView(null);
    Object.assign(view.state, { phase: 'postseason', postseason: { championTeamId: null, plans } });
    Object.assign(controller, { view, session: { refresh: () => Promise.resolve() } });
    const simulate = vi.spyOn(controller, 'simulatePlayoffStep').mockResolvedValue();
    await (controller as unknown as { tick(): Promise<void> }).tick();
    expect(simulate).toHaveBeenCalledTimes(plans.p2 === 'sim' ? 1 : 0);
  }
});

test('requires both players to watch every Finals game regardless of opponent', async () => {
  for (const opponent of ['b', 'cpu'] as const) {
    for (const acknowledged of [false, true]) {
      const controller = new CapRushMultiplayerController('room-a');
      const view = sessionView(null);
      Object.assign(view.state, {
        phase: 'postseason',
        locked: {
          seats: {
            p1: { franchise: { franchiseId: 'a' } },
            p2: { franchise: { franchiseId: 'b' } },
          },
        },
        postseason: {
          championTeamId: null,
          plans: { p1: 'simcast', p2: 'simcast' },
          series: [
            { round: 4, highTeamId: 'a', lowTeamId: opponent, games: [{ gameId: 'finals-1' }] },
          ],
        },
        season: {
          playbackAcks: acknowledged
            ? [{ gameId: 'finals-1', seat: 'p1', resolved: true, cursor: 10, total: 10 }]
            : [],
        },
      });
      const refresh = vi.fn(() => Promise.resolve());
      Object.assign(controller, { view, session: { refresh, dispose: vi.fn() } });
      const load = vi.fn(() => Promise.resolve());
      Object.assign(controller, { loadTape: load });
      const simulate = vi.spyOn(controller, 'simulatePlayoffStep').mockResolvedValue();
      await (controller as unknown as { tick(): Promise<void> }).tick();
      expect(load).not.toHaveBeenCalled();
      if (!acknowledged) {
        await controller.watchPlayoffGame();
        expect(load).toHaveBeenCalledTimes(1);
      }
      expect(simulate).not.toHaveBeenCalled();
      if (acknowledged) expect(refresh).toHaveBeenCalled();
      controller.dispose();
    }
  }
});
