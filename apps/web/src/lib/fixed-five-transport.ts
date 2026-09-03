import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  createInMemoryFixedFiveTransport,
  fixedFiveCommandPayloadSchema,
  fixedFiveCommandSchema,
  fixedFiveRoomSettingsSchema,
  type FixedFiveCommandReceipt,
  type FixedFiveMemberSnapshot,
  type FixedFiveMultiplayerTransport,
  type FixedFiveParticipantId,
  type FixedFiveRoomSettings,
  type FixedFiveRoomSnapshot,
} from '@hoop-rush/data-contracts';
import { randomUUID } from '$lib/random-id';

type FixedFiveClient = SupabaseClient;

function supabaseClient(url: string, publishableKey: string): FixedFiveClient {
  return createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  }) as FixedFiveClient;
}

interface FixedFiveRoomRow {
  id: string;
  code: string | null;
  code_active: boolean;
  mode: string;
  source_mode: string;
  variant: string;
  phase: string;
  revision: number;
  command_count: number;
  digest: string | null;
  result_digest: string | null;
  confirmed_digest: string | null;
  successor_room_id: string | null;
  root_seed: string;
  deadline_at: string | null;
  deadline_cursor: string | null;
  deadline_participant: string | null;
  deadline_fallback: unknown;
  deadline_pick_ordinal: number | null;
  expires_at: string;
  created_at: string;
  settings: FixedFiveRoomSnapshot['settings'];
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
  room_id: string;
  code: string;
  participant_id?: FixedFiveParticipantId;
}

function stringField(record: Record<string, unknown>, key: string, fallback = ''): string {
  const value = record[key];
  return typeof value === 'string' ? value : fallback;
}

function rpcPayload(value: unknown): RpcRoomPayload {
  const record = value as Record<string, unknown>;
  const participantRaw = record['participant_id'];
  return {
    room_id: stringField(record, 'room_id'),
    code: stringField(record, 'code'),
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

export function isFixedFiveSupabaseConfigured(): boolean {
  const env = import.meta as unknown as { env?: Record<string, string | undefined> };
  const url = env.env?.VITE_SUPABASE_URL;
  const key = env.env?.VITE_SUPABASE_PUBLISHABLE_KEY;
  return Boolean(url && key);
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
}): FixedFiveMultiplayerTransport {
  if (!options?.url || !options.publishableKey) {
    return createInMemoryFixedFiveTransport();
  }
  const client: FixedFiveClient = supabaseClient(options.url, options.publishableKey);
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
    const phase = row.phase as FixedFiveRoomSnapshot['phase'];
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
    return {
      roomId: row.id,
      code: row.code,
      codeActive: row.code_active,
      settings: row.settings,
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
    };
  }

  async function fetchSnapshot(roomId: string): Promise<FixedFiveRoomSnapshot> {
    const roomResponse = await client
      .from('fixed_five_rooms')
      .select('*')
      .eq('id', roomId)
      .single();
    if (roomResponse.error || !roomResponse.data)
      throw new Error('authorization: cannot read room');
    const memberResponse = await client
      .from('fixed_five_room_members')
      .select('*')
      .eq('room_id', roomId);
    if (memberResponse.error) throw new Error(`members failed: ${memberResponse.error.message}`);
    const row = roomResponse.data as unknown as FixedFiveRoomRow;
    const memberRows = memberResponse.data as unknown as FixedFiveMemberRow[];
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
      return {
        snapshot,
        code: payload.code,
        membership: { roomId: payload.room_id, participantId: 'p1', code: payload.code },
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
      const phase = (typeof record['phase'] === 'string'
        ? record['phase']
        : 'lobby') as FixedFiveRoomSnapshot['phase'];
      const revision = typeof record['revision'] === 'number' ? record['revision'] : 0;
      return {
        roomId: stringField(record, 'room_id'),
        code,
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
      return { snapshot, membership: { roomId: payload.room_id, participantId, code } };
    },
    async resume(roomId) {
      await ensureAnonymous(client);
      const snapshot = await fetchSnapshot(roomId);
      const user = await client.auth.getUser();
      const uid = user.data.user?.id;
      let participantId: FixedFiveParticipantId = 'p1';
      if (uid) {
        const memberResponse = await client
          .from('fixed_five_room_members')
          .select('participant_id')
          .eq('room_id', roomId)
          .eq('uid', uid)
          .single();
        if (!memberResponse.error) {
          const member = memberResponse.data as unknown as { participant_id?: unknown };
          if (member.participant_id === 'p2') participantId = 'p2';
        }
      }
      return { snapshot, membership: { roomId, participantId, code: snapshot.code ?? '0000' } };
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
            if (existing.channel) void existing.channel.unsubscribe();
            rooms.delete(roomId);
          }
        },
      };
    },
    async refetch(roomId, afterOrdinal) {
      await ensureAnonymous(client);
      const response = await client
        .from('fixed_five_room_commands')
        .select('*')
        .eq('room_id', roomId)
        .gt('ordinal', afterOrdinal)
        .order('ordinal', { ascending: true });
      if (response.error) throw new Error(`refetch failed: ${response.error.message}`);
      const rows = response.data as unknown as FixedFiveCommandRow[];
      return rows.map((row) =>
        fixedFiveCommandSchema.parse({
          schemaVersion: 1,
          roomId,
          commandId: row.command_id,
          ordinal: row.ordinal,
          actorParticipantId: row.actor_participant_id,
          payload: row.payload,
        }),
      );
    },
    async submitCommand(command) {
      await ensureAnonymous(client);
      const commandId = command.commandId || randomUUID();
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
      const commandId = typeof record['command_id'] === 'string' ? record['command_id'] : 'timeout';
      return { roomId, commandId, ordinal: -1, accepted: true, rejectionCode: null, revision: 0 };
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
      const phase = (typeof record['phase'] === 'string'
        ? record['phase']
        : 'awaiting-confirmation') as FixedFiveRoomSnapshot['phase'];
      return { completed: record['completed'] === true, phase };
    },
    async fail(roomId) {
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_fail', { p_room_id: roomId });
      if (response.error || !response.data)
        throw new Error(`fail failed: ${response.error?.message ?? 'unknown'}`);
      const record = response.data as unknown as Record<string, unknown>;
      const phase = (typeof record['phase'] === 'string'
        ? record['phase']
        : 'awaiting-confirmation') as FixedFiveRoomSnapshot['phase'];
      return { failed: record['failed'] === true, phase };
    },
  };
}
