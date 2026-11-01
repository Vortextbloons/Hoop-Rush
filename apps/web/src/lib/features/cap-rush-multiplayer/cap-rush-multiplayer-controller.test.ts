import { afterEach, expect, test, vi } from 'bun:test';
import type { CapRushMultiplayerSessionView } from '@hoop-rush/application/cap-rush-multiplayer';
import { idSchema } from '@hoop-rush/data-contracts';
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

test('does not open a room when disposed while assets load', async () => {
  let resolve!: (data: assets.CapRushMultiplayerData) => void;
  vi.spyOn(assets, 'getCapRushMultiplayerData').mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const transport = vi.spyOn(transports, 'getCapRushMultiplayerTransport');
  const controller = new CapRushMultiplayerController('room-a');
  const loading = controller.load();
  controller.dispose();
  resolve({} as assets.CapRushMultiplayerData);
  await loading;
  expect(transport).not.toHaveBeenCalled();
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
