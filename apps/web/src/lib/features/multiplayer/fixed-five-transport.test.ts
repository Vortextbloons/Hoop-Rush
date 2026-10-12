import { describe, expect, it, vi } from 'vitest';
import {
  commandIdSchema,
  defaultFixedFiveVersionLocks,
  fixedFiveVerificationReceiptSchema,
  idSchema,
  type FixedFiveMultiplayerTransport,
} from '@hoop-rush/data-contracts';
import { createFakeSupabaseHarness, type FakeSupabaseHarness } from '$lib/fake-supabase-client';
import { createFixedFiveTransport } from './fixed-five-transport';

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

const ROOM_ID = 'room-1';
const roomId = idSchema.parse(ROOM_ID);
const ROOM_COLUMNS =
  'id, code, code_active, mode, source_mode, variant, versions, phase, revision, command_count, digest, result_digest, confirmed_digest, successor_room_id, root_seed, deadline_at, deadline_cursor, deadline_participant, deadline_fallback, deadline_pick_ordinal, expires_at, created_at';
const versions = defaultFixedFiveVersionLocks({ dataVersion: 'data-v1' });

let transportCounter = 0;

function setupTransport(): {
  harness: FakeSupabaseHarness;
  transport: FixedFiveMultiplayerTransport;
} {
  transportCounter += 1;
  const harness = createFakeSupabaseHarness();
  mockState.harness = harness;
  const transport = createFixedFiveTransport({
    url: `https://fixed-five-conformance-${String(transportCounter)}.supabase.co`,
    publishableKey: `sb_publishable_fixed_five_conformance_${String(transportCounter)}`,
    storageKey: `fixed-five-conformance-${String(transportCounter)}`,
  });
  return { harness, transport };
}

function roomRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ROOM_ID,
    code: '1234',
    code_active: true,
    mode: 'classic-shared-82',
    source_mode: 'classic',
    variant: 'ratings',
    versions,
    phase: 'lobby',
    revision: 3,
    command_count: 2,
    digest: null,
    result_digest: null,
    confirmed_digest: null,
    successor_room_id: null,
    root_seed: 'a'.repeat(32),
    deadline_at: null,
    deadline_cursor: null,
    deadline_participant: null,
    deadline_fallback: null,
    deadline_pick_ordinal: null,
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
    picks_committed: 0,
    locked: false,
    last_seen_at: null,
    ...overrides,
  };
}

function seedRoom(harness: FakeSupabaseHarness, overrides: Record<string, unknown> = {}): void {
  harness.setRows('fixed_five_rooms', [roomRow(overrides)]);
  harness.setRows('fixed_five_room_members', [memberRow('p1'), memberRow('p2')]);
}

describe('fixed-five supabase transport protocol pins', () => {
  it('create sends the deployed RPC shape and maps the room snapshot', async () => {
    const { harness, transport } = setupTransport();
    harness.setRpc('fixed_five_room_create', () => ({ room_id: ROOM_ID, code: '1234' }));
    seedRoom(harness);

    const created = await transport.create({
      mode: 'classic-shared-82',
      sourceMode: 'classic',
      variant: 'ratings',
      versions,
    });

    expect(harness.rpcCalls).toEqual([
      {
        name: 'fixed_five_room_create',
        args: {
          p_mode: 'classic-shared-82',
          p_source_mode: 'classic',
          p_variant: 'ratings',
          p_versions: versions,
        },
      },
    ]);
    expect(harness.selectQueries[0]).toMatchObject({
      table: 'fixed_five_rooms',
      columns: ROOM_COLUMNS,
      filters: [{ op: 'eq', column: 'id', value: ROOM_ID }],
      single: true,
    });
    expect(harness.selectQueries[1]).toMatchObject({
      table: 'fixed_five_room_members',
      columns: 'participant_id, online, ready, picks_committed, locked, last_seen_at',
      filters: [{ op: 'eq', column: 'room_id', value: ROOM_ID }],
      single: false,
    });
    expect(created.code).toBe('1234');
    expect(created.membership).toEqual({
      roomId: ROOM_ID,
      participantId: 'p1',
      code: '1234',
    });
    expect(created.snapshot).toMatchObject({
      roomId: ROOM_ID,
      code: '1234',
      codeActive: true,
      phase: 'lobby',
      revision: 3,
      commandCount: 2,
      rootSeed: 'a'.repeat(32),
      createdAt: '2026-10-12T11:00:00.000Z',
    });
    expect(created.snapshot.settings.versions.dataVersion).toBe('data-v1');
    expect(created.snapshot.members.map((member) => member.participantId)).toEqual(['p1', 'p2']);
  });

  it('preview, join, rematch, leave, complete, and fail keep their RPC names and args', async () => {
    const { harness, transport } = setupTransport();
    harness.setRpc('fixed_five_room_preview', () => ({
      room_id: ROOM_ID,
      code: '1234',
      mode: 'classic-shared-82',
      source_mode: 'classic',
      variant: 'ratings',
      versions,
      phase: 'lobby',
      revision: 1,
      expires_at: '2026-10-12T12:00:00.000Z',
      created_at: '2026-10-12T11:00:00.000Z',
    }));
    harness.setRpc('fixed_five_room_join', () => ({
      room_id: ROOM_ID,
      code: '1234',
      participant_id: 'p2',
    }));
    harness.setRpc('fixed_five_rematch', () => ({ room_id: ROOM_ID, code: '5678' }));
    harness.setRpc('fixed_five_leave', () => true);
    harness.setRpc('fixed_five_complete', () => ({ completed: true, phase: 'completed' }));
    harness.setRpc('fixed_five_fail', () => ({ failed: true, phase: 'integrity-failed' }));
    seedRoom(harness);

    const preview = await transport.preview('1234');
    expect(preview.code).toBe('1234');
    expect(preview.members).toHaveLength(2);
    const joined = await transport.join('1234');
    expect(joined.membership.participantId).toBe('p2');
    const rematch = await transport.rematch(ROOM_ID);
    expect(rematch.code).toBe('5678');
    await transport.leave(ROOM_ID, 'p1');
    const completed = await transport.complete(ROOM_ID, 'receipt-1');
    expect(completed).toEqual({ completed: true, phase: 'completed' });
    const failed = await transport.fail(ROOM_ID);
    expect(failed).toEqual({ failed: true, phase: 'integrity-failed' });

    expect(harness.rpcCalls.map((call) => [call.name, call.args])).toEqual([
      ['fixed_five_room_preview', { p_code: '1234' }],
      ['fixed_five_room_join', { p_code: '1234' }],
      ['fixed_five_rematch', { p_room_id: ROOM_ID }],
      ['fixed_five_leave', { p_room_id: ROOM_ID }],
      ['fixed_five_complete', { p_room_id: ROOM_ID, p_receipt_id: 'receipt-1' }],
      ['fixed_five_fail', { p_room_id: ROOM_ID }],
    ]);
  });

  it('rejects a malformed room code with the invalid-code prefix', async () => {
    const { transport } = setupTransport();
    await expect(transport.preview('12ab')).rejects.toThrow(/invalid-code:/);
  });

  it('submitCommand pins p_expected_revision and maps accepted and rejected receipts', async () => {
    const { harness, transport } = setupTransport();
    harness.setRpc('fixed_five_command_submit', () => ({
      accepted: true,
      ordinal: 5,
      revision: 6,
    }));

    const accepted = await transport.submitCommand({
      schemaVersion: 1,
      roomId,
      commandId: commandIdSchema.parse('cmd-1'),
      actorParticipantId: 'p1',
      payload: { kind: 'ready', ready: true },
      expectedRevision: 5,
    });

    expect(harness.rpcCalls[0]).toEqual({
      name: 'fixed_five_command_submit',
      args: {
        p_room_id: ROOM_ID,
        p_command_id: 'cmd-1',
        p_expected_revision: 5,
        p_actor: 'p1',
        p_payload: { kind: 'ready', ready: true },
      },
    });
    expect(accepted).toEqual({
      roomId: ROOM_ID,
      commandId: 'cmd-1',
      ordinal: 5,
      accepted: true,
      rejectionCode: null,
      revision: 6,
    });

    harness.setRpc('fixed_five_command_submit', () => ({
      accepted: false,
      rejection_code: 'stale-revision',
      revision: 7,
    }));
    const rejected = await transport.submitCommand({
      schemaVersion: 1,
      roomId,
      commandId: commandIdSchema.parse('cmd-2'),
      actorParticipantId: 'p2',
      payload: { kind: 'ready', ready: false },
    });
    expect(rejected.rejectionCode).toBe('stale-revision');
    expect(rejected.revision).toBe(7);
    expect(harness.rpcCalls[1]?.args['p_expected_revision']).toBeNull();
  });

  it('refetch reads the ordered command tail and rejects malformed rows', async () => {
    const { harness, transport } = setupTransport();
    harness.setRows('fixed_five_room_commands', [
      {
        room_id: ROOM_ID,
        command_id: 'cmd-1',
        ordinal: 1,
        actor_participant_id: 'p1',
        payload: { kind: 'ready', ready: true },
      },
      {
        room_id: ROOM_ID,
        command_id: 'cmd-2',
        ordinal: 2,
        actor_participant_id: 'p2',
        payload: { kind: 'ready', ready: false },
      },
    ]);

    const commands = await transport.refetch(ROOM_ID, 0);
    expect(harness.selectQueries[0]).toMatchObject({
      table: 'fixed_five_room_commands',
      columns: 'command_id, ordinal, actor_participant_id, payload',
      filters: [
        { op: 'eq', column: 'room_id', value: ROOM_ID },
        { op: 'gt', column: 'ordinal', value: 0 },
      ],
      order: { column: 'ordinal', ascending: true },
    });
    expect(commands.map((command) => command.commandId)).toEqual(['cmd-1', 'cmd-2']);

    harness.setRows('fixed_five_room_commands', [
      {
        room_id: ROOM_ID,
        command_id: 'cmd-3',
        ordinal: 3,
        actor_participant_id: 'p3',
        payload: { kind: 'ready', ready: true },
      },
    ]);
    await expect(transport.refetch(ROOM_ID, 2)).rejects.toThrow();
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
    expect(channel?.topic).toBe(`fixed-five-room-${ROOM_ID}`);
    expect(channel?.subscribed).toBe(true);
    expect(channel?.postgresHandlers.map((handler) => handler.table)).toEqual([
      'fixed_five_rooms',
      'fixed_five_room_commands',
    ]);
    expect(channel?.postgresHandlers[0]?.filter).toBe(`id=eq.${ROOM_ID}`);

    channel?.triggerPostgresChange();
    await vi.waitFor(() => {
      expect(snapshots.length).toBeGreaterThan(0);
    });

    subscription.unsubscribe();
    await vi.waitFor(() => {
      expect(channel?.unsubscribed).toBe(true);
      expect(harness.removedChannels).toContain(`fixed-five-room-${ROOM_ID}`);
    });
  });

  it('verification, fallback, timeout, and guest removal keep their RPC shapes', async () => {
    const { harness, transport } = setupTransport();
    harness.setRpc('fixed_five_verification_challenge', () => 'challenge-1');
    harness.setRpc('fixed_five_verification_submit', () => ({
      accepted: true,
      receiptId: 'receipt-1',
      revision: 4,
    }));
    harness.setRpc('fixed_five_commit_fallback', () => ({ stored: true, revision: 2 }));
    harness.setRpc('fixed_five_timeout_resolve', () => ({
      resolved: true,
      command_id: 'timeout-cmd',
    }));
    harness.setRpc('fixed_five_guest_remove', () => true);
    seedRoom(harness);

    const challenge = await transport.verificationChallenge(ROOM_ID);
    expect(challenge).toBe('challenge-1');

    const receipt = fixedFiveVerificationReceiptSchema.parse({
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
    expect(timeout?.commandId).toBe('timeout-cmd');

    const snapshot = await transport.removeGuest(ROOM_ID, 'p2');
    expect(snapshot.roomId).toBe(ROOM_ID);

    expect(harness.rpcCalls.map((call) => [call.name, call.args])).toEqual([
      ['fixed_five_verification_challenge', { p_room_id: ROOM_ID }],
      [
        'fixed_five_verification_submit',
        {
          p_room_id: ROOM_ID,
          p_receipt_id: receipt.receiptDigest,
          p_receipt: receipt,
          p_expected_revision: 3,
        },
      ],
      [
        'fixed_five_commit_fallback',
        {
          p_room_id: ROOM_ID,
          p_cursor: 'cursor-1',
          p_payload: { kind: 'ready', ready: true },
          p_expected_revision: 2,
        },
      ],
      ['fixed_five_timeout_resolve', { p_room_id: ROOM_ID }],
      ['fixed_five_guest_remove', { p_room_id: ROOM_ID, p_target: 'p2' }],
    ]);
  });

  it('throws the deployed verification rejection shape when the server rejects a receipt', async () => {
    const { harness, transport } = setupTransport();
    harness.setRpc('fixed_five_verification_submit', () => ({
      accepted: false,
      rejectionCode: 'stale-revision',
      revision: 9,
    }));
    const receipt = fixedFiveVerificationReceiptSchema.parse({
      schemaVersion: 1,
      roomId: ROOM_ID,
      rootSeed: 'b'.repeat(32),
      versions,
      challenge: 'challenge-1',
      participantIds: ['p1', 'p2'],
      commandIds: [],
      gameSeeds: [],
      resultDigest: 'c'.repeat(64),
      receiptDigest: 'd'.repeat(64),
    });
    await expect(transport.submitVerification(ROOM_ID, receipt)).rejects.toMatchObject({
      rejectionCode: 'stale-revision',
      revision: 9,
    });
  });
});
