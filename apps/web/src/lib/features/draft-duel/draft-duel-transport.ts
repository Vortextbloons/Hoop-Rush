import type { SupabaseClient } from '@supabase/supabase-js';
import {
  commandIdSchema,
  createInMemoryDraftDuelTransport,
  DRAFT_DUEL_AUTOPICK_VERSION,
  draftDuelBroadcastSchema,
  draftDuelCommandPayloadSchema,
  draftDuelCommandSchema,
  draftDuelRoomCodeSchema,
  draftDuelRoomPhaseSchema,
  draftDuelRoomSettingsSchema,
  draftDuelRoomSnapshotSchema,
  draftDuelSeriesSnapshotSchema,
  draftDuelTransientEventSchema,
  draftDuelVerificationReceiptSchema,
  idSchema,
  type DraftDuelCommandReceipt,
  type DraftDuelMemberSnapshot,
  type DraftDuelMultiplayerTransport,
  type DraftDuelParticipantId,
  type DraftDuelRoomCode,
  type DraftDuelRoomSettings,
  type DraftDuelRoomSnapshot,
  type DraftDuelTransientEvent,
  type Id,
} from '@hoop-rush/data-contracts';
import { randomUUID } from '#lib/ids.js';
import {
  createRealtimeRoomRegistry,
  ensureAnonymous,
  getCachedTransport,
  isUsablePublishableKey,
  isUsableSupabaseUrl,
  parseRoomCode,
  publishTransientPayload,
  readSupabaseEnv,
  stringField,
  subscribeTransientPayloads,
  supabaseClient,
} from '#lib/supabase-runtime.js';

type DraftDuelClient = SupabaseClient;

interface DraftDuelRoomRow {
  id: Id;
  code: DraftDuelRoomCode | null;
  code_active: boolean;
  fairness: unknown;
  presentation: unknown;
  versions: unknown;
  phase: string;
  revision: number;
  command_count: number;
  result_digest: DraftDuelRoomSnapshot['resultDigest'];
  confirmed_digest: DraftDuelRoomSnapshot['confirmedDigest'];
  successor_room_id: DraftDuelRoomSnapshot['successorRoomId'];
  root_seed: NonNullable<DraftDuelRoomSnapshot['rootSeed']>;
  deadline_at: string | null;
  deadline_cursor: string | null;
  deadline_participant: string | null;
  deadline_fallback: unknown;
  deadline_pick_ordinal: number | null;
  series: unknown;
  broadcast: unknown;
  expires_at: string;
  created_at: string;
}

interface DraftDuelMemberRow {
  participant_id: string;
  online: boolean;
  ready: boolean;
  next_game_ready: number;
  locked: boolean;
  last_seen_at: string | null;
}

interface DraftDuelCommandRow {
  command_id: string;
  ordinal: number;
  actor_participant_id: string;
  payload: unknown;
}

interface RpcRoomPayload {
  room_id: Id;
  code: DraftDuelRoomCode | null;
  participant_id?: DraftDuelParticipantId;
}

function rpcPayload(value: unknown): RpcRoomPayload {
  const record = value as Record<string, unknown>;
  const participantRaw = record['participant_id'];
  const rawCode = record['code'];
  return {
    room_id: idSchema.parse(stringField(record, 'room_id')),
    code: typeof rawCode === 'string' ? draftDuelRoomCodeSchema.parse(rawCode) : null,
    participant_id: participantRaw === 'p1' || participantRaw === 'p2' ? participantRaw : undefined,
  };
}

interface RpcCommandPayload {
  accepted: boolean;
  ordinal?: number;
  revision?: number;
  rejectionCode?: string;
  commandId?: string;
}

function commandPayload(value: unknown): RpcCommandPayload {
  const record = value as Record<string, unknown>;
  const accepted = record['accepted'] === true;
  const ordinal = typeof record['ordinal'] === 'number' ? record['ordinal'] : undefined;
  const revision = typeof record['revision'] === 'number' ? record['revision'] : undefined;
  const rejectionCode =
    typeof record['rejectionCode'] === 'string' ? record['rejectionCode'] : undefined;
  const commandId = typeof record['commandId'] === 'string' ? record['commandId'] : undefined;
  return { accepted, ordinal, revision, rejectionCode, commandId };
}

const configuredTransportCache = new Map<string, DraftDuelMultiplayerTransport>();

export function getDraftDuelTransport(options?: {
  url?: string;
  publishableKey?: string;
  storageKey?: string;
}): DraftDuelMultiplayerTransport {
  const env = readSupabaseEnv();
  const url = options?.url ?? env.url;
  const publishableKey = options?.publishableKey ?? env.publishableKey;
  const storageKey = options?.storageKey ?? '';
  const key = `${url ?? 'memory'}${publishableKey ?? ''}${storageKey}`;
  return getCachedTransport(configuredTransportCache, key, () =>
    createDraftDuelTransport({ url, publishableKey, storageKey }),
  );
}

export function createDraftDuelTransport(options?: {
  url?: string;
  publishableKey?: string;
  storageKey?: string;
}): DraftDuelMultiplayerTransport {
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
    return createInMemoryDraftDuelTransport();
  }
  let clientPromise: Promise<DraftDuelClient> | null = null;
  const transportUrl = candidateUrl;
  const transportPublishableKey = candidateKey;
  const transportStorageKey = options?.storageKey;
  function getClient(): Promise<DraftDuelClient> {
    if (!clientPromise)
      clientPromise = supabaseClient(transportUrl, transportPublishableKey, transportStorageKey);
    return clientPromise;
  }
  function memberFallback(participantId: DraftDuelParticipantId): DraftDuelMemberSnapshot {
    return {
      participantId,
      online: false,
      ready: false,
      nextGameReady: null,
      locked: false,
      lastSeenAt: null,
    };
  }
  function memberFromRow(row: DraftDuelMemberRow): DraftDuelMemberSnapshot | null {
    if (row.participant_id !== 'p1' && row.participant_id !== 'p2') return null;
    return {
      participantId: row.participant_id,
      online: row.online,
      ready: row.ready,
      nextGameReady: row.next_game_ready === 0 ? null : row.next_game_ready,
      locked: row.locked,
      lastSeenAt: row.last_seen_at,
    };
  }
  function roomRowToSnapshot(
    row: DraftDuelRoomRow,
    memberRows: DraftDuelMemberRow[],
  ): DraftDuelRoomSnapshot {
    const byId = new Map<DraftDuelParticipantId, DraftDuelMemberSnapshot>();
    for (const memberRow of memberRows) {
      const member = memberFromRow(memberRow);
      if (member) byId.set(member.participantId, member);
    }
    const members: DraftDuelRoomSnapshot['members'] = [
      byId.get('p1') ?? memberFallback('p1'),
      byId.get('p2') ?? memberFallback('p2'),
    ];
    const phase = draftDuelRoomPhaseSchema.parse(row.phase);
    let deadline: DraftDuelRoomSnapshot['deadline'] = null;
    if (row.deadline_at) {
      const fallback = draftDuelCommandPayloadSchema.safeParse(row.deadline_fallback);
      deadline = {
        roomId: row.id,
        cursor: row.deadline_cursor ?? 'lobby',
        participantId: row.deadline_participant === 'p2' ? 'p2' : 'p1',
        deadlineAt: row.deadline_at,
        fallback: fallback.success ? fallback.data : null,
        pickOrdinal: row.deadline_pick_ordinal ?? 0,
      };
    }
    const settings = draftDuelRoomSettingsSchema.parse({
      schemaVersion: 1,
      fairness: row.fairness,
      presentation: row.presentation,
      timerPolicyVersion: DRAFT_DUEL_AUTOPICK_VERSION,
      versions: row.versions,
    });
    const series =
      row.series === null || row.series === undefined
        ? null
        : draftDuelSeriesSnapshotSchema.parse(row.series);
    const broadcast =
      row.broadcast === null || row.broadcast === undefined
        ? null
        : draftDuelBroadcastSchema.parse(row.broadcast);
    return draftDuelRoomSnapshotSchema.parse({
      roomId: row.id,
      code: row.code,
      codeActive: row.code_active,
      settings,
      phase,
      revision: row.revision,
      commandCount: row.command_count,
      members,
      rootSeed: row.root_seed,
      deadline,
      series,
      broadcast,
      resultDigest: row.result_digest,
      confirmedDigest: row.confirmed_digest,
      successorRoomId: row.successor_room_id,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    });
  }
  async function fetchSnapshot(roomId: string): Promise<DraftDuelRoomSnapshot> {
    const client = await getClient();
    const roomResponse = await client
      .from('draft_duel_rooms')
      .select(
        'id, code, code_active, fairness, presentation, versions, phase, revision, command_count, result_digest, confirmed_digest, successor_room_id, root_seed, deadline_at, deadline_cursor, deadline_participant, deadline_fallback, deadline_pick_ordinal, series, broadcast, expires_at, created_at',
      )
      .eq('id', roomId)
      .single();
    if (roomResponse.error) throw new Error('authorization: cannot read room');
    const roomData: unknown = roomResponse.data;
    if (roomData == null) throw new Error('authorization: cannot read room');
    const memberResponse = await client
      .from('draft_duel_room_members')
      .select('participant_id, online, ready, next_game_ready, locked, last_seen_at')
      .eq('room_id', roomId);
    if (
      memberResponse.error ||
      !Array.isArray(memberResponse.data) ||
      memberResponse.data.length === 0
    ) {
      throw new Error('members failed: cannot verify room membership');
    }
    const row = roomData as DraftDuelRoomRow;
    const memberData: unknown = memberResponse.data;
    const memberRows = (Array.isArray(memberData) ? memberData : []) as DraftDuelMemberRow[];
    return roomRowToSnapshot(row, memberRows);
  }
  const registry = createRealtimeRoomRegistry<DraftDuelRoomSnapshot>({
    label: 'Draft Duel',
    roomsTable: 'draft_duel_rooms',
    commandsTable: 'draft_duel_room_commands',
    topic: (roomId) => `draft-duel-room-${roomId}`,
    fetchSnapshot,
    getClient,
  });
  const transientTopic = (roomId: string): string => `draft-duel:${roomId}`;
  return {
    async create(settingsInput) {
      const client = await getClient();
      await ensureAnonymous(client);
      const settings: DraftDuelRoomSettings = {
        schemaVersion: 1,
        timerPolicyVersion: DRAFT_DUEL_AUTOPICK_VERSION,
        ...settingsInput,
        versions: settingsInput.versions,
      };
      const response = await client.rpc('draft_duel_room_create', {
        p_fairness: settings.fairness,
        p_presentation: settings.presentation,
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
      const response = await client.rpc('draft_duel_room_preview', { p_code: code });
      if (response.error || !response.data)
        throw new Error(`invalid-code: ${response.error?.message ?? code}`);
      const record = response.data as unknown as Record<string, unknown>;
      const settings = draftDuelRoomSettingsSchema.parse({
        schemaVersion: 1,
        fairness: record['fairness'],
        presentation: record['presentation'],
        timerPolicyVersion: DRAFT_DUEL_AUTOPICK_VERSION,
        versions: record['versions'],
      });
      const phase = draftDuelRoomPhaseSchema.parse(
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
        code: parseRoomCode(code, draftDuelRoomCodeSchema),
        codeActive: true,
        settings,
        phase,
        revision,
        commandCount: 0,
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
      const response = await client.rpc('draft_duel_room_join', { p_code: code });
      if (response.error || !response.data)
        throw new Error(`join failed: ${response.error?.message ?? code}`);
      const payload = rpcPayload(response.data);
      const snapshot = await fetchSnapshot(payload.room_id);
      const participantId: DraftDuelParticipantId = payload.participant_id ?? 'p2';
      const membershipCode = parseRoomCode(code, draftDuelRoomCodeSchema);
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
        .from('draft_duel_room_members')
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
      const participantId: DraftDuelParticipantId = member.participant_id;
      return {
        snapshot,
        membership: {
          roomId: idSchema.parse(roomId),
          participantId,
          code: snapshot.code ?? draftDuelRoomCodeSchema.parse('0000'),
        },
      };
    },
    subscribe(roomId, handler) {
      return registry.subscribe(roomId, handler);
    },
    subscribeTransient(roomId, handler) {
      return subscribeTransientPayloads({
        getClient,
        topic: transientTopic(roomId),
        event: 'transient',
        onPayload: (payload) => {
          const parsed = draftDuelTransientEventSchema.safeParse(payload);
          if (!parsed.success) return;
          if (parsed.data.roomId !== roomId) return;
          handler(parsed.data);
        },
      });
    },
    async publishTransient(roomId, event: DraftDuelTransientEvent) {
      const parsed = draftDuelTransientEventSchema.safeParse(event);
      if (!parsed.success || parsed.data.roomId !== roomId) return false;
      return publishTransientPayload(getClient, transientTopic(roomId), 'transient', parsed.data);
    },
    async refetch(roomId, afterOrdinal) {
      const client = await getClient();
      await ensureAnonymous(client);
      const parsedRoomId = idSchema.parse(roomId);
      const response = await client
        .from('draft_duel_room_commands')
        .select('command_id, ordinal, actor_participant_id, payload')
        .eq('room_id', parsedRoomId)
        .gt('ordinal', afterOrdinal)
        .order('ordinal', { ascending: true });
      if (response.error) throw new Error(`refetch failed: ${response.error.message}`);
      const rows = response.data as unknown as DraftDuelCommandRow[];
      return rows.map((row) =>
        draftDuelCommandSchema.parse({
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
      const response = await client.rpc('draft_duel_command_submit', {
        p_room_id: command.roomId,
        p_command_id: commandId,
        p_expected_revision: expectedRevision,
        p_payload: command.payload,
      });
      if (response.error) throw new Error(`command failed: ${response.error.message}`);
      const payload = commandPayload(response.data);
      const receipt: DraftDuelCommandReceipt = {
        roomId: command.roomId,
        commandId: payload.commandId ? commandIdSchema.parse(payload.commandId) : commandId,
        ordinal: payload.ordinal ?? -1,
        accepted: payload.accepted,
        rejectionCode: payload.rejectionCode ?? null,
        revision: payload.revision ?? 0,
      };
      return receipt;
    },
    async verificationChallenge(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('draft_duel_verification_challenge', {
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
      const parsed = draftDuelVerificationReceiptSchema.parse(receipt);
      const response = await client.rpc('draft_duel_verification_submit', {
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
      const response = await client.rpc('draft_duel_commit_fallback', {
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
      const response = await client.rpc('draft_duel_timeout_resolve', { p_room_id: roomId });
      if (response.error || !response.data) return null;
      const record = response.data as unknown as Record<string, unknown>;
      if (record['accepted'] !== true) return null;
      const commandId =
        typeof record['commandId'] === 'string'
          ? commandIdSchema.parse(record['commandId'])
          : commandIdSchema.parse('timeout');
      const ordinal = typeof record['ordinal'] === 'number' ? record['ordinal'] : -1;
      const revision = typeof record['revision'] === 'number' ? record['revision'] : 0;
      return {
        roomId: idSchema.parse(roomId),
        commandId,
        ordinal,
        accepted: true,
        rejectionCode: null,
        revision,
      };
    },
    async removeGuest(roomId, targetParticipantId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const commandId = commandIdSchema.parse(randomUUID());
      const response = await client.rpc('draft_duel_command_submit', {
        p_room_id: roomId,
        p_command_id: commandId,
        p_expected_revision: null,
        p_payload: { kind: 'remove-guest', targetParticipantId },
      });
      if (response.error) throw new Error(`remove-guest failed: ${response.error.message}`);
      const payload = commandPayload(response.data);
      if (!payload.accepted) {
        throw new Error(`remove-guest failed: ${payload.rejectionCode ?? 'rejected'}`);
      }
      return fetchSnapshot(roomId);
    },
    async leave(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('draft_duel_leave', { p_room_id: roomId });
      if (response.error) throw new Error(`leave failed: ${response.error.message}`);
    },
    async rematch(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('draft_duel_rematch', { p_room_id: roomId });
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
      const response = await client.rpc('draft_duel_complete', {
        p_room_id: roomId,
        p_receipt_id: receiptId,
      });
      if (response.error || !response.data)
        throw new Error(`complete failed: ${response.error?.message ?? 'unknown'}`);
      const record = response.data as unknown as Record<string, unknown>;
      const phase = draftDuelRoomPhaseSchema.parse(
        typeof record['phase'] === 'string' ? record['phase'] : 'championship',
      );
      return { completed: record['completed'] === true, phase };
    },
    async fail(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('draft_duel_fail', { p_room_id: roomId });
      if (response.error || !response.data)
        throw new Error(`fail failed: ${response.error?.message ?? 'unknown'}`);
      const record = response.data as unknown as Record<string, unknown>;
      const phase = draftDuelRoomPhaseSchema.parse(
        typeof record['phase'] === 'string' ? record['phase'] : 'championship',
      );
      return { failed: record['failed'] === true, phase };
    },
  };
}
