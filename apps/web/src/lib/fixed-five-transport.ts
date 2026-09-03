import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  createInMemoryFixedFiveTransport,
  fixedFiveCommandSchema,
  type FixedFiveCommandReceipt,
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
  expires_at: string;
  created_at: string;
  settings: FixedFiveRoomSnapshot['settings'];
  members?: FixedFiveRoomSnapshot['members'];
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
  const rejection = typeof record['rejection_code'] === 'string' ? record['rejection_code'] : undefined;
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

  function roomRowToSnapshot(row: FixedFiveRoomRow): FixedFiveRoomSnapshot {
    const fallbackMembers: FixedFiveRoomSnapshot['members'] = [
      { participantId: 'p1', online: true, ready: false, picksCommitted: 0, locked: false, lastSeenAt: null },
      { participantId: 'p2', online: false, ready: false, picksCommitted: 0, locked: false, lastSeenAt: null },
    ];
    const phase = row.phase as FixedFiveRoomSnapshot['phase'];
    return {
      roomId: row.id,
      code: row.code,
      codeActive: row.code_active,
      settings: row.settings,
      phase,
      revision: row.revision,
      commandCount: row.command_count,
      digest: row.digest,
      members: row.members ?? fallbackMembers,
      rootSeed: null,
      deadline: null,
      resultDigest: row.result_digest,
      confirmedDigest: row.confirmed_digest,
      successorRoomId: row.successor_room_id,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  async function fetchSnapshot(roomId: string): Promise<FixedFiveRoomSnapshot> {
    const response = await client.from('fixed_five_rooms').select('*').eq('id', roomId).single();
    if (response.error || !response.data) throw new Error('authorization: cannot read room');
    const row = response.data as unknown as FixedFiveRoomRow;
    return roomRowToSnapshot(row);
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
      if (response.error || !response.data) throw new Error(`invalid-code: ${response.error?.message ?? code}`);
      const payload = rpcPayload(response.data);
      return fetchSnapshot(payload.room_id);
    },
    async join(code) {
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_room_join', { p_code: code });
      if (response.error || !response.data) throw new Error(`join failed: ${response.error?.message ?? code}`);
      const payload = rpcPayload(response.data);
      const snapshot = await fetchSnapshot(payload.room_id);
      const participantId: FixedFiveParticipantId = payload.participant_id ?? 'p2';
      return { snapshot, membership: { roomId: payload.room_id, participantId, code } };
    },
    async resume(roomId) {
      await ensureAnonymous(client);
      const snapshot = await fetchSnapshot(roomId);
      const memberResponse = await client
        .from('fixed_five_room_members')
        .select('participant_id')
        .eq('room_id', roomId)
        .limit(1)
        .single();
      let participantId: FixedFiveParticipantId = 'p1';
      if (!memberResponse.error) {
        const member = memberResponse.data as unknown as { participant_id?: unknown };
        if (member.participant_id === 'p2') participantId = 'p2';
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
            { event: 'INSERT', schema: 'public', table: 'fixed_five_room_commands', filter: `room_id=eq.${roomId}` },
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
      const expectedRevision = typeof withRevision.expectedRevision === 'number' ? withRevision.expectedRevision : null;
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
      const response = await client.rpc('fixed_five_guest_remove', { p_room_id: roomId, p_target: targetParticipantId });
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
      if (response.error || !response.data) throw new Error(`rematch failed: ${response.error?.message ?? 'unknown'}`);
      const payload = rpcPayload(response.data);
      const snapshot = await fetchSnapshot(payload.room_id);
      return { snapshot, code: payload.code };
    },
  };
}
