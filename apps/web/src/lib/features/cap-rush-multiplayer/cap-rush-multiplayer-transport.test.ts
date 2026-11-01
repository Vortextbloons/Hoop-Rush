import * as persistence from '#lib/persistence.js';
import * as assets from './cap-rush-multiplayer-assets.js';
import { CapRushMultiplayerRunner } from './cap-rush-multiplayer-runner.js';
import { createSessionTestRoom } from '../../../../../../packages/application/src/cap-rush-multiplayer/session-test-fixtures.ts';
import { applyCapRushMultiplayerCommand, capRushMultiplayerStateDigest } from '@hoop-rush/engine';
import type {
  CapRushMultiplayerCommand,
  CapRushMultiplayerState,
  CapRushMultiplayerRoomSnapshot,
} from '@hoop-rush/data-contracts';
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

test('projects compact commands, persists locally, resumes without replay, and rejects mismatches', async () => {
  const room = await createSessionTestRoom();
  const original = await room.transport.snapshot(room.roomId);
  let state = original.state!;
  const command: CapRushMultiplayerCommand = {
    schemaVersion: 1,
    roomId: original.roomId,
    commandId: 'ready-command' as CapRushMultiplayerCommand['commandId'],
    ordinal: 0,
    expectedRevision: 0,
    actorParticipantId: 'p1',
    acceptedAtIso: '2026-11-01T00:00:00Z',
    payload: { kind: 'ready', ready: true },
  };
  const applied = applyCapRushMultiplayerCommand(state, command, room.environment);
  if (!applied.ok) throw new Error(applied.message);
  state = applied.state;
  let saved: { snapshot: CapRushMultiplayerRoomSnapshot } | null = null;
  const save = vi.fn(async (input: { snapshot: CapRushMultiplayerRoomSnapshot }) => {
    saved = input;
  });
  vi.spyOn(persistence, 'getPersistence').mockReturnValue({
    capRushMultiplayerRepository: { loadActive: async () => saved, saveCheckpoint: save },
  } as unknown as ReturnType<typeof persistence.getPersistence>);
  vi.spyOn(assets, 'getCapRushMultiplayerData').mockResolvedValue({
    environment: room.environment,
    versionLocks: room.environment.versionLocks,
  } as Awaited<ReturnType<typeof assets.getCapRushMultiplayerData>>);
  const project = vi
    .spyOn(CapRushMultiplayerRunner.prototype, 'project')
    .mockImplementation(async (input) => {
      let projected = input.state;
      for (const entry of input.commands) {
        const result = applyCapRushMultiplayerCommand(
          projected,
          entry,
          input.environment,
          input.variant,
        );
        if (!result.ok) throw new Error(result.message);
        projected = result.state;
      }
      return projected;
    });
  let digest = capRushMultiplayerStateDigest(state);
  const rpc = vi.fn(async (_name: string, args: { p_after_ordinal: number }) => ({
    error: null,
    data: {
      room: {
        ...original,
        revision: 1,
        commandCount: 1,
        state: { _localSimulation: true, phase: state.phase, ready: state.ready },
        stateDigest: digest,
      },
      commands:
        args.p_after_ordinal < 0
          ? [
              {
                command_id: command.commandId,
                ordinal: 0,
                actor_participant_id: 'p1',
                accepted_at: command.acceptedAtIso,
                payload: command.payload,
              },
            ]
          : [],
    },
  }));
  vi.spyOn(runtime, 'getMultiplayerClient').mockResolvedValue({ rpc } as unknown as SupabaseClient);
  const transport = new CapRushMultiplayerSupabaseTransport();
  const first = await transport.sync(room.roomId, 2147483647);
  expect(first.snapshot.state).toEqual(state);
  expect(save).toHaveBeenCalledTimes(1);
  expect(project).toHaveBeenCalledTimes(1);
  const reconnected = new CapRushMultiplayerSupabaseTransport();
  const resumed = await reconnected.sync(room.roomId, 2147483647);
  expect(resumed.snapshot.state).toEqual(state);
  expect(project).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenLastCalledWith('cap_rush_multiplayer_room_sync', {
    p_room_id: room.roomId,
    p_after_ordinal: 0,
  });
  digest = 'invalid-digest';
  await expect(reconnected.sync(room.roomId, 0)).rejects.toThrow('simulation mismatch');
});
