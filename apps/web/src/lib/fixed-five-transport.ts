import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  commandIdSchema,
  createInMemoryFixedFiveTransport,
  fixedFiveCommandPayloadSchema,
  fixedFiveCommandSchema,
  fixedFiveRoomCodeSchema,
  fixedFiveRoomPhaseSchema,
  fixedFiveRoomSettingsSchema,
  fixedFiveRoomSnapshotSchema,
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
import { randomUUID } from '$lib/random-id';

type FixedFiveClient = SupabaseClient;

const sharedClients = new Map<string, FixedFiveClient>();

function supabaseClient(url: string, publishableKey: string, storageKey?: string): FixedFiveClient {
  const key = `${url}${publishableKey}${storageKey ?? ''}`;
  const existing = sharedClients.get(key);
  if (existing) return existing;
  const client = createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      ...(storageKey ? { storageKey } : {}),
    },
  }) as FixedFiveClient;
  sharedClients.set(key, client);
  return client;
}

function parseRoomCode(code: string): FixedFiveRoomCode {
  const clean = code.replace(/\D/g, '').slice(0, 4);
  const parsed = fixedFiveRoomCodeSchema.safeParse(clean);
  if (!parsed.success) {
    throw new Error(`invalid-code: expected the host's 4-digit code (got ${code})`);
  }
  return parsed.data;
}

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

function stringField(record: Record<string, unknown>, key: string, fallback = ''): string {
  const value = record[key];
  return typeof value === 'string' ? value : fallback;
}

function rpcPayload(value: unknown): RpcRoomPayload {
  const record = value as Record<string, unknown>;
  const participantRaw = record['participant_id'];
  const rawCode = record['code'];
  return {
    room_id: idSchema.parse(stringField(record, 'room_id')),
    // Only create/rematch return a code; join returns room_id + seat.
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

function supabaseEnv(): { url?: string; publishableKey?: string } {
  const env = import.meta.env as Record<string, unknown>;
  const url = env['VITE_SUPABASE_URL'];
  const publishableKey = env['VITE_SUPABASE_PUBLISHABLE_KEY'];
  return {
    url: typeof url === 'string' ? url : undefined,
    publishableKey: typeof publishableKey === 'string' ? publishableKey : undefined,
  };
}

export function isFixedFiveSupabaseConfigured(): boolean {
  const { url, publishableKey } = supabaseEnv();
  return Boolean(url && publishableKey);
}

export function createConfiguredFixedFiveTransport(): FixedFiveMultiplayerTransport {
  const { url, publishableKey } = supabaseEnv();
  return createFixedFiveTransport({ url, publishableKey });
}

const configuredTransportCache = new Map<string, FixedFiveMultiplayerTransport>();

export function getFixedFiveTransport(options?: {
  url?: string;
  publishableKey?: string;
  storageKey?: string;
}): FixedFiveMultiplayerTransport {
  const env = supabaseEnv();
  const url = options?.url ?? env.url;
  const publishableKey = options?.publishableKey ?? env.publishableKey;
  const storageKey = options?.storageKey ?? '';
  const key = `${url ?? 'memory'}${publishableKey ?? ''}${storageKey}`;
  const existing = configuredTransportCache.get(key);
  if (existing) return existing;
  const created = createFixedFiveTransport({ url, publishableKey, storageKey });
  configuredTransportCache.set(key, created);
  return created;
}

async function ensureAnonymous(client: FixedFiveClient): Promise<void> {
  const session = await client.auth.getSession();
  if (session.data.session) return;
  const signed = await client.auth.signInAnonymously();
  if (signed.error) throw new Error(`anonymous sign-in failed: ${signed.error.message}`);
}

export function createFixedFiveTransport(options?: {
  url?: string;
  publishableKey?: string;
  storageKey?: string;
}): FixedFiveMultiplayerTransport {
  if (!options?.url || !options.publishableKey) {
    return createInMemoryFixedFiveTransport();
  }
  const client: FixedFiveClient = supabaseClient(
    options.url,
    options.publishableKey,
    options.storageKey,
  );
  const rooms = new Map<
    string,
    {
      handlers: Set<(snapshot: FixedFiveRoomSnapshot) => void>;
      channel: ReturnType<FixedFiveClient['channel']> | null;
      lastSnapshot: FixedFiveRoomSnapshot | null;
    }
  >();

  function memberFallback(participantId: FixedFiveParticipantId): FixedFiveMemberSnapshot {
    return {
      participantId,
      online: false,
      ready: false,
      picksCommitted: 0,
      locked: false,
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
      if (fallback.success) {
        deadline = {
          roomId: row.id,
          cursor: row.deadline_cursor ?? 'lobby',
          participantId: row.deadline_participant === 'p2' ? 'p2' : 'p1',
          deadlineAt: row.deadline_at,
          fallback: fallback.data,
          pickOrdinal: row.deadline_pick_ordinal ?? 0,
        };
      }
    }
    // The rooms table stores settings as separate columns (mode, source_mode,
    // variant, versions) — never as a nested object. Rebuild + validate here so
    // a malformed row fails fast instead of crashing the template on .settings.
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
      resultDigest: row.result_digest,
      confirmedDigest: row.confirmed_digest,
      successorRoomId: row.successor_room_id,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    });
  }

  async function fetchSnapshot(roomId: string): Promise<FixedFiveRoomSnapshot> {
    const roomResponse = await client
      .from('fixed_five_rooms')
      .select(
        'id, code, code_active, mode, source_mode, variant, versions, phase, revision, command_count, digest, result_digest, confirmed_digest, successor_room_id, root_seed, deadline_at, deadline_cursor, deadline_participant, deadline_fallback, deadline_pick_ordinal, expires_at, created_at',
      )
      .eq('id', roomId)
      .single();
    if (roomResponse.error) throw new Error('authorization: cannot read room');
    const roomData: unknown = roomResponse.data;
    if (roomData == null) throw new Error('authorization: cannot read room');
    const memberResponse = await client
      .from('fixed_five_room_members')
      .select('participant_id, online, ready, picks_committed, locked, last_seen_at')
      .eq('room_id', roomId);
    if (memberResponse.error) throw new Error(`members failed: ${memberResponse.error.message}`);
    const row = roomData as FixedFiveRoomRow;
    const memberData: unknown = memberResponse.data;
    const memberRows = (Array.isArray(memberData) ? memberData : []) as FixedFiveMemberRow[];
    return roomRowToSnapshot(row, memberRows);
  }

  function emit(roomId: string, snapshot: FixedFiveRoomSnapshot): void {
    const record = rooms.get(roomId);
    if (!record) return;
    record.lastSnapshot = snapshot;
    for (const handler of record.handlers) handler(snapshot);
  }

  async function refresh(roomId: string): Promise<void> {
    try {
      const snapshot = await fetchSnapshot(roomId);
      emit(roomId, snapshot);
    } catch {
      /* realtime hint only; sync surfaces errors */
    }
  }

  return {
    async create(settingsInput) {
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
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_room_preview', { p_code: code });
      if (response.error || !response.data)
        throw new Error(`invalid-code: ${response.error?.message ?? code}`);
      // Preview runs before membership exists, so RLS reads are denied by design.
      // Build a display-only snapshot from the RPC payload instead of fetching rows.
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
      return {
        roomId: idSchema.parse(stringField(record, 'room_id')),
        code: parseRoomCode(code),
        codeActive: true,
        settings,
        phase,
        revision,
        commandCount: 0,
        digest: null,
        members: [memberFallback('p1'), memberFallback('p2')],
        rootSeed: null,
        deadline: null,
        resultDigest: null,
        confirmedDigest: null,
        successorRoomId: null,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
      };
    },
    async join(code) {
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_room_join', { p_code: code });
      if (response.error || !response.data)
        throw new Error(`join failed: ${response.error?.message ?? code}`);
      const payload = rpcPayload(response.data);
      const snapshot = await fetchSnapshot(payload.room_id);
      const participantId: FixedFiveParticipantId = payload.participant_id ?? 'p2';
      const membershipCode = parseRoomCode(code);
      return {
        snapshot,
        membership: { roomId: payload.room_id, participantId, code: membershipCode },
      };
    },
    async resume(roomId) {
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
      const member = seatData as { participant_id?: unknown };
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
      let record = rooms.get(roomId);
      if (!record) {
        record = { handlers: new Set(), channel: null, lastSnapshot: null };
        rooms.set(roomId, record);
      }
      record.handlers.add(handler);
      if (!record.channel) {
        const channel = client
          .channel(`fixed-five-room-${roomId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'fixed_five_rooms', filter: `id=eq.${roomId}` },
            () => {
              void refresh(roomId);
            },
          )
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'fixed_five_room_commands',
              filter: `room_id=eq.${roomId}`,
            },
            () => {
              void refresh(roomId);
            },
          )
          .subscribe();
        record.channel = channel;
      }
      return {
        unsubscribe: () => {
          const existing = rooms.get(roomId);
          if (!existing) return;
          existing.handlers.delete(handler);
          if (existing.handlers.size === 0) {
            const channel = existing.channel;
            existing.channel = null;
            rooms.delete(roomId);
            if (channel) {
              void channel.unsubscribe().then(() => {
                void client.removeChannel(channel);
              });
            }
          }
        },
      };
    },
    async refetch(roomId, afterOrdinal) {
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
      await ensureAnonymous(client);
      const commandId = command.commandId || commandIdSchema.parse(randomUUID());
      const withRevision = command as unknown as { expectedRevision?: unknown };
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
    async resolveTimeout(roomId) {
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
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_guest_remove', {
        p_room_id: roomId,
        p_target: targetParticipantId,
      });
      if (response.error) throw new Error(`remove-guest failed: ${response.error.message}`);
      return fetchSnapshot(roomId);
    },
    async leave(roomId) {
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_leave', { p_room_id: roomId });
      if (response.error) throw new Error(`leave failed: ${response.error.message}`);
    },
    async rematch(roomId) {
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_rematch', { p_room_id: roomId });
      if (response.error || !response.data)
        throw new Error(`rematch failed: ${response.error?.message ?? 'unknown'}`);
      const payload = rpcPayload(response.data);
      const snapshot = await fetchSnapshot(payload.room_id);
      if (!payload.code) throw new Error('rematch failed: room code missing');
      return { snapshot, code: payload.code };
    },
    async complete(roomId, resultDigest) {
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_complete', {
        p_room_id: roomId,
        p_result_digest: resultDigest,
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
