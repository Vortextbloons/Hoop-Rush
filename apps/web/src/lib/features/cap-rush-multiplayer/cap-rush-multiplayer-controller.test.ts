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
    connected: true,
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
  let resolveResume!: (value: typeof membership) => void;
  const membership = {
    roomId: idSchema.parse('room-a'),
    participantId: 'p1' as const,
    code: '1234',
  };
  const transport = {
    resume: vi.fn(
      () =>
        new Promise<typeof membership>((yes) => {
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

test('does not create a session when disposed while membership loads', async () => {
  vi.spyOn(assets, 'getCapRushMultiplayerData').mockResolvedValue(
    {} as assets.CapRushMultiplayerData,
  );
  const transport = new transports.CapRushMultiplayerSupabaseTransport();
  vi.spyOn(transports, 'getCapRushMultiplayerTransport').mockReturnValue(transport);
  let resolve!: (membership: Awaited<ReturnType<typeof transport.resume>>) => void;
  const resume = vi.spyOn(transport, 'resume').mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const sync = vi.spyOn(transport, 'sync');
  const controller = new CapRushMultiplayerController('room-a');
  const loading = controller.load();
  await Promise.resolve();
  expect(resume).toHaveBeenCalledTimes(1);
  controller.dispose();
  resolve({ roomId: idSchema.parse('room-a'), participantId: 'p1', code: '1234' });
  await loading;
  expect(sync).not.toHaveBeenCalled();
  expect(resume).toHaveBeenCalledTimes(1);
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

test('pauses bulk simulation for the pending head-to-head', async () => {
  const controller = new CapRushMultiplayerController('room-a');
  const view = sessionView(null);
  Object.assign(view.state, { phase: 'season', season: { block: { status: 'running' } } });
  Object.assign(controller, {
    view,
    session: {
      refresh: () => Promise.resolve(),
      pendingH2H: () => ({ gameId: 'h2h-1', missing: ['p1', 'p2'] }),
    },
  });
  const watch = vi.spyOn(controller, 'watchHeadToHead').mockResolvedValue();
  const simulate = vi.spyOn(controller, 'simulateNextSlot').mockResolvedValue();
  await (controller as unknown as { tick(): Promise<void> }).tick();
  expect(watch).toHaveBeenCalledWith('h2h-1');
  expect(simulate).not.toHaveBeenCalled();
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
