import { describe, expect, it, vi } from 'vitest';
import {
  commandIdSchema,
  contentHashSchema,
  defaultHavocMultiplayerVersionLocks,
  havocMultiplayerFirstPickerFor,
  havocMultiplayerTransientEventSchema,
  havocMultiplayerVerificationReceiptSchema,
  idSchema,
  seedSchema,
  type HavocCatalog,
  type HavocMultiplayerCommandRejectionCode,
  type HavocMultiplayerTransport,
} from '@hoop-rush/data-contracts';
import {
  AdaptHavocCatalog,
  HAVOC_MUTATION_DEFINITIONS,
  createHavocCommandEnvironment,
  createRng,
  replayHavocMultiplayerDraft,
  type HavocCommandEnvironment,
} from '@hoop-rush/engine';
import { buildSeasonDraftCatalog } from '@hoop-rush/test-fixtures';
import {
  createFakeSupabaseHarness,
  type FakeSupabaseHarness,
} from '$lib/testing/fake-supabase-client';
import {
  createHavocMultiplayerTransport,
  type HavocMultiplayerTransportOptions,
} from './havoc-multiplayer-transport';

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

const ROOM_ID = 'hm-room-1';
const roomId = idSchema.parse(ROOM_ID);
const ROOM_COLUMNS =
  'id, code, code_active, versions, root_seed, phase, revision, command_count, result_digest, confirmed_digest, successor_room_id, deadline_at, deadline_cursor, deadline_participant, deadline_fallback, deadline_pick_ordinal, draft_state, series, broadcast, game_state, created_at, expires_at';
const versions = defaultHavocMultiplayerVersionLocks({
  dataVersion: 'data-v1',
  catalogHash: 'e'.repeat(64),
  profileHash: 'f'.repeat(64),
});

let transportCounter = 0;

function setupTransport(options?: {
  loadDraftAssets?: HavocMultiplayerTransportOptions['loadDraftAssets'];
}): {
  harness: FakeSupabaseHarness;
  transport: HavocMultiplayerTransport;
} {
  transportCounter += 1;
  const harness = createFakeSupabaseHarness();
  mockState.harness = harness;
  const transport = createHavocMultiplayerTransport({
    url: `https://havoc-conformance-${String(transportCounter)}.supabase.co`,
    publishableKey: `sb_publishable_havoc_conformance_${String(transportCounter)}`,
    storageKey: `havoc-conformance-${String(transportCounter)}`,
    ...(options?.loadDraftAssets ? { loadDraftAssets: options.loadDraftAssets } : {}),
  });
  return { harness, transport };
}

function fixtureDraftAssets(): { catalog: HavocCatalog; environment: HavocCommandEnvironment } {
  const seasonCatalog = buildSeasonDraftCatalog();
  const source = {
    catalogVersion: seasonCatalog.catalogVersion,
    catalogHash: contentHashSchema.parse('ab'.repeat(32)),
    dataVersion: seasonCatalog.dataVersion,
    ratingsVersion: seasonCatalog.ratingsVersion,
    playerVersionIdVersion: seasonCatalog.playerVersionIdVersion,
    positionNormalizationVersion: seasonCatalog.positionNormalizationVersion,
  };
  const catalog = AdaptHavocCatalog(seasonCatalog, source);
  const environment = createHavocCommandEnvironment(catalog, {
    rngFactory: createRng,
    definitions: HAVOC_MUTATION_DEFINITIONS,
  });
  return { catalog, environment };
}

function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${label}`);
  return value;
}

function roomRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ROOM_ID,
    code: '4321',
    code_active: true,
    versions,
    root_seed: 'a'.repeat(32),
    phase: 'lobby',
    revision: 2,
    command_count: 1,
    result_digest: null,
    confirmed_digest: null,
    successor_room_id: null,
    deadline_at: null,
    deadline_cursor: null,
    deadline_participant: null,
    deadline_fallback: null,
    deadline_pick_ordinal: null,
    draft_state: {},
    series: null,
    broadcast: null,
    game_state: {},
    created_at: '2026-10-14T11:00:00.000Z',
    expires_at: '2026-10-15T12:00:00.000Z',
    ...overrides,
  };
}

function memberRow(participantId: string, overrides: Record<string, unknown> = {}) {
  return {
    room_id: ROOM_ID,
    uid: participantId === 'p1' ? 'user-1' : 'user-2',
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
  harness.setRows('havoc_multiplayer_rooms', [roomRow(overrides)]);
  harness.setRows('havoc_multiplayer_room_members', [memberRow('p1'), memberRow('p2')]);
}

describe('havoc multiplayer supabase transport protocol pins', () => {
  it('create sends the deployed RPC shape and maps the room snapshot', async () => {
    const { harness, transport } = setupTransport();
    harness.setRpc('havoc_multiplayer_room_create', () => ({ room_id: ROOM_ID, code: '4321' }));
    seedRoom(harness);

    const created = await transport.create({ versions });

    expect(harness.rpcCalls).toEqual([
      { name: 'havoc_multiplayer_room_create', args: { p_versions: versions } },
    ]);
    expect(harness.selectQueries[0]).toMatchObject({
      table: 'havoc_multiplayer_rooms',
      columns: ROOM_COLUMNS,
      filters: [{ op: 'eq', column: 'id', value: ROOM_ID }],
      single: true,
    });
    expect(harness.selectQueries[1]).toMatchObject({
      table: 'havoc_multiplayer_room_members',
      columns: 'participant_id, online, ready, next_game_ready, locked, last_seen_at',
      filters: [{ op: 'eq', column: 'room_id', value: ROOM_ID }],
      single: false,
    });
    expect(created.code).toBe('4321');
    expect(created.membership).toEqual({ roomId: ROOM_ID, participantId: 'p1', code: '4321' });
    expect(created.snapshot.settings.versions).toEqual(versions);
    expect(created.snapshot.members.map((member) => member.participantId)).toEqual(['p1', 'p2']);
    expect(created.snapshot.members[0]?.displayName).toBe('Host');
    expect(created.snapshot.draft).toBeNull();
    expect(created.snapshot.series).toBeNull();
  });

  it('preview and join keep their RPC names and args', async () => {
    const { harness, transport } = setupTransport();
    harness.setRpc('havoc_multiplayer_room_preview', () => ({
      room_id: ROOM_ID,
      phase: 'lobby',
      revision: 1,
      versions,
      expires_at: '2026-10-15T12:00:00.000Z',
      created_at: '2026-10-14T11:00:00.000Z',
    }));
    harness.setRpc('havoc_multiplayer_room_join', () => ({
      room_id: ROOM_ID,
      participant_id: 'p2',
    }));
    seedRoom(harness);

    const preview = await transport.preview('4321');
    expect(preview.code).toBe('4321');
    expect(preview.phase).toBe('lobby');
    const joined = await transport.join('4321');
    expect(joined.membership.participantId).toBe('p2');
    expect(joined.membership.code).toBe('4321');

    expect(harness.rpcCalls.map((call) => [call.name, call.args])).toEqual([
      ['havoc_multiplayer_room_preview', { p_code: '4321' }],
      ['havoc_multiplayer_room_join', { p_code: '4321' }],
    ]);
  });

  it('resume resolves the caller seat from membership', async () => {
    const { harness, transport } = setupTransport();
    seedRoom(harness);
    const resumed = await transport.resume(ROOM_ID);
    expect(resumed.membership.participantId).toBe('p1');
    expect(harness.selectQueries.at(-1)).toMatchObject({
      table: 'havoc_multiplayer_room_members',
      columns: 'participant_id',
      filters: [
        { op: 'eq', column: 'room_id', value: ROOM_ID },
        { op: 'eq', column: 'uid', value: 'user-1' },
      ],
      single: true,
    });
  });

  it('submitCommand pins p_expected_revision and maps camelCase rejections', async () => {
    const { harness, transport } = setupTransport();
    harness.setRpc('havoc_multiplayer_command_submit', () => ({
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
      payload: { kind: 'ready' },
      expectedRevision: 4,
    });

    expect(harness.rpcCalls[0]).toEqual({
      name: 'havoc_multiplayer_command_submit',
      args: {
        p_room_id: ROOM_ID,
        p_command_id: 'cmd-9',
        p_expected_revision: 4,
        p_payload: { kind: 'ready' },
      },
    });
    expect(accepted).toEqual({
      roomId: ROOM_ID,
      commandId: 'cmd-9',
      accepted: true,
      rejectionCode: null,
      revision: 5,
    });
  });

  it.each<[string, HavocMultiplayerCommandRejectionCode]>([
    ['phase', 'invalid-phase'],
    ['turn', 'wrong-turn'],
    ['claim-taken', 'claim-taken'],
    ['illegal-move', 'unknown-command'],
    ['duplicate-command', 'command-conflict'],
    ['stale-revision', 'stale-revision'],
    ['not-ready', 'invalid-phase'],
    ['membership', 'not-a-member'],
    ['expiry', 'expired'],
    ['payload-too-large', 'unknown-command'],
    ['room-full', 'room-full'],
  ])('maps the server rejection %s onto %s', async (serverCode, expected) => {
    const { harness, transport } = setupTransport();
    harness.setRpc('havoc_multiplayer_command_submit', () => ({
      accepted: false,
      rejectionCode: serverCode,
      revision: 6,
    }));
    const rejected = await transport.submitCommand({
      schemaVersion: 1,
      roomId,
      commandId: commandIdSchema.parse('cmd-10'),
      actorParticipantId: 'p2',
      payload: { kind: 'ready' },
    });
    expect(rejected.accepted).toBe(false);
    expect(rejected.rejectionCode).toBe(expected);
    expect(rejected.revision).toBe(6);
  });

  it('refetch reads the ordered command tail', async () => {
    const { harness, transport } = setupTransport();
    harness.setRows('havoc_multiplayer_room_commands', [
      {
        room_id: ROOM_ID,
        command_id: 'cmd-1',
        ordinal: 0,
        actor_participant_id: 'p1',
        payload: { kind: 'ready' },
      },
    ]);
    const commands = await transport.refetch(ROOM_ID, -1);
    expect(harness.selectQueries[0]).toMatchObject({
      table: 'havoc_multiplayer_room_commands',
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
    expect(channel?.topic).toBe(`havoc-multiplayer-room-${ROOM_ID}`);
    expect(channel?.postgresHandlers.map((handler) => handler.table)).toEqual([
      'havoc_multiplayer_rooms',
      'havoc_multiplayer_room_commands',
    ]);

    channel?.triggerPostgresChange();
    await vi.waitFor(() => {
      expect(snapshots.length).toBeGreaterThan(0);
    });

    subscription.unsubscribe();
    await vi.waitFor(() => {
      expect(channel?.unsubscribed).toBe(true);
      expect(harness.removedChannels).toContain(`havoc-multiplayer-room-${ROOM_ID}`);
    });
  });

  it('transient broadcasts use the private havoc topic and event name', async () => {
    const { harness, transport } = setupTransport();
    const events: unknown[] = [];
    const subscription = transport.subscribeTransient(ROOM_ID, (event) => {
      events.push(event);
    });
    await vi.waitFor(() => {
      expect(harness.channels).toHaveLength(1);
    });
    const channel = harness.channels[0];
    expect(channel?.topic).toBe(`havoc-multiplayer:${ROOM_ID}`);
    expect(channel?.options).toEqual({ config: { private: true, broadcast: { self: false } } });
    expect(channel?.broadcastHandlers.map((handler) => handler.event)).toEqual(['transient']);

    const event = havocMultiplayerTransientEventSchema.parse({
      kind: 'reaction',
      participantId: 'p1',
      turnOrdinal: 2,
      reaction: 'hype',
      sentAtMs: 1_700_000_000_000,
    });
    const published = await transport.publishTransient(ROOM_ID, event);
    expect(published).toBe(true);
    expect(harness.broadcastSends).toEqual([
      {
        topic: `havoc-multiplayer:${ROOM_ID}`,
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

  it('verification, fallback, and timeout keep their RPC shapes', async () => {
    const { harness, transport } = setupTransport();
    harness.setRpc('havoc_multiplayer_verification_challenge', () => ({
      challenge: 'c'.repeat(64),
    }));
    harness.setRpc('havoc_multiplayer_verification_submit', () => ({
      accepted: true,
      receiptId: 'hvr-1',
      revision: 4,
    }));
    harness.setRpc('havoc_multiplayer_commit_fallback', () => ({ stored: true, revision: 2 }));
    harness.setRpc('havoc_multiplayer_timeout_resolve', () => ({
      accepted: true,
      commandId: 'timeout-t1-1',
      ordinal: 7,
      revision: 3,
    }));
    seedRoom(harness);

    const challenge = await transport.verificationChallenge(ROOM_ID);
    expect(challenge).toBe('c'.repeat(64));

    const receipt = havocMultiplayerVerificationReceiptSchema.parse({
      receiptId: 'hvr-1',
      challenge: 'c'.repeat(64),
      receiptDigest: 'd'.repeat(64),
      resultDigest: 'a'.repeat(32),
      commandIds: [],
      gameSeeds: ['b'.repeat(32)],
    });
    const submitted = await transport.submitVerification(ROOM_ID, receipt, 3);
    expect(submitted).toEqual({ receiptId: 'hvr-1', revision: 4 });

    const fallback = await transport.commitFallback(
      ROOM_ID,
      't1',
      {
        kind: 'timeout-pick',
        turnOrdinal: 1,
        offerId: `hvo-${'1'.repeat(32)}`,
        cardId: `hvc-${'2'.repeat(32)}`,
      },
      2,
    );
    expect(fallback).toEqual({ stored: true, revision: 2 });

    const timeout = await transport.resolveTimeout(ROOM_ID);
    expect(timeout).toEqual({
      roomId: ROOM_ID,
      commandId: 'timeout-t1-1',
      accepted: true,
      rejectionCode: null,
      revision: 3,
    });

    expect(harness.rpcCalls.map((call) => [call.name, call.args])).toEqual([
      ['havoc_multiplayer_verification_challenge', { p_room_id: ROOM_ID }],
      [
        'havoc_multiplayer_verification_submit',
        {
          p_room_id: ROOM_ID,
          p_receipt_id: 'hvr-1',
          p_receipt: receipt,
          p_expected_revision: 3,
        },
      ],
      [
        'havoc_multiplayer_commit_fallback',
        {
          p_room_id: ROOM_ID,
          p_cursor: 't1',
          p_payload: {
            kind: 'timeout-pick',
            turnOrdinal: 1,
            offerId: `hvo-${'1'.repeat(32)}`,
            cardId: `hvc-${'2'.repeat(32)}`,
          },
          p_expected_revision: 2,
        },
      ],
      ['havoc_multiplayer_timeout_resolve', { p_room_id: ROOM_ID }],
    ]);
  });

  it('verification submit surfaces server rejections', async () => {
    const { harness, transport } = setupTransport();
    harness.setRpc('havoc_multiplayer_verification_submit', () => ({
      accepted: false,
      rejectionCode: 'illegal-move',
      revision: 5,
    }));
    const receipt = havocMultiplayerVerificationReceiptSchema.parse({
      receiptId: 'hvr-2',
      challenge: 'c'.repeat(64),
      receiptDigest: 'd'.repeat(64),
      resultDigest: 'a'.repeat(32),
      commandIds: [],
      gameSeeds: ['b'.repeat(32)],
    });
    await expect(transport.submitVerification(ROOM_ID, receipt)).rejects.toThrow(/illegal-move/);
  });

  it('guest removal submits a remove-guest command and refetches', async () => {
    const { harness, transport } = setupTransport();
    harness.setRpc('havoc_multiplayer_command_submit', () => ({
      accepted: true,
      ordinal: 8,
      revision: 4,
    }));
    seedRoom(harness);
    const snapshot = await transport.removeGuest(ROOM_ID, 'p2');
    expect(snapshot.roomId).toBe(ROOM_ID);
    const call = harness.rpcCalls[0];
    expect(call?.name).toBe('havoc_multiplayer_command_submit');
    expect(call?.args).toMatchObject({
      p_room_id: ROOM_ID,
      p_expected_revision: null,
      p_payload: { kind: 'remove-guest', targetParticipantId: 'p2' },
    });
    expect(typeof call?.args['p_command_id']).toBe('string');
  });

  it('rematch, complete, fail, and leave keep their RPC names and args', async () => {
    const { harness, transport } = setupTransport();
    harness.setRpc('havoc_multiplayer_rematch', () => ({ room_id: ROOM_ID, code: '8765' }));
    harness.setRpc('havoc_multiplayer_complete', () => ({
      completed: true,
      phase: 'championship',
    }));
    harness.setRpc('havoc_multiplayer_fail', () => ({
      failed: true,
      phase: 'integrity-failed',
    }));
    harness.setRpc('havoc_multiplayer_leave', () => true);
    seedRoom(harness);

    const rematch = await transport.rematch(ROOM_ID);
    expect(rematch.code).toBe('8765');
    const completed = await transport.complete(ROOM_ID, 'hvr-1');
    expect(completed).toEqual({ completed: true, phase: 'championship' });
    const failed = await transport.fail(ROOM_ID);
    expect(failed).toEqual({ failed: true, phase: 'integrity-failed' });
    await transport.leave(ROOM_ID, 'p1');

    expect(harness.rpcCalls.map((call) => [call.name, call.args])).toEqual([
      ['havoc_multiplayer_rematch', { p_room_id: ROOM_ID }],
      ['havoc_multiplayer_complete', { p_room_id: ROOM_ID, p_receipt_id: 'hvr-1' }],
      ['havoc_multiplayer_fail', { p_room_id: ROOM_ID }],
      ['havoc_multiplayer_leave', { p_room_id: ROOM_ID }],
    ]);
  });

  it('falls back to the in-memory transport without usable env', () => {
    const transport = createHavocMultiplayerTransport({ url: '', publishableKey: '' });
    expect(typeof transport.create).toBe('function');
  });

  it('replays the accepted command log into the contract draft snapshot', async () => {
    const { harness, transport } = setupTransport({
      loadDraftAssets: () => Promise.resolve(fixtureDraftAssets()),
    });
    const rootSeed = 'a'.repeat(32);
    const firstPicker = havocMultiplayerFirstPickerFor(rootSeed);
    const assets = fixtureDraftAssets();
    const draft = replayHavocMultiplayerDraft({
      rootSeed: seedSchema.parse(rootSeed),
      catalog: assets.catalog,
      environment: assets.environment,
      commands: [],
    });
    const offer = must(draft.offer, 'generated offer');
    const card = must(offer.cards[0], 'generated card');
    const seasonKey = must(card.source.seasonKey, 'card season');
    seedRoom(harness, {
      phase: 'drafting',
      root_seed: rootSeed,
      draft_state: { turn_ordinal: 0, first_picker: firstPicker },
    });
    harness.setRows('havoc_multiplayer_room_commands', [
      {
        room_id: ROOM_ID,
        command_id: 'pick-0',
        ordinal: 0,
        actor_participant_id: firstPicker,
        payload: {
          kind: 'pick',
          turnOrdinal: 0,
          offerId: offer.offerId,
          cardId: card.cardId,
          claimKey: { playerId: card.source.playerId, seasonKey },
        },
      },
    ]);

    const resumed = await transport.resume(ROOM_ID);

    expect(resumed.snapshot.draft?.turnOrdinal).toBe(1);
    expect(resumed.snapshot.draft?.status).toBe('drafting');
    expect(resumed.snapshot.draft?.picks).toHaveLength(1);
    expect(resumed.snapshot.draft?.offer?.cards).toHaveLength(3);
    expect(harness.selectQueries).toContainEqual(
      expect.objectContaining({
        table: 'havoc_multiplayer_room_commands',
        order: { column: 'ordinal', ascending: true },
      }),
    );
  });

  it('synthesizes the seven-game contract series from the server state', async () => {
    const { harness, transport } = setupTransport();
    seedRoom(harness, {
      phase: 'preparing-game',
      series: {
        homeParticipantId: 'p1',
        games: [
          {
            gameNumber: 1,
            homeParticipantId: 'p1',
            awayParticipantId: 'p2',
            status: 'verified',
            winner: 'p1',
            inputDigest: 'a'.repeat(32),
            resultDigest: 'b'.repeat(32),
            tapeDigest: 'c'.repeat(32),
          },
        ],
        p1Wins: 1,
        p2Wins: 0,
        currentGameNumber: 2,
        champion: null,
      },
    });

    const resumed = await transport.resume(ROOM_ID);
    const series = must(resumed.snapshot.series, 'series');

    expect(series.games).toHaveLength(7);
    expect(series.games[0]).toMatchObject({
      gameNumber: 1,
      status: 'verified',
      winner: 'p1',
      homeParticipantId: 'p1',
    });
    expect(series.games[1]?.homeParticipantId).toBe('p1');
    expect(series.games[2]?.homeParticipantId).toBe('p2');
    expect(series.games[2]?.status).toBe('scheduled');
    expect(series.wins).toEqual({ p1: 1, p2: 0 });
    expect(series.champion).toBeNull();
  });
});
