import { describe, expect, it, vi } from 'vitest';
import {
  DRAFT_DUEL_AUTOPICK_VERSION,
  commandIdSchema,
  defaultDraftDuelVersionLocks,
  draftDuelTransientEventSchema,
  draftDuelVerificationReceiptSchema,
  idSchema,
  type DraftDuelMultiplayerTransport,
} from '@hoop-rush/data-contracts';
import {
  createFakeSupabaseHarness,
  type FakeSupabaseHarness,
} from '$lib/testing/fake-supabase-client';
import { createDraftDuelTransport } from './draft-duel-transport';

const mockState = vi.hoisted(() => {
  const state = { harness: null as FakeSupabaseHarness | null };
  (globalThis as { __hoopRushFakeSupabase?: typeof state }).__hoopRushFakeSupabase = state;
  return state;
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, options?: unknown) => {
    const state = (
      globalThis as { __hoopRushFakeSupabase?: { harness: FakeSupabaseHarness | null } }
    ).__hoopRushFakeSupabase;
    if (!state?.harness) throw new Error('fake supabase harness not installed');
    return state.harness.createClient(url, key, options);
  },
  REALTIME_SUBSCRIBE_STATES: {
    SUBSCRIBED: 'SUBSCRIBED',
    TIMED_OUT: 'TIMED_OUT',
    CLOSED: 'CLOSED',
    CHANNEL_ERROR: 'CHANNEL_ERROR',
  },
}));

const ROOM_ID = 'dd-room-1';
const roomId = idSchema.parse(ROOM_ID);
const ROOM_COLUMNS =
  'id, code, code_active, fairness, presentation, versions, phase, revision, command_count, result_digest, confirmed_digest, successor_room_id, root_seed, deadline_at, deadline_cursor, deadline_participant, deadline_fallback, deadline_pick_ordinal, series, broadcast, expires_at, created_at';
const versions = defaultDraftDuelVersionLocks({
  dataVersion: 'data-v1',
  catalogHash: 'e'.repeat(64),
});

let transportCounter = 0;

function setupTransport(): {
  harness: FakeSupabaseHarness;
  transport: DraftDuelMultiplayerTransport;
} {
  transportCounter += 1;
  const harness = createFakeSupabaseHarness();
  mockState.harness = harness;
  const transport = createDraftDuelTransport({
    url: `https://draft-duel-conformance-${String(transportCounter)}.supabase.co`,
    publishableKey: `sb_publishable_draft_duel_conformance_${String(transportCounter)}`,
    storageKey: `draft-duel-conformance-${String(transportCounter)}`,
  });
  return { harness, transport };
}

function roomRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ROOM_ID,
    code: '4321',
    code_active: true,
    fairness: 'fair',
    presentation: 'ratings',
    versions,
    phase: 'lobby',
    revision: 2,
    command_count: 1,
    result_digest: null,
    confirmed_digest: null,
    successor_room_id: null,
    root_seed: 'a'.repeat(32),
    deadline_at: null,
    deadline_cursor: null,
    deadline_participant: null,
    deadline_fallback: null,
    deadline_pick_ordinal: null,
    series: null,
    broadcast: null,
    expires_at: '2026-10-12T12:00:00.000Z',
    created_at: '2026-10-12T11:00:00.000Z',
    ...overrides,
  };
}

function memberRow(participantId: string, overrides: Record<string, unknown> = {}) {
  return {
    room_id: ROOM_ID,
    participant_id: participantId,
    online: true,
    ready: false,
    next_game_ready: 0,
    locked: false,
    last_seen_at: null,
    ...overrides,
  };
}

function seedRoom(harness: FakeSupabaseHarness, overrides: Record<string, unknown> = {}): void {
  harness.setRows('draft_duel_rooms', [roomRow(overrides)]);
  harness.setRows('draft_duel_room_members', [memberRow('p1'), memberRow('p2')]);
}

describe('draft-duel supabase transport protocol pins', () => {
  it('create sends the deployed RPC shape and maps the room snapshot', async () => {
    const { harness, transport } = setupTransport();
    harness.setRpc('draft_duel_room_create', () => ({ room_id: ROOM_ID, code: '4321' }));
    seedRoom(harness);

    const created = await transport.create({
      fairness: 'fair',
      presentation: 'ratings',
      versions,
    });

    expect(harness.rpcCalls).toEqual([
      {
        name: 'draft_duel_room_create',
        args: { p_fairness: 'fair', p_presentation: 'ratings', p_versions: versions },
      },
    ]);
    expect(harness.selectQueries[0]).toMatchObject({
      table: 'draft_duel_rooms',
      columns: ROOM_COLUMNS,
      filters: [{ op: 'eq', column: 'id', value: ROOM_ID }],
      single: true,
    });
    expect(harness.selectQueries[1]).toMatchObject({
      table: 'draft_duel_room_members',
      columns: 'participant_id, online, ready, next_game_ready, locked, last_seen_at',
      filters: [{ op: 'eq', column: 'room_id', value: ROOM_ID }],
      single: false,
    });
    expect(created.code).toBe('4321');
    expect(created.membership).toEqual({ roomId: ROOM_ID, participantId: 'p1', code: '4321' });
    expect(created.snapshot.settings.timerPolicyVersion).toBe(DRAFT_DUEL_AUTOPICK_VERSION);
    expect(created.snapshot.members.map((member) => member.participantId)).toEqual(['p1', 'p2']);
    expect(created.snapshot.series).toBeNull();
  });

  it('preview and join keep their RPC names and args', async () => {
    const { harness, transport } = setupTransport();
    harness.setRpc('draft_duel_room_preview', () => ({
      room_id: ROOM_ID,
      code: '4321',
      fairness: 'fair',
      presentation: 'ratings',
      versions,
      phase: 'lobby',
      revision: 1,
      expires_at: '2026-10-12T12:00:00.000Z',
      created_at: '2026-10-12T11:00:00.000Z',
    }));
    harness.setRpc('draft_duel_room_join', () => ({
      room_id: ROOM_ID,
      code: '4321',
      participant_id: 'p2',
    }));
    seedRoom(harness);

    const preview = await transport.preview('4321');
    expect(preview.code).toBe('4321');
    const joined = await transport.join('4321');
    expect(joined.membership.participantId).toBe('p2');

    expect(harness.rpcCalls.map((call) => [call.name, call.args])).toEqual([
      ['draft_duel_room_preview', { p_code: '4321' }],
      ['draft_duel_room_join', { p_code: '4321' }],
    ]);
    await expect(transport.preview('99x9')).rejects.toThrow(/invalid-code:/);
  });

  it('submitCommand pins p_expected_revision without p_actor and maps camelCase rejections', async () => {
    const { harness, transport } = setupTransport();
    harness.setRpc('draft_duel_command_submit', () => ({
      accepted: true,
      ordinal: 4,
      revision: 5,
      commandId: 'cmd-9',
    }));

    const accepted = await transport.submitCommand({
      schemaVersion: 1,
      roomId,
      commandId: commandIdSchema.parse('cmd-9'),
      actorParticipantId: 'p1',
      payload: { kind: 'ready', ready: true },
      expectedRevision: 4,
    });

    expect(harness.rpcCalls[0]).toEqual({
      name: 'draft_duel_command_submit',
      args: {
        p_room_id: ROOM_ID,
        p_command_id: 'cmd-9',
        p_expected_revision: 4,
        p_payload: { kind: 'ready', ready: true },
      },
    });
    expect(accepted).toEqual({
      roomId: ROOM_ID,
      commandId: 'cmd-9',
      ordinal: 4,
      accepted: true,
      rejectionCode: null,
      revision: 5,
    });

    harness.setRpc('draft_duel_command_submit', () => ({
      accepted: false,
      rejectionCode: 'stale-revision',
      revision: 6,
    }));
    const rejected = await transport.submitCommand({
      schemaVersion: 1,
      roomId,
      commandId: commandIdSchema.parse('cmd-10'),
      actorParticipantId: 'p2',
      payload: { kind: 'ready', ready: false },
    });
    expect(rejected.rejectionCode).toBe('stale-revision');
    expect(rejected.revision).toBe(6);
  });

  it('refetch reads the ordered command tail', async () => {
    const { harness, transport } = setupTransport();
    harness.setRows('draft_duel_room_commands', [
      {
        room_id: ROOM_ID,
        command_id: 'cmd-1',
        ordinal: 0,
        actor_participant_id: 'p1',
        payload: { kind: 'ready', ready: true },
      },
    ]);
    const commands = await transport.refetch(ROOM_ID, -1);
    expect(harness.selectQueries[0]).toMatchObject({
      table: 'draft_duel_room_commands',
      columns: 'command_id, ordinal, actor_participant_id, payload',
      filters: [
        { op: 'eq', column: 'room_id', value: ROOM_ID },
        { op: 'gt', column: 'ordinal', value: -1 },
      ],
      order: { column: 'ordinal', ascending: true },
    });
    expect(commands.map((command) => command.commandId)).toEqual(['cmd-1']);
  });

  it('subscribe opens one realtime channel and tears it down with the last handler', async () => {
    const { harness, transport } = setupTransport();
    seedRoom(harness);
    const snapshots: unknown[] = [];
    const subscription = transport.subscribe(ROOM_ID, (snapshot) => {
      snapshots.push(snapshot);
    });

    await vi.waitFor(() => {
      expect(harness.channels).toHaveLength(1);
    });
    const channel = harness.channels[0];
    expect(channel?.topic).toBe(`draft-duel-room-${ROOM_ID}`);
    expect(channel?.postgresHandlers.map((handler) => handler.table)).toEqual([
      'draft_duel_rooms',
      'draft_duel_room_commands',
    ]);

    channel?.triggerPostgresChange();
    await vi.waitFor(() => {
      expect(snapshots.length).toBeGreaterThan(0);
    });

    subscription.unsubscribe();
    await vi.waitFor(() => {
      expect(channel?.unsubscribed).toBe(true);
      expect(harness.removedChannels).toContain(`draft-duel-room-${ROOM_ID}`);
    });
  });

  it('transient broadcasts use the private draft-duel topic and event name', async () => {
    const { harness, transport } = setupTransport();
    const events: unknown[] = [];
    const subscription = transport.subscribeTransient(ROOM_ID, (event) => {
      events.push(event);
    });
    await vi.waitFor(() => {
      expect(harness.channels).toHaveLength(1);
    });
    const channel = harness.channels[0];
    expect(channel?.topic).toBe(`draft-duel:${ROOM_ID}`);
    expect(channel?.options).toEqual({ config: { private: true, broadcast: { self: false } } });
    expect(channel?.broadcastHandlers.map((handler) => handler.event)).toEqual(['transient']);

    const event = draftDuelTransientEventSchema.parse({
      kind: 'reaction',
      roomId: ROOM_ID,
      participantId: 'p1',
      pickOrdinal: 2,
      reaction: 'hype',
      sentAtMs: 1_700_000_000_000,
    });
    const published = await transport.publishTransient(ROOM_ID, event);
    expect(published).toBe(true);
    expect(harness.broadcastSends).toEqual([
      {
        topic: `draft-duel:${ROOM_ID}`,
        message: { type: 'broadcast', event: 'transient', payload: event },
      },
    ]);

    channel?.triggerBroadcast(event);
    expect(events).toEqual([event]);

    subscription.unsubscribe();
    await vi.waitFor(() => {
      expect(channel?.unsubscribed).toBe(true);
    });
  });

  it('verification, fallback, timeout, and guest removal keep their RPC shapes', async () => {
    const { harness, transport } = setupTransport();
    harness.setRpc('draft_duel_verification_challenge', () => ({ challenge: 'challenge-1' }));
    harness.setRpc('draft_duel_verification_submit', () => ({
      accepted: true,
      receiptId: 'receipt-1',
      revision: 4,
    }));
    harness.setRpc('draft_duel_commit_fallback', () => ({ stored: true, revision: 2 }));
    harness.setRpc('draft_duel_timeout_resolve', () => ({
      accepted: true,
      commandId: 'timeout-cmd',
      ordinal: 7,
      revision: 3,
    }));
    harness.setRpc('draft_duel_command_submit', () => ({
      accepted: true,
      ordinal: 8,
      revision: 4,
    }));
    seedRoom(harness);

    const challenge = await transport.verificationChallenge(ROOM_ID);
    expect(challenge).toBe('challenge-1');

    const receipt = draftDuelVerificationReceiptSchema.parse({
      schemaVersion: 1,
      roomId: ROOM_ID,
      rootSeed: 'b'.repeat(32),
      versions,
      challenge,
      participantIds: ['p1', 'p2'],
      commandIds: [],
      gameSeeds: [],
      resultDigest: 'c'.repeat(64),
      receiptDigest: 'd'.repeat(64),
    });
    const submitted = await transport.submitVerification(ROOM_ID, receipt, 3);
    expect(submitted).toEqual({ receiptId: 'receipt-1', revision: 4 });

    const fallback = await transport.commitFallback(
      ROOM_ID,
      'cursor-1',
      { kind: 'ready', ready: true },
      2,
    );
    expect(fallback).toEqual({ stored: true, revision: 2 });

    const timeout = await transport.resolveTimeout(ROOM_ID);
    expect(timeout).toEqual({
      roomId: ROOM_ID,
      commandId: 'timeout-cmd',
      ordinal: 7,
      accepted: true,
      rejectionCode: null,
      revision: 3,
    });

    const snapshot = await transport.removeGuest(ROOM_ID, 'p2');
    expect(snapshot.roomId).toBe(ROOM_ID);

    expect(harness.rpcCalls.slice(0, 4).map((call) => [call.name, call.args])).toEqual([
      ['draft_duel_verification_challenge', { p_room_id: ROOM_ID }],
      [
        'draft_duel_verification_submit',
        {
          p_room_id: ROOM_ID,
          p_receipt_id: receipt.receiptDigest,
          p_receipt: receipt,
          p_expected_revision: 3,
        },
      ],
      [
        'draft_duel_commit_fallback',
        {
          p_room_id: ROOM_ID,
          p_cursor: 'cursor-1',
          p_payload: { kind: 'ready', ready: true },
          p_expected_revision: 2,
        },
      ],
      ['draft_duel_timeout_resolve', { p_room_id: ROOM_ID }],
    ]);
    const removeGuest = harness.rpcCalls[4];
    expect(removeGuest?.name).toBe('draft_duel_command_submit');
    expect(removeGuest?.args).toMatchObject({
      p_room_id: ROOM_ID,
      p_expected_revision: null,
      p_payload: { kind: 'remove-guest', targetParticipantId: 'p2' },
    });
    expect(typeof removeGuest?.args['p_command_id']).toBe('string');
  });

  it('rematch, complete, and fail keep their RPC names and args', async () => {
    const { harness, transport } = setupTransport();
    harness.setRpc('draft_duel_rematch', () => ({ room_id: ROOM_ID, code: '8765' }));
    harness.setRpc('draft_duel_complete', () => ({ completed: true, phase: 'championship' }));
    harness.setRpc('draft_duel_fail', () => ({ failed: true, phase: 'integrity-failed' }));
    harness.setRpc('draft_duel_leave', () => true);
    seedRoom(harness);

    const rematch = await transport.rematch(ROOM_ID);
    expect(rematch.code).toBe('8765');
    const completed = await transport.complete(ROOM_ID, 'receipt-1');
    expect(completed).toEqual({ completed: true, phase: 'championship' });
    const failed = await transport.fail(ROOM_ID);
    expect(failed).toEqual({ failed: true, phase: 'integrity-failed' });
    await transport.leave(ROOM_ID, 'p1');

    expect(harness.rpcCalls.map((call) => [call.name, call.args])).toEqual([
      ['draft_duel_rematch', { p_room_id: ROOM_ID }],
      ['draft_duel_complete', { p_room_id: ROOM_ID, p_receipt_id: 'receipt-1' }],
      ['draft_duel_fail', { p_room_id: ROOM_ID }],
      ['draft_duel_leave', { p_room_id: ROOM_ID }],
    ]);
  });
});
