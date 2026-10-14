import type { SupabaseClient } from '@supabase/supabase-js';
import {
  commandIdSchema,
  createInMemoryFixedFiveTransport,
  fixedFiveCommandPayloadSchema,
  fixedFiveCommandSchema,
  fixedFiveRoomCodeSchema,
  fixedFiveRoomPhaseSchema,
  fixedFiveRoomSettingsSchema,
  fixedFiveRoomSnapshotSchema,
  fixedFiveVerificationReceiptSchema,
  idSchema,
  type FixedFiveCommandReceipt,
  type FixedFiveMemberSnapshot,
  type FixedFiveMultiplayerTransport,
  type FixedFiveParticipantId,
  type FixedFiveRoomCode,
  type FixedFiveRoomSettings,
  type FixedFiveRoomSnapshot,
  type Id,
} from '@hoop-rush/data-contracts';
import { randomUUID } from '$lib/ids';
import {
  createRealtimeRoomRegistry,
  ensureAnonymous,
  getCachedTransport,
  isUsablePublishableKey,
  isUsableSupabaseUrl,
  parseRoomCode,
  readSupabaseEnv,
  stringField,
  supabaseClient,
} from '$lib/supabase-runtime';

type FixedFiveClient = SupabaseClient;

interface FixedFiveRoomRow {
  id: Id;
  code: FixedFiveRoomCode | null;
  code_active: boolean;
  mode: unknown;
  source_mode: unknown;
  variant: unknown;
  versions: unknown;
  phase: string;
  revision: number;
  command_count: number;
  digest: FixedFiveRoomSnapshot['digest'];
  result_digest: FixedFiveRoomSnapshot['resultDigest'];
  confirmed_digest: FixedFiveRoomSnapshot['confirmedDigest'];
  successor_room_id: FixedFiveRoomSnapshot['successorRoomId'];
  series: unknown;
  broadcast: unknown;
  root_seed: NonNullable<FixedFiveRoomSnapshot['rootSeed']>;
  deadline_at: string | null;
  deadline_cursor: string | null;
  deadline_participant: string | null;
  deadline_fallback: unknown;
  deadline_pick_ordinal: number | null;
  expires_at: string;
  created_at: string;
}

interface FixedFiveMemberRow {
  participant_id: string;
  online: boolean;
  ready: boolean;
  picks_committed: number;
  locked: boolean;
  next_game_ready: number | null;
  last_seen_at: string | null;
}

interface FixedFiveCommandRow {
  command_id: string;
  ordinal: number;
  actor_participant_id: string;
  payload: unknown;
}

interface RpcRoomPayload {
  room_id: Id;
  code: FixedFiveRoomCode | null;
  participant_id?: FixedFiveParticipantId;
}

function rpcPayload(value: unknown): RpcRoomPayload {
  const record = value as Record<string, unknown>;
  const participantRaw = record['participant_id'];
  const rawCode = record['code'];
  return {
    room_id: idSchema.parse(stringField(record, 'room_id')),
    code: typeof rawCode === 'string' ? fixedFiveRoomCodeSchema.parse(rawCode) : null,
    participant_id: participantRaw === 'p1' || participantRaw === 'p2' ? participantRaw : undefined,
  };
}

interface RpcCommandPayload {
  accepted: boolean;
  ordinal?: number;
  revision?: number;
  rejection_code?: string;
}

function commandPayload(value: unknown): RpcCommandPayload {
  const record = value as Record<string, unknown>;
  const accepted = record['accepted'] === true;
  const ordinal = typeof record['ordinal'] === 'number' ? record['ordinal'] : undefined;
  const revision = typeof record['revision'] === 'number' ? record['revision'] : undefined;
  const rejection =
    typeof record['rejection_code'] === 'string' ? record['rejection_code'] : undefined;
  return { accepted, ordinal, revision, rejection_code: rejection };
}

const configuredTransportCache = new Map<string, FixedFiveMultiplayerTransport>();

export function getFixedFiveTransport(options?: {
  url?: string;
  publishableKey?: string;
  storageKey?: string;
}): FixedFiveMultiplayerTransport {
  const env = readSupabaseEnv();
  const url = options?.url ?? env.url;
  const publishableKey = options?.publishableKey ?? env.publishableKey;
  const storageKey = options?.storageKey ?? '';
  const key = `${url ?? 'memory'}${publishableKey ?? ''}${storageKey}`;
  return getCachedTransport(configuredTransportCache, key, () =>
    createFixedFiveTransport({ url, publishableKey, storageKey }),
  );
}

export function createFixedFiveTransport(options?: {
  url?: string;
  publishableKey?: string;
  storageKey?: string;
}): FixedFiveMultiplayerTransport {
  const candidateUrl =
    typeof options?.url === 'string' ? options.url.trim().replace(/\/+$/, '') : undefined;
  const candidateKey =
    typeof options?.publishableKey === 'string' ? options.publishableKey.trim() : undefined;
  if (
    !candidateUrl ||
    !candidateKey ||
    !isUsableSupabaseUrl(candidateUrl) ||
    !isUsablePublishableKey(candidateKey)
  ) {
    return createInMemoryFixedFiveTransport();
  }
  let clientPromise: Promise<FixedFiveClient> | null = null;
  const transportUrl = candidateUrl;
  const transportPublishableKey = candidateKey;
  const transportStorageKey = options?.storageKey;
  function getClient(): Promise<FixedFiveClient> {
    if (!clientPromise)
      clientPromise = supabaseClient(transportUrl, transportPublishableKey, transportStorageKey);
    return clientPromise;
  }
  function memberFallback(participantId: FixedFiveParticipantId): FixedFiveMemberSnapshot {
    return {
      participantId,
      online: false,
      ready: false,
      picksCommitted: 0,
      locked: false,
      nextGameReady: null,
      lastSeenAt: null,
    };
  }
  function memberFromRow(row: FixedFiveMemberRow): FixedFiveMemberSnapshot | null {
    if (row.participant_id !== 'p1' && row.participant_id !== 'p2') return null;
    return {
      participantId: row.participant_id,
      online: row.online,
      ready: row.ready,
      picksCommitted: row.picks_committed,
      locked: row.locked,
      nextGameReady:
        typeof row.next_game_ready === 'number' &&
        row.next_game_ready >= 1 &&
        row.next_game_ready <= 7
          ? row.next_game_ready
          : null,
      lastSeenAt: row.last_seen_at,
    };
  }
  function roomRowToSnapshot(
    row: FixedFiveRoomRow,
    memberRows: FixedFiveMemberRow[],
  ): FixedFiveRoomSnapshot {
    const byId = new Map<FixedFiveParticipantId, FixedFiveMemberSnapshot>();
    for (const memberRow of memberRows) {
      const member = memberFromRow(memberRow);
      if (member) byId.set(member.participantId, member);
    }
    const members: FixedFiveRoomSnapshot['members'] = [
      byId.get('p1') ?? memberFallback('p1'),
      byId.get('p2') ?? memberFallback('p2'),
    ];
    const phase = fixedFiveRoomPhaseSchema.parse(row.phase);
    let deadline: FixedFiveRoomSnapshot['deadline'] = null;
    if (row.deadline_at) {
      const fallback = fixedFiveCommandPayloadSchema.safeParse(row.deadline_fallback);
      deadline = {
        roomId: row.id,
        cursor: row.deadline_cursor ?? 'lobby',
        participantId: row.deadline_participant === 'p2' ? 'p2' : 'p1',
        deadlineAt: row.deadline_at,
        fallback: fallback.success ? fallback.data : null,
        pickOrdinal: row.deadline_pick_ordinal ?? 0,
      };
    }
    const settings = fixedFiveRoomSettingsSchema.parse({
      schemaVersion: 1,
      mode: row.mode,
      sourceMode: row.source_mode,
      variant: row.variant,
      timerPolicyVersion: 'fixed-five-autopick-v1',
      versions: row.versions,
    });
    return fixedFiveRoomSnapshotSchema.parse({
      roomId: row.id,
      code: row.code,
      codeActive: row.code_active,
      settings,
      phase,
      revision: row.revision,
      commandCount: row.command_count,
      digest: row.digest,
      members,
      rootSeed: row.root_seed,
      deadline,
      series: row.series ?? null,
      broadcast: row.broadcast ?? null,
      resultDigest: row.result_digest,
      confirmedDigest: row.confirmed_digest,
      successorRoomId: row.successor_room_id,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    });
  }
  async function fetchSnapshot(roomId: string): Promise<FixedFiveRoomSnapshot> {
    const client = await getClient();
    const roomResponse = await client
      .from('fixed_five_rooms')
      .select(
        'id, code, code_active, mode, source_mode, variant, versions, phase, revision, command_count, digest, result_digest, confirmed_digest, successor_room_id, series, broadcast, root_seed, deadline_at, deadline_cursor, deadline_participant, deadline_fallback, deadline_pick_ordinal, expires_at, created_at',
      )
      .eq('id', roomId)
      .single();
    if (roomResponse.error) throw new Error('authorization: cannot read room');
    const roomData: unknown = roomResponse.data;
    if (roomData == null) throw new Error('authorization: cannot read room');
    const memberResponse = await client
      .from('fixed_five_room_members')
      .select(
        'participant_id, online, ready, picks_committed, locked, next_game_ready, last_seen_at',
      )
      .eq('room_id', roomId);
    if (
      memberResponse.error ||
      !Array.isArray(memberResponse.data) ||
      memberResponse.data.length === 0
    ) {
      throw new Error('members failed: cannot verify room membership');
    }
    const row = roomData as FixedFiveRoomRow;
    const memberData: unknown = memberResponse.data;
    const memberRows = (Array.isArray(memberData) ? memberData : []) as FixedFiveMemberRow[];
    return roomRowToSnapshot(row, memberRows);
  }
  const registry = createRealtimeRoomRegistry<FixedFiveRoomSnapshot>({
    label: 'Fixed-five',
    roomsTable: 'fixed_five_rooms',
    commandsTable: 'fixed_five_room_commands',
    topic: (roomId) => `fixed-five-room-${roomId}`,
    fetchSnapshot,
    getClient,
  });
  return {
    async create(settingsInput) {
      const client = await getClient();
      await ensureAnonymous(client);
      const settings: FixedFiveRoomSettings = {
        schemaVersion: 1,
        timerPolicyVersion: 'fixed-five-autopick-v1',
        ...settingsInput,
        versions: settingsInput.versions,
      };
      const response = await client.rpc('fixed_five_room_create', {
        p_mode: settings.mode,
        p_source_mode: settings.sourceMode,
        p_variant: settings.variant,
        p_versions: settings.versions,
      });
      if (response.error || !response.data) {
        throw new Error(`create failed: ${response.error?.message ?? 'unknown'}`);
      }
      const payload = rpcPayload(response.data);
      const snapshot = await fetchSnapshot(payload.room_id);
      if (!payload.code) throw new Error('create failed: room code missing');
      const code = payload.code;
      return {
        snapshot,
        code,
        membership: { roomId: payload.room_id, participantId: 'p1', code },
      };
    },
    async preview(code) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_room_preview', { p_code: code });
      if (response.error || !response.data)
        throw new Error(`invalid-code: ${response.error?.message ?? code}`);
      const record = response.data as unknown as Record<string, unknown>;
      const settings = fixedFiveRoomSettingsSchema.parse({
        schemaVersion: 1,
        mode: record['mode'],
        sourceMode: record['source_mode'],
        variant: record['variant'],
        timerPolicyVersion: 'fixed-five-autopick-v1',
        versions: record['versions'],
      });
      const phase = fixedFiveRoomPhaseSchema.parse(
        typeof record['phase'] === 'string' ? record['phase'] : 'lobby',
      );
      const revision = typeof record['revision'] === 'number' ? record['revision'] : 0;
      const serverExpiresAt =
        typeof record['expires_at'] === 'string' &&
        Number.isFinite(Date.parse(record['expires_at']))
          ? record['expires_at']
          : null;
      const serverCreatedAt =
        typeof record['created_at'] === 'string' &&
        Number.isFinite(Date.parse(record['created_at']))
          ? record['created_at']
          : null;
      return {
        roomId: idSchema.parse(stringField(record, 'room_id')),
        code: parseRoomCode(code, fixedFiveRoomCodeSchema),
        codeActive: true,
        settings,
        phase,
        revision,
        commandCount: 0,
        digest: null,
        members: [memberFallback('p1'), memberFallback('p2')],
        rootSeed: null,
        deadline: null,
        series: null,
        broadcast: null,
        resultDigest: null,
        confirmedDigest: null,
        successorRoomId: null,
        expiresAt: serverExpiresAt ?? new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        createdAt: serverCreatedAt ?? new Date().toISOString(),
      };
    },
    async join(code) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_room_join', { p_code: code });
      if (response.error || !response.data)
        throw new Error(`join failed: ${response.error?.message ?? code}`);
      const payload = rpcPayload(response.data);
      const snapshot = await fetchSnapshot(payload.room_id);
      const participantId: FixedFiveParticipantId = payload.participant_id ?? 'p2';
      const membershipCode = parseRoomCode(code, fixedFiveRoomCodeSchema);
      return {
        snapshot,
        membership: { roomId: payload.room_id, participantId, code: membershipCode },
      };
    },
    async resume(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const snapshot = await fetchSnapshot(roomId);
      const user = await client.auth.getUser();
      const uid = user.data.user?.id;
      if (!uid) throw new Error('membership: not signed in');
      const memberResponse = await client
        .from('fixed_five_room_members')
        .select('participant_id')
        .eq('room_id', roomId)
        .eq('uid', uid)
        .single();
      if (memberResponse.error) {
        throw new Error('membership: no seat in this room');
      }
      const seatData: unknown = memberResponse.data;
      if (seatData == null) {
        throw new Error('membership: no seat in this room');
      }
      const member = seatData as {
        participant_id?: unknown;
      };
      if (member.participant_id !== 'p1' && member.participant_id !== 'p2') {
        throw new Error('membership: no seat in this room');
      }
      const participantId: FixedFiveParticipantId = member.participant_id;
      return {
        snapshot,
        membership: {
          roomId: idSchema.parse(roomId),
          participantId,
          code: snapshot.code ?? fixedFiveRoomCodeSchema.parse('0000'),
        },
      };
    },
    subscribe(roomId, handler) {
      return registry.subscribe(roomId, handler);
    },
    async refetch(roomId, afterOrdinal) {
      const client = await getClient();
      await ensureAnonymous(client);
      const parsedRoomId = idSchema.parse(roomId);
      const response = await client
        .from('fixed_five_room_commands')
        .select('command_id, ordinal, actor_participant_id, payload')
        .eq('room_id', parsedRoomId)
        .gt('ordinal', afterOrdinal)
        .order('ordinal', { ascending: true });
      if (response.error) throw new Error(`refetch failed: ${response.error.message}`);
      const rows = response.data as unknown as FixedFiveCommandRow[];
      return rows.map((row) =>
        fixedFiveCommandSchema.parse({
          schemaVersion: 1,
          roomId: parsedRoomId,
          commandId: row.command_id,
          ordinal: row.ordinal,
          actorParticipantId: row.actor_participant_id,
          payload: row.payload,
        }),
      );
    },
    async submitCommand(command) {
      const client = await getClient();
      await ensureAnonymous(client);
      const commandId = command.commandId || commandIdSchema.parse(randomUUID());
      const withRevision = command as unknown as {
        expectedRevision?: unknown;
      };
      const expectedRevision =
        typeof withRevision.expectedRevision === 'number' ? withRevision.expectedRevision : null;
      const response = await client.rpc('fixed_five_command_submit', {
        p_room_id: command.roomId,
        p_command_id: commandId,
        p_expected_revision: expectedRevision,
        p_actor: command.actorParticipantId,
        p_payload: command.payload,
      });
      if (response.error) throw new Error(`command failed: ${response.error.message}`);
      const payload = commandPayload(response.data);
      const receipt: FixedFiveCommandReceipt = {
        roomId: command.roomId,
        commandId,
        ordinal: payload.ordinal ?? -1,
        accepted: payload.accepted,
        rejectionCode: payload.rejection_code ?? null,
        revision: payload.revision ?? 0,
      };
      return receipt;
    },
    async verificationChallenge(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_verification_challenge', {
        p_room_id: roomId,
      });
      if (response.error)
        throw new Error(`verification challenge failed: ${response.error.message}`);
      const data: unknown = response.data;
      if (typeof data === 'string' && data.length > 0) return data;
      const record =
        typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
      for (const key of ['challenge', 'challenge_string', 'value', 'token']) {
        const candidate = record[key];
        if (typeof candidate === 'string' && candidate.length > 0) return candidate;
      }
      throw new Error('verification challenge failed: server returned no challenge');
    },
    async submitVerification(roomId, receipt, expectedRevision) {
      const client = await getClient();
      await ensureAnonymous(client);
      const parsed = fixedFiveVerificationReceiptSchema.parse(receipt);
      const response = await client.rpc('fixed_five_verification_submit', {
        p_room_id: roomId,
        p_receipt_id: parsed.receiptDigest,
        p_receipt: parsed,
        p_expected_revision: expectedRevision ?? null,
      });
      if (response.error) throw new Error(`verification submit failed: ${response.error.message}`);
      const record =
        typeof response.data === 'object' && response.data !== null
          ? (response.data as Record<string, unknown>)
          : {};
      if (record['accepted'] !== true) {
        const rejectionCode =
          typeof record['rejectionCode'] === 'string' ? record['rejectionCode'] : 'invalid-receipt';
        const rejectionRevision =
          typeof record['revision'] === 'number' ? record['revision'] : null;
        throw Object.assign(new Error(`verification submit rejected: ${rejectionCode}`), {
          rejectionCode,
          revision: rejectionRevision,
        });
      }
      const receiptId =
        typeof record['receiptId'] === 'string' && record['receiptId'].length > 0
          ? record['receiptId']
          : parsed.receiptDigest;
      const revision = typeof record['revision'] === 'number' ? record['revision'] : 0;
      return { receiptId, revision };
    },
    async commitFallback(roomId, cursor, payload, expectedRevision) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_commit_fallback', {
        p_room_id: roomId,
        p_cursor: cursor,
        p_payload: payload,
        p_expected_revision: expectedRevision ?? null,
      });
      if (response.error) throw new Error(`commit fallback failed: ${response.error.message}`);
      const record =
        typeof response.data === 'object' && response.data !== null
          ? (response.data as Record<string, unknown>)
          : {};
      const revision = typeof record['revision'] === 'number' ? record['revision'] : 0;
      return { stored: record['stored'] === true, revision };
    },
    async resolveTimeout(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_timeout_resolve', { p_room_id: roomId });
      if (response.error || !response.data) return null;
      const record = response.data as unknown as Record<string, unknown>;
      if (record['resolved'] !== true) return null;
      const commandId =
        typeof record['command_id'] === 'string'
          ? commandIdSchema.parse(record['command_id'])
          : commandIdSchema.parse('timeout');
      return {
        roomId: idSchema.parse(roomId),
        commandId,
        ordinal: -1,
        accepted: true,
        rejectionCode: null,
        revision: 0,
      };
    },
    async removeGuest(roomId, targetParticipantId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_guest_remove', {
        p_room_id: roomId,
        p_target: targetParticipantId,
      });
      if (response.error) throw new Error(`remove-guest failed: ${response.error.message}`);
      return fetchSnapshot(roomId);
    },
    async leave(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_leave', { p_room_id: roomId });
      if (response.error) throw new Error(`leave failed: ${response.error.message}`);
    },
    async rematch(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_rematch', { p_room_id: roomId });
      if (response.error || !response.data)
        throw new Error(`rematch failed: ${response.error?.message ?? 'unknown'}`);
      const payload = rpcPayload(response.data);
      const snapshot = await fetchSnapshot(payload.room_id);
      if (!payload.code) throw new Error('rematch failed: room code missing');
      return { snapshot, code: payload.code };
    },
    async complete(roomId, receiptId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_complete', {
        p_room_id: roomId,
        p_receipt_id: receiptId,
      });
      if (response.error || !response.data)
        throw new Error(`complete failed: ${response.error?.message ?? 'unknown'}`);
      const record = response.data as unknown as Record<string, unknown>;
      const phase = fixedFiveRoomPhaseSchema.parse(
        typeof record['phase'] === 'string' ? record['phase'] : 'awaiting-confirmation',
      );
      return { completed: record['completed'] === true, phase };
    },
    async fail(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_fail', { p_room_id: roomId });
      if (response.error || !response.data)
        throw new Error(`fail failed: ${response.error?.message ?? 'unknown'}`);
      const record = response.data as unknown as Record<string, unknown>;
      const phase = fixedFiveRoomPhaseSchema.parse(
        typeof record['phase'] === 'string' ? record['phase'] : 'awaiting-confirmation',
      );
      return { failed: record['failed'] === true, phase };
    },
  };
}
