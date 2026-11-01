import * as contracts from '@hoop-rush/data-contracts';
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

test('reads the server clock and room snapshot concurrently before submitting', async () => {
  let resolveClock!: (value: { data: unknown; error: null }) => void;
  const clock = new Promise<{ data: unknown; error: null }>((yes) => {
    resolveClock = yes;
  });
  const client = {
    rpc: vi.fn((name: string) =>
      name === 'cap_rush_multiplayer_clock'
        ? clock
        : Promise.resolve({ data: null, error: { message: 'unexpected rpc' } }),
    ),
  };
  vi.spyOn(runtime, 'getMultiplayerClient').mockResolvedValue(client as unknown as SupabaseClient);
  const transport = new CapRushMultiplayerSupabaseTransport();
  let resolveSnapshot!: (value: unknown) => void;
  const snapshot = new Promise((yes) => {
    resolveSnapshot = yes;
  });
  const snapshotSpy = vi
    .spyOn(transport, 'snapshot')
    .mockReturnValue(snapshot as unknown as ReturnType<typeof transport.snapshot>);

  const pending = transport.submitCommand({
    roomId: 'room-a',
    commandId: 'cmd-1',
    actorParticipantId: 'p1',
    expectedRevision: 0,
    payload: { kind: 'start' },
  });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(client.rpc).toHaveBeenCalledWith('cap_rush_multiplayer_clock');
  expect(snapshotSpy).toHaveBeenCalledTimes(1);

  resolveClock({ data: '2026-11-01T00:00:00.000Z', error: null });
  resolveSnapshot({
    roomId: 'room-a',
    revision: 0,
    commandCount: 0,
    state: null,
  });
  expect(await pending).toMatchObject({
    accepted: false,
    rejectionCode: 'invalid-phase',
  });
});

test('reconstructs incremental syncs without duplicating games or losing locked inputs', async () => {
  const locked = { rootSeed: 'locked' };
  const recruitment = { roundIndex: 4 };
  const first = { gameId: 'game-1', slot: 1 };
  const second = { gameId: 'game-2', slot: 2 };
  const client = {
    rpc: vi
      .fn()
      .mockResolvedValueOnce({
        error: null,
        data: {
          room: {
            roomId: 'room-a',
            phase: 'season',
            revision: 1,
            commandCount: 1,
            state: { locked, recruitment, season: { games: [first] } },
          },
          commands: [],
        },
      })
      .mockResolvedValueOnce({
        error: null,
        data: {
          incremental: true,
          room: {
            roomId: 'room-a',
            phase: 'season',
            revision: 2,
            commandCount: 2,
            state: { season: { frontierSlot: 2 } },
          },
          commands: [
            {
              command_id: 'cmd-2',
              ordinal: 1,
              actor_participant_id: 'p1',
              accepted_at: '2026-11-01T00:00:00Z',
              payload: { kind: 'accept-slot', slot: 2, games: [first, second] },
            },
          ],
        },
      }),
  };
  vi.spyOn(runtime, 'getMultiplayerClient').mockResolvedValue(client as unknown as SupabaseClient);
  const descriptor = Object.getOwnPropertyDescriptor(
    contracts.capRushMultiplayerRoomSnapshotSchema,
    'parse',
  )!;
  Object.defineProperty(contracts.capRushMultiplayerRoomSnapshotSchema, 'parse', {
    configurable: true,
    value: (value: unknown) => value,
  });
  try {
    const transport = new CapRushMultiplayerSupabaseTransport();
    await transport.sync('room-a');
    const synced = await transport.sync('room-a', 0);
    expect(client.rpc).toHaveBeenLastCalledWith('cap_rush_multiplayer_room_sync', {
      p_room_id: 'room-a',
      p_after_ordinal: -2,
    });
    expect<unknown>(synced.snapshot.state?.locked).toEqual(locked);
    expect<unknown>(synced.snapshot.state?.recruitment).toEqual(recruitment);
    expect<unknown>(synced.snapshot.state?.season?.games).toEqual([first, second]);
    expect(synced.snapshot.state?.season?.frontierSlot).toBe(2);
  } finally {
    if (descriptor)
      Object.defineProperty(contracts.capRushMultiplayerRoomSnapshotSchema, 'parse', descriptor);
    else Reflect.deleteProperty(contracts.capRushMultiplayerRoomSnapshotSchema, 'parse');
  }
});
