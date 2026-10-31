import { afterEach, expect, test, vi } from 'bun:test';
import { idSchema } from '@hoop-rush/data-contracts';
import * as assets from './cap-rush-multiplayer-assets';
import * as transports from './cap-rush-multiplayer-transport';
import { CapRushMultiplayerController } from './cap-rush-multiplayer-controller.svelte';

afterEach(() => {
  vi.restoreAllMocks();
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
