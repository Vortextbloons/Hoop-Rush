import { afterEach, expect, test, vi } from 'bun:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as runtime from '#lib/supabase-runtime.js';
import { createFakeSupabaseHarness } from '#lib/testing/fake-supabase-client.js';
import { CapRushMultiplayerSupabaseTransport } from './cap-rush-multiplayer-transport';

afterEach(() => {
  vi.restoreAllMocks();
});

async function flush() {
  await import('@supabase/supabase-js');
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

test('shares one room subscription and removes the channel after the last listener leaves', async () => {
  const harness = createFakeSupabaseHarness();
  const client = harness.createClient('https://test.supabase.co', 'test-key') as SupabaseClient;
  vi.spyOn(runtime, 'getMultiplayerClient').mockResolvedValue(client);
  const transport = new CapRushMultiplayerSupabaseTransport();
  const changed = vi.fn();
  const failed = vi.fn();
  const stopFirst = transport.subscribe('room-a', changed, failed);
  const second = vi.fn();
  const stopSecond = transport.subscribe('room-a', second, failed);
  await flush();
  expect(harness.channels).toHaveLength(1);
  const channel = harness.channels[0];
  expect(channel?.postgresHandlers.map((handler) => handler.table)).toEqual([
    'cap_rush_multiplayer_rooms',
    'cap_rush_multiplayer_room_commands',
  ]);
  channel?.triggerPostgresChange();
  expect(changed).toHaveBeenCalled();
  expect(second).toHaveBeenCalled();
  channel?.triggerStatus('CHANNEL_ERROR');
  expect(failed).toHaveBeenCalled();
  stopFirst();
  expect(harness.removedChannels).toHaveLength(0);
  stopSecond();
  await flush();
  expect(harness.removedChannels).toEqual(['cap-rush-multiplayer:room-a']);
});

test('does not create a channel when unsubscribed before the client is ready', async () => {
  const harness = createFakeSupabaseHarness();
  const client = harness.createClient('https://test.supabase.co', 'test-key') as SupabaseClient;
  let resolve!: (value: SupabaseClient) => void;
  vi.spyOn(runtime, 'getMultiplayerClient').mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const transport = new CapRushMultiplayerSupabaseTransport();
  const stop = transport.subscribe('room-b', vi.fn(), vi.fn());
  stop();
  resolve(client);
  await flush();
  expect(harness.channels).toHaveLength(0);
});

test('snapshot reads omit command history', async () => {
  const transport = new CapRushMultiplayerSupabaseTransport();
  const sync = vi
    .spyOn(transport, 'sync')
    .mockResolvedValue({ snapshot: null } as unknown as Awaited<ReturnType<typeof transport.sync>>);
  await transport.snapshot('room-a');
  expect(sync).toHaveBeenCalledWith('room-a', 2147483647);
});
