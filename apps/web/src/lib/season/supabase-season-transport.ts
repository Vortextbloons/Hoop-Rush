import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  SeasonMultiplayerTransport,
  SeasonRoomPublicSnapshot,
  SeasonRoomSettings,
  SeasonRoomMembership,
  SeasonPublicCommandEnvelope,
  SeasonCommandReceipt,
  SeasonPrivateDecisionSubmission,
  SeasonCheckpointAttestation,
  SeasonAcceptedCheckpoint,
  SeasonRerunRequest,
  SeasonIntegrityFailure2,
  SeasonRoomCode,
  SeasonRoomMode,
  SeasonRoomPace,
} from '@hoop-rush/data-contracts';
import {
  PRESENCE_OFFLINE_AFTER_MS,
  SEASON_MULTIPLAYER_VERSION,
  SEASON_ROOM_PROTOCOL_SCHEMA_VERSION,
  SEASON_TIMER_POLICY_VERSION,
  isSeasonRoomProtocolOutdated,
  seasonRoomPublicSnapshotSchema,
  seasonRoomMembershipSchema,
  seasonPublicCommandEnvelopeSchema,
  seasonCommandReceiptSchema,
  seasonRoomCodeSchema,
  seasonRoomPaceSchema,
  seasonRoomPhaseSchema,
  seasonRoomModeSchema,
  seasonAcceptedCheckpointSchema,
  seasonIntegrityFailureSchema2,
} from '@hoop-rush/data-contracts';
export type SupabaseSeasonTransportConfig = {
  url: string;
  publishableKey: string;
  captchaSiteKey?: string;
};
type SupabaseSeasonTransportState = {
  client: SupabaseClient;
  config: SupabaseSeasonTransportConfig;
};
function getErrorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code: unknown = err.code;
    if (typeof code === 'string' && code.length > 0) return code;
    if (typeof code === 'number') return String(code);
  }
  return undefined;
}
type EdgeParseSuccess<T> = { success: true; data: T };
type EdgeParseFailure = { success: false; error: unknown };
type EdgeResponseSchema<T> = {
  safeParse(value: unknown): EdgeParseSuccess<T> | EdgeParseFailure;
};
type EdgeErrorShape =
  | { tag: 'code-and-message'; code: string; message: string }
  | { tag: 'code-only'; code: string }
  | { tag: 'message-only'; message: string }
  | { tag: 'empty' };
function parseEdgeErrorShape(raw: unknown): EdgeErrorShape {
  if (typeof raw === 'object' && raw !== null) {
    let code: string | undefined;
    let message: string | undefined;
    if ('code' in raw) {
      const candidate: unknown = raw.code;
      if (typeof candidate === 'string' && candidate.length > 0) code = candidate;
    }
    if ('message' in raw) {
      const candidate: unknown = raw.message;
      if (typeof candidate === 'string' && candidate.length > 0) message = candidate;
    }
    if (code !== undefined && message !== undefined)
      return { tag: 'code-and-message', code, message };
    if (code !== undefined) return { tag: 'code-only', code };
    if (message !== undefined) return { tag: 'message-only', message };
  } else if (typeof raw === 'string' && raw.length > 0) {
    return { tag: 'message-only', message: raw };
  }
  return { tag: 'empty' };
}
function edgeErrorFromShape(
  shape: EdgeErrorShape,
  fallbackText: string,
  status: number,
): { code: string; message: string } {
  switch (shape.tag) {
    case 'code-and-message':
      return { code: shape.code, message: shape.message };
    case 'code-only':
      return { code: shape.code, message: fallbackText || `request failed ${status}` };
    case 'message-only':
      return { code: 'authorization', message: shape.message };
    case 'empty':
      return { code: 'authorization', message: fallbackText || `request failed ${status}` };
  }
}
let _memoDevUid: string | null = null;
let heartbeatFnMissing = false;
function getOrCreateDevUid(): string {
  if (_memoDevUid && /^[0-9a-f-]{36}$/.test(_memoDevUid)) return _memoDevUid;
  try {
    if (typeof localStorage !== 'undefined') {
      let uid = localStorage.getItem('hoop-rush:dev-uid');
      if (uid && /^[0-9a-f-]{36}$/.test(uid)) {
        _memoDevUid = uid;
        return uid;
      }
      uid = crypto.randomUUID();
      try {
        localStorage.setItem('hoop-rush:dev-uid', uid);
      } catch {}
      _memoDevUid = uid;
      return uid;
    }
  } catch {}
  if (_memoDevUid) return _memoDevUid;
  _memoDevUid = crypto.randomUUID();
  return _memoDevUid;
}
async function ensureAnonAuth(client: SupabaseClient): Promise<void> {
  const { data } = await client.auth.getSession();
  if (data.session) return;
  const { error } = await client.auth.signInAnonymously();
  if (!error) return;
  let code = '';
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const candidate: unknown = error.code;
    if (typeof candidate === 'string') code = candidate;
  }
  const message =
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
      ? error.message
      : 'anonymous sign-in failed';
  const isAnonDisabled =
    code === 'anonymous_provider_disabled' || message.toLowerCase().includes('anonymous');
  if (!isAnonDisabled)
    throw Object.assign(new Error(`anonymous sign-in failed: ${message}`), {
      code: 'authorization',
    });
  getOrCreateDevUid();
}
async function callEdge<T>(
  client: SupabaseClient,
  config: SupabaseSeasonTransportConfig,
  fn: string,
  body: unknown,
  schema: EdgeResponseSchema<T>,
  captchaSiteKey?: string,
): Promise<T> {
  await ensureAnonAuth(client);
  const { data: sess } = await client.auth.getSession();
  const token = sess.session?.access_token;
  const devUid = (() => {
    if (_memoDevUid && /^[0-9a-f-]{36}$/.test(_memoDevUid)) return _memoDevUid;
    try {
      if (typeof localStorage !== 'undefined') {
        const v = localStorage.getItem('hoop-rush:dev-uid');
        if (v && /^[0-9a-f-]{36}$/.test(v)) {
          _memoDevUid = v;
          return v;
        }
      }
    } catch {}
    return _memoDevUid;
  })();
  const headers: Record<string, string> = {
    apikey: config.publishableKey,
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  else if (devUid) headers['x-dev-uid'] = devUid;
  else throw Object.assign(new Error('missing session token'), { code: 'authorization' });
  if (captchaSiteKey) headers['x-captcha-token'] = captchaSiteKey;
  if (devUid) headers['x-dev-uid'] = devUid;
  const res = await fetch(`${config.url.replace(/\/$/, '')}/functions/v1/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let raw: unknown = null;
  try {
    raw = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    raw = text ? { message: text } : null;
  }
  if (!res.ok) {
    const shape = parseEdgeErrorShape(raw);
    const { code, message } = edgeErrorFromShape(shape, text, res.status);
    throw Object.assign(new Error(message), { code, status: res.status, body: raw });
  }
  const checked = schema.safeParse(raw);
  if (!checked.success) {
    throw Object.assign(new Error(`invalid ${fn} response`), {
      code: 'authorization',
      status: res.status,
      body: raw,
    });
  }
  return checked.data;
}
function parseEnvelopeList(raw: unknown): SeasonPublicCommandEnvelope[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SeasonPublicCommandEnvelope[] = [];
  for (const item of raw) {
    const parsed = seasonPublicCommandEnvelopeSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
type SnapshotOnlyResponse = { snapshot: SeasonRoomPublicSnapshot };
const snapshotOnlySchema: EdgeResponseSchema<SnapshotOnlyResponse> = {
  safeParse(value: unknown) {
    if (typeof value !== 'object' || value === null || !('snapshot' in value))
      return { success: false, error: new Error('missing snapshot') };
    const parsed = seasonRoomPublicSnapshotSchema.safeParse(value.snapshot);
    if (!parsed.success) return { success: false, error: parsed.error };
    return { success: true, data: { snapshot: parsed.data } };
  },
};
type MembershipOnlyResponse = { membership: SeasonRoomMembership };
const membershipOnlySchema: EdgeResponseSchema<MembershipOnlyResponse> = {
  safeParse(value: unknown) {
    if (typeof value !== 'object' || value === null || !('membership' in value))
      return { success: false, error: new Error('missing membership') };
    const parsed = seasonRoomMembershipSchema.safeParse(value.membership);
    if (!parsed.success) return { success: false, error: parsed.error };
    return { success: true, data: { membership: parsed.data } };
  },
};
type CreateResponse = {
  snapshot: SeasonRoomPublicSnapshot;
  code: string;
  roomId: string;
  membership?: SeasonRoomMembership;
};
const createResponseSchema: EdgeResponseSchema<CreateResponse> = {
  safeParse(value: unknown) {
    if (typeof value !== 'object' || value === null)
      return { success: false, error: new Error('invalid create response') };
    if (!('snapshot' in value) || !('code' in value) || !('roomId' in value))
      return { success: false, error: new Error('missing create fields') };
    const snapshot = seasonRoomPublicSnapshotSchema.safeParse(value.snapshot);
    if (!snapshot.success) return { success: false, error: snapshot.error };
    const code = seasonRoomCodeSchema.safeParse(value.code);
    if (!code.success) return { success: false, error: code.error };
    const roomId: unknown = value.roomId;
    if (typeof roomId !== 'string' || roomId.length === 0)
      return { success: false, error: new Error('invalid roomId') };
    if ('membership' in value && value.membership !== undefined) {
      const membership = seasonRoomMembershipSchema.safeParse(value.membership);
      if (!membership.success) return { success: false, error: membership.error };
      return {
        success: true,
        data: { snapshot: snapshot.data, code: code.data, roomId, membership: membership.data },
      };
    }
    return { success: true, data: { snapshot: snapshot.data, code: code.data, roomId } };
  },
};
type ResumeResponse = {
  snapshot: SeasonRoomPublicSnapshot;
  membership?: SeasonRoomMembership;
  commands?: SeasonPublicCommandEnvelope[];
};
const resumeResponseSchema: EdgeResponseSchema<ResumeResponse> = {
  safeParse(value: unknown) {
    if (typeof value !== 'object' || value === null || !('snapshot' in value))
      return { success: false, error: new Error('missing snapshot') };
    const snapshot = seasonRoomPublicSnapshotSchema.safeParse(value.snapshot);
    if (!snapshot.success) return { success: false, error: snapshot.error };
    const out: ResumeResponse = { snapshot: snapshot.data };
    if ('membership' in value && value.membership !== undefined) {
      const membership = seasonRoomMembershipSchema.safeParse(value.membership);
      if (!membership.success) return { success: false, error: membership.error };
      out.membership = membership.data;
    }
    if ('commands' in value && value.commands !== undefined) {
      const commands = parseEnvelopeList(value.commands);
      if (commands === null) return { success: false, error: new Error('invalid commands') };
      out.commands = commands;
    }
    return { success: true, data: out };
  },
};
type RefetchResponse = { commands: SeasonPublicCommandEnvelope[] };
const refetchResponseSchema: EdgeResponseSchema<RefetchResponse> = {
  safeParse(value: unknown) {
    if (typeof value !== 'object' || value === null || !('commands' in value))
      return { success: false, error: new Error('missing commands') };
    const commands = parseEnvelopeList(value.commands);
    if (commands === null) return { success: false, error: new Error('invalid commands') };
    return { success: true, data: { commands } };
  },
};
type ReceiptResponse = { receipt: SeasonCommandReceipt };
const receiptResponseSchema: EdgeResponseSchema<ReceiptResponse> = {
  safeParse(value: unknown) {
    if (typeof value !== 'object' || value === null || !('receipt' in value))
      return { success: false, error: new Error('missing receipt') };
    const parsed = seasonCommandReceiptSchema.safeParse(value.receipt);
    if (!parsed.success) return { success: false, error: parsed.error };
    return { success: true, data: { receipt: parsed.data } };
  },
};
type LockedResponse = { locked: boolean };
const lockedResponseSchema: EdgeResponseSchema<LockedResponse> = {
  safeParse(value: unknown) {
    if (typeof value !== 'object' || value === null || !('locked' in value))
      return { success: false, error: new Error('missing locked') };
    const locked: unknown = value.locked;
    if (typeof locked !== 'boolean') return { success: false, error: new Error('invalid locked') };
    return { success: true, data: { locked } };
  },
};
type OkResponse = { ok: boolean };
const okResponseSchema: EdgeResponseSchema<OkResponse> = {
  safeParse(value: unknown) {
    if (typeof value !== 'object' || value === null || !('ok' in value))
      return { success: false, error: new Error('missing ok') };
    const ok: unknown = value.ok;
    if (typeof ok !== 'boolean') return { success: false, error: new Error('invalid ok') };
    return { success: true, data: { ok } };
  },
};
type CodeResponse = { code: SeasonRoomCode };
const codeResponseSchema: EdgeResponseSchema<CodeResponse> = {
  safeParse(value: unknown) {
    if (typeof value !== 'object' || value === null || !('code' in value))
      return { success: false, error: new Error('missing code') };
    const parsed = seasonRoomCodeSchema.safeParse(value.code);
    if (!parsed.success) return { success: false, error: parsed.error };
    return { success: true, data: { code: parsed.data } };
  },
};
type AttestResponse =
  | { kind: 'accepted'; accepted: SeasonAcceptedCheckpoint }
  | { kind: 'rerun'; reason: string; attempt: number }
  | { kind: 'integrity-failed'; failure: SeasonIntegrityFailure2 };
const attestResponseSchema: EdgeResponseSchema<AttestResponse> = {
  safeParse(value: unknown) {
    if (typeof value !== 'object' || value === null || !('kind' in value))
      return { success: false, error: new Error('missing kind') };
    const kind: unknown = value.kind;
    switch (kind) {
      case 'accepted': {
        if (!('accepted' in value)) return { success: false, error: new Error('missing accepted') };
        const parsed = seasonAcceptedCheckpointSchema.safeParse(value.accepted);
        if (!parsed.success) return { success: false, error: parsed.error };
        return { success: true, data: { kind: 'accepted', accepted: parsed.data } };
      }
      case 'rerun': {
        if (!('reason' in value) || !('attempt' in value))
          return { success: false, error: new Error('missing rerun fields') };
        const reason: unknown = value.reason;
        const attempt: unknown = value.attempt;
        if (typeof reason !== 'string' || typeof attempt !== 'number' || !Number.isFinite(attempt))
          return { success: false, error: new Error('invalid rerun fields') };
        return { success: true, data: { kind: 'rerun', reason, attempt } };
      }
      case 'integrity-failed': {
        if (!('failure' in value)) return { success: false, error: new Error('missing failure') };
        const parsed = seasonIntegrityFailureSchema2.safeParse(value.failure);
        if (!parsed.success) return { success: false, error: parsed.error };
        return { success: true, data: { kind: 'integrity-failed', failure: parsed.data } };
      }
      default:
        return { success: false, error: new Error('unknown attest kind') };
    }
  },
};
const unknownPassthroughSchema: EdgeResponseSchema<unknown> = {
  safeParse(value: unknown) {
    return { success: true, data: value };
  },
};
function realtimeNewRow(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'object' || payload === null) return null;
  if (!('new' in payload)) return null;
  const raw: unknown = payload.new;
  if (typeof raw !== 'object' || raw === null) return null;
  return Object.fromEntries(Object.entries(raw));
}
function toPublicSnapshot(
  row: {
    id: string;
    pace: string;
    mode?: string | null;
    room_protocol_version: number;
    multiplayer_version: string;
    timer_policy_version: string;
    phase: string;
    cursor: string;
    revision: number;
    digest: string;
    code: string | null;
    code_expires_at: string | null;
    guest_ready?: boolean | null;
    settings_revision?: number | null;
    root_seed?: string | null;
    seed?: string | null;
    presence?: Array<{
      participantId: 'p1' | 'p2';
      online: boolean;
      lastSeenAt: string;
    }> | null;
    members?: Array<{
      participant_id: string;
      last_seen_at?: string | null;
    }>;
    locks?: SeasonRoomPublicSnapshot['locks'];
    attestationSummary?: SeasonRoomPublicSnapshot['attestationSummary'];
  },
  memberCount = 0,
): SeasonRoomPublicSnapshot {
  const isOutdated = isSeasonRoomProtocolOutdated(row);
  let presence: SeasonRoomPublicSnapshot['presence'] = [];
  if (row.presence) {
    presence = row.presence.filter(
      (entry): entry is SeasonRoomPublicSnapshot['presence'][number] =>
        (entry.participantId === 'p1' || entry.participantId === 'p2') &&
        typeof entry.online === 'boolean' &&
        typeof entry.lastSeenAt === 'string',
    );
  } else if (row.members) {
    const now = Date.now();
    for (const m of row.members) {
      if (m.participant_id !== 'p1' && m.participant_id !== 'p2') continue;
      const lastSeenAt =
        typeof m.last_seen_at === 'string' ? m.last_seen_at : new Date(now).toISOString();
      const lastSeen = m.last_seen_at ? new Date(m.last_seen_at).getTime() : now;
      presence.push({
        participantId: m.participant_id,
        online: now - lastSeen <= PRESENCE_OFFLINE_AFTER_MS,
        lastSeenAt,
      });
    }
  }
  const seed = row.root_seed ?? row.seed ?? null;
  const pace = seasonRoomPaceSchema.safeParse(row.pace);
  if (!pace.success) throw new Error('invalid room pace');
  const mode = seasonRoomModeSchema.safeParse(row.mode ?? 'season');
  if (!mode.success) throw new Error('invalid room mode');
  const phase = seasonRoomPhaseSchema.safeParse(row.phase);
  if (!phase.success) throw new Error('invalid room phase');
  return {
    roomId: row.id,
    settings: {
      schemaVersion: SEASON_ROOM_PROTOCOL_SCHEMA_VERSION,
      pace: pace.data,
      mode: mode.data,
      roomProtocolVersion: SEASON_ROOM_PROTOCOL_SCHEMA_VERSION,
      multiplayerVersion: SEASON_MULTIPLAYER_VERSION,
      timerPolicyVersion: SEASON_TIMER_POLICY_VERSION,
    },
    phase: phase.data,
    cursor: row.cursor,
    revision: row.revision,
    digest: row.digest,
    memberCount,
    codeActive:
      !!row.code && !!row.code_expires_at && new Date(row.code_expires_at).getTime() > Date.now(),
    expiresAt: row.code_expires_at,
    mode: mode.data,
    settingsRevision:
      typeof row.settings_revision === 'number' && Number.isFinite(row.settings_revision)
        ? row.settings_revision
        : 0,
    guestReady: row.guest_ready === true,
    presence,
    seed: seed,
    isOutdated: isOutdated || undefined,
    locks: row.locks,
    attestationSummary: row.attestationSummary,
  };
}
export function createSupabaseSeasonTransport(
  config: SupabaseSeasonTransportConfig,
): SeasonMultiplayerTransport {
  if (!config.url || !config.publishableKey) {
    const notConfigured = (op: string): never => {
      throw Object.assign(
        new Error(
          `Supabase not configured: ${op} requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY`,
        ),
        { code: 'authorization' },
      );
    };
    return {
      async create() {
        return notConfigured('create');
      },
      async preview() {
        return notConfigured('preview');
      },
      async join() {
        return notConfigured('join');
      },
      async resume() {
        return notConfigured('resume');
      },
      async refresh() {
        return notConfigured('refresh');
      },
      subscribe() {
        return { unsubscribe() {} };
      },
      async refetch() {
        return notConfigured('refetch');
      },
      async submitCommand() {
        return notConfigured('submitCommand');
      },
      async submitPrivateDecision() {
        return notConfigured('submitPrivateDecision');
      },
      async publishAttestation() {
        return notConfigured('publishAttestation');
      },
      async requestReclaim() {
        return notConfigured('requestReclaim');
      },
      async surrender() {
        return notConfigured('surrender');
      },
      async preDraftRemoval() {
        return notConfigured('preDraftRemoval');
      },
      async close() {
        return notConfigured('close');
      },
      async startDraft() {
        return notConfigured('startDraft');
      },
      async updateSettings() {
        return notConfigured('updateSettings');
      },
      async setReady() {
        return notConfigured('setReady');
      },
      async heartbeat() {
        return notConfigured('heartbeat');
      },
      async leave() {
        return notConfigured('leave');
      },
    };
  }
  const _clientKey = `${config.url}::${config.publishableKey}`;
  const _global = globalThis as unknown as {
    __hoopRushSupabaseClients?: Map<string, SupabaseClient>;
  };
  if (!(_global.__hoopRushSupabaseClients instanceof Map))
    _global.__hoopRushSupabaseClients = new Map();
  let client = _global.__hoopRushSupabaseClients.get(_clientKey);
  if (!client) {
    client = createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: `sb-${config.url}-auth-token`,
      },
    });
    _global.__hoopRushSupabaseClients.set(_clientKey, client);
  }
  const envelopeCacheByRoom = new Map<string, Map<number, SeasonPublicCommandEnvelope>>();
  const inflightSnapByRoom = new Map<string, Promise<SeasonRoomPublicSnapshot | null>>();
  const getMemberCount = async (roomId: string): Promise<number> => {
    try {
      const snap = await callEdge(
        client,
        config,
        'season-room-resume',
        { roomId },
        snapshotOnlySchema,
      );
      return snap.snapshot.memberCount ?? 0;
    } catch {
      await ensureAnonAuth(client);
      const { count } = await client
        .from('season_room_members')
        .select('participant_id', { count: 'exact', head: true })
        .eq('room_id', roomId);
      return count ?? 0;
    }
  };
  return {
    async create(
      settings: SeasonRoomSettings,
      rootSeed: string,
    ): Promise<
      SeasonRoomPublicSnapshot & {
        code?: string;
        membership?: SeasonRoomMembership;
      }
    > {
      const res = await callEdge(
        client,
        config,
        'season-room-create',
        {
          pace: settings.pace,
          mode: settings.mode ?? 'season',
          rootSeed,
        },
        createResponseSchema,
        config.captchaSiteKey,
      );
      const snap: SeasonRoomPublicSnapshot & {
        code?: string;
        membership?: SeasonRoomMembership;
      } = { ...res.snapshot, code: res.code };
      if (res.membership) snap.membership = res.membership;
      if (!snap.settings.mode) {
        snap.settings = { ...snap.settings, mode: settings.mode ?? 'season' };
      }
      return snap;
    },
    async preview(code: string): Promise<SeasonRoomPublicSnapshot> {
      const res = await callEdge(
        client,
        config,
        'season-room-preview',
        { code },
        snapshotOnlySchema,
        config.captchaSiteKey,
      );
      return res.snapshot;
    },
    async join(code: string): Promise<SeasonRoomMembership> {
      const res = await callEdge(
        client,
        config,
        'season-room-join',
        { code },
        membershipOnlySchema,
        config.captchaSiteKey,
      );
      return res.membership;
    },
    async resume(
      roomId: string,
      afterOrdinal?: number,
    ): Promise<
      SeasonRoomPublicSnapshot & {
        membership?: SeasonRoomMembership;
        commands?: SeasonPublicCommandEnvelope[];
      }
    > {
      const body: Record<string, unknown> = { roomId };
      if (typeof afterOrdinal === 'number' && Number.isFinite(afterOrdinal))
        body.afterOrdinal = afterOrdinal;
      const res = await callEdge(client, config, 'season-room-resume', body, resumeResponseSchema);
      const snap: SeasonRoomPublicSnapshot & {
        membership?: SeasonRoomMembership;
        commands?: SeasonPublicCommandEnvelope[];
      } = { ...res.snapshot };
      if (res.membership) snap.membership = res.membership;
      if (Array.isArray(res.commands) && res.commands.length > 0) {
        let byOrd = envelopeCacheByRoom.get(roomId);
        if (!byOrd) {
          byOrd = new Map();
          envelopeCacheByRoom.set(roomId, byOrd);
        }
        for (const c of res.commands) byOrd.set(c.ordinal, c);
        if (byOrd.size > 200) {
          const sortedKeys = [...byOrd.keys()].sort((a, b) => a - b);
          for (let i = 0; i < sortedKeys.length - 200; i += 1) byOrd.delete(sortedKeys[i]!);
        }
        snap.commands = res.commands;
      }
      return snap;
    },
    async refresh(roomId: string): Promise<
      SeasonRoomPublicSnapshot & {
        membership?: SeasonRoomMembership;
      }
    > {
      const res = await callEdge(
        client,
        config,
        'season-room-resume',
        { roomId },
        resumeResponseSchema,
      );
      const snap: SeasonRoomPublicSnapshot & {
        membership?: SeasonRoomMembership;
        commands?: SeasonPublicCommandEnvelope[];
      } = { ...res.snapshot };
      if (res.membership) snap.membership = res.membership;
      if (Array.isArray(res.commands) && res.commands.length > 0) {
        snap.commands = res.commands;
      }
      return snap;
    },
    subscribe(roomId: string, handler: (snap: SeasonRoomPublicSnapshot) => void) {
      let closed = false;
      let channel: ReturnType<SupabaseClient['channel']> | null = null;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let backgroundPollTimer: ReturnType<typeof setInterval> | null = null;
      let lastSnap: SeasonRoomPublicSnapshot | null = null;
      function envelopeFromRealtimeRow(
        row: Record<string, unknown>,
      ): SeasonPublicCommandEnvelope | null {
        try {
          const commandId: unknown = row['command_id'] ?? row['commandId'];
          const ordinal: unknown = row['ordinal'];
          const runId: unknown = row['run_id'] ?? row['runId'];
          const payload: unknown = row['payload'] ?? row['envelope'];
          const actorParticipantId: unknown =
            row['actor_participant_id'] ?? row['actorParticipantId'];
          const actorFranchiseId: unknown = row['actor_franchise_id'] ?? row['actorFranchiseId'];
          if (typeof commandId !== 'string' || typeof ordinal !== 'number' || payload == null)
            return null;
          if (
            typeof payload === 'object' &&
            payload !== null &&
            'commandId' in payload &&
            'ordinal' in payload
          ) {
            const nestedCommandId: unknown = payload.commandId;
            const nestedOrdinal: unknown = payload.ordinal;
            if (typeof nestedCommandId === 'string' && typeof nestedOrdinal === 'number') {
              const parsed = seasonPublicCommandEnvelopeSchema.safeParse(payload);
              if (!parsed.success) return null;
              if (parsed.data.roomId !== roomId) return null;
              return parsed.data;
            }
          }
          if (
            typeof runId !== 'string' ||
            (actorParticipantId !== 'p1' && actorParticipantId !== 'p2') ||
            typeof actorFranchiseId !== 'string'
          )
            return null;
          const candidate: unknown = {
            schemaVersion: SEASON_ROOM_PROTOCOL_SCHEMA_VERSION,
            roomId,
            commandId,
            ordinal,
            runId,
            payload,
            actorParticipantId,
            actorFranchiseId,
          };
          const parsed = seasonPublicCommandEnvelopeSchema.safeParse(candidate);
          if (!parsed.success) return null;
          return parsed.data;
        } catch {
          return null;
        }
      }
      const fetchSnap = async (): Promise<SeasonRoomPublicSnapshot | null> => {
        try {
          const byOrd = envelopeCacheByRoom.get(roomId);
          const body: Record<string, unknown> = { roomId };
          if (byOrd && byOrd.size > 0) {
            const maxOrdinal = Math.max(...byOrd.keys());
            if (Number.isFinite(maxOrdinal)) body.afterOrdinal = maxOrdinal;
          }
          const res = await callEdge(
            client,
            config,
            'season-room-resume',
            body,
            resumeResponseSchema,
          );
          if (Array.isArray(res.commands)) {
            for (const c of res.commands) {
              cacheEnvelope(c);
            }
          }
          if (res.snapshot) lastSnap = res.snapshot;
          return res.snapshot;
        } catch {
          return null;
        }
      };
      function synthesizeRoomsSnapshot(
        row: Record<string, unknown>,
      ): SeasonRoomPublicSnapshot | null {
        try {
          const id: unknown = row['id'];
          const phase: unknown = row['phase'];
          if (typeof id !== 'string' || typeof phase !== 'string') return null;
          const mc = lastSnap?.memberCount ?? 0;
          const paceRaw: unknown = 'pace' in row ? row['pace'] : lastSnap?.settings.pace;
          const pace = typeof paceRaw === 'string' ? paceRaw : 'live';
          const modeRaw: unknown = 'mode' in row ? row['mode'] : lastSnap?.mode;
          const mode = typeof modeRaw === 'string' ? modeRaw : 'season';
          const protocolRaw: unknown =
            'room_protocol_version' in row
              ? row['room_protocol_version']
              : lastSnap?.settings.roomProtocolVersion;
          const roomProtocolVersion =
            typeof protocolRaw === 'number' && Number.isFinite(protocolRaw) ? protocolRaw : 2;
          const mpRaw: unknown =
            'multiplayer_version' in row
              ? row['multiplayer_version']
              : lastSnap?.settings.multiplayerVersion;
          const multiplayerVersion = typeof mpRaw === 'string' ? mpRaw : 'season-multiplayer-v2';
          const timerRaw: unknown =
            'timer_policy_version' in row
              ? row['timer_policy_version']
              : lastSnap?.settings.timerPolicyVersion;
          const timerPolicyVersion = typeof timerRaw === 'string' ? timerRaw : 'season-timers-v1';
          const cursorRaw: unknown = 'cursor' in row ? row['cursor'] : lastSnap?.cursor;
          const cursor = typeof cursorRaw === 'string' ? cursorRaw : 'draft-0';
          const revisionRaw: unknown = 'revision' in row ? row['revision'] : lastSnap?.revision;
          const revision =
            typeof revisionRaw === 'number' && Number.isFinite(revisionRaw) ? revisionRaw : 0;
          const digestRaw: unknown = 'digest' in row ? row['digest'] : lastSnap?.digest;
          const digest = typeof digestRaw === 'string' ? digestRaw : '0'.repeat(64);
          const codeRaw: unknown = 'code' in row ? row['code'] : null;
          const code = typeof codeRaw === 'string' ? codeRaw : null;
          const expiresRaw: unknown =
            'code_expires_at' in row ? row['code_expires_at'] : lastSnap?.expiresAt;
          const codeExpiresAt = typeof expiresRaw === 'string' ? expiresRaw : null;
          const guestRaw: unknown =
            'guest_ready' in row ? row['guest_ready'] : lastSnap?.guestReady;
          const guestReady = guestRaw === true;
          const settingsRevRaw: unknown =
            'settings_revision' in row ? row['settings_revision'] : lastSnap?.settingsRevision;
          const settingsRevision =
            typeof settingsRevRaw === 'number' && Number.isFinite(settingsRevRaw)
              ? settingsRevRaw
              : 0;
          const rootSeedRaw: unknown = 'root_seed' in row ? row['root_seed'] : lastSnap?.seed;
          const rootSeed = typeof rootSeedRaw === 'string' ? rootSeedRaw : null;
          const seedRaw: unknown = 'seed' in row ? row['seed'] : lastSnap?.seed;
          const seed = typeof seedRaw === 'string' ? seedRaw : rootSeed;
          const locksRaw: unknown = 'locks' in row ? row['locks'] : lastSnap?.locks;
          let locks: SeasonRoomPublicSnapshot['locks'] = lastSnap?.locks;
          if (typeof locksRaw === 'object' && locksRaw !== null) {
            if (
              'p1Locked' in locksRaw &&
              'p2Locked' in locksRaw &&
              'revealed' in locksRaw &&
              'cursor' in locksRaw
            ) {
              const p1: unknown = locksRaw.p1Locked;
              const p2: unknown = locksRaw.p2Locked;
              const revealed: unknown = locksRaw.revealed;
              const lockCursor: unknown = locksRaw.cursor;
              if (
                typeof p1 === 'boolean' &&
                typeof p2 === 'boolean' &&
                typeof revealed === 'boolean' &&
                typeof lockCursor === 'string'
              ) {
                locks = { p1Locked: p1, p2Locked: p2, revealed, cursor: lockCursor };
              }
            }
          }
          const attestationRaw: unknown =
            'attestationSummary' in row ? row['attestationSummary'] : lastSnap?.attestationSummary;
          let attestationSummary: SeasonRoomPublicSnapshot['attestationSummary'] =
            lastSnap?.attestationSummary;
          if (typeof attestationRaw === 'object' && attestationRaw !== null) {
            if (
              'cursor' in attestationRaw &&
              'attempt' in attestationRaw &&
              'count' in attestationRaw &&
              'verified' in attestationRaw
            ) {
              const aCursor: unknown = attestationRaw.cursor;
              const aAttempt: unknown = attestationRaw.attempt;
              const aCount: unknown = attestationRaw.count;
              const aVerified: unknown = attestationRaw.verified;
              if (
                typeof aCursor === 'string' &&
                typeof aAttempt === 'number' &&
                Number.isFinite(aAttempt) &&
                typeof aCount === 'number' &&
                Number.isFinite(aCount) &&
                (typeof aVerified === 'boolean' || aVerified === null)
              ) {
                const aInput: unknown =
                  'inputDigest' in attestationRaw ? attestationRaw.inputDigest : null;
                const aResult: unknown =
                  'resultDigest' in attestationRaw ? attestationRaw.resultDigest : null;
                attestationSummary = {
                  cursor: aCursor,
                  attempt: aAttempt,
                  count: aCount,
                  verified: aVerified,
                  inputDigest: typeof aInput === 'string' ? aInput : null,
                  resultDigest: typeof aResult === 'string' ? aResult : null,
                };
              }
            }
          }
          const snap = toPublicSnapshot(
            {
              id,
              pace,
              mode,
              room_protocol_version: roomProtocolVersion,
              multiplayer_version: multiplayerVersion,
              timer_policy_version: timerPolicyVersion,
              phase,
              cursor,
              revision,
              digest,
              code,
              code_expires_at: codeExpiresAt,
              guest_ready: guestReady,
              settings_revision: settingsRevision,
              root_seed: rootSeed,
              seed,
              presence: lastSnap?.presence ?? undefined,
              locks,
              attestationSummary,
            },
            mc,
          );
          if (!row.presence && lastSnap?.presence) snap.presence = lastSnap.presence;
          if (!snap.locks && lastSnap?.locks) snap.locks = lastSnap.locks;
          if (!snap.attestationSummary && lastSnap?.attestationSummary)
            snap.attestationSummary = lastSnap.attestationSummary;
          return snap;
        } catch {
          return null;
        }
      }
      function patchLocksFromDecision(
        row: Record<string, unknown>,
      ): SeasonRoomPublicSnapshot | null {
        if (!lastSnap) return null;
        const pidRaw: unknown = row['participant_id'] ?? row['participantId'];
        if (pidRaw !== 'p1' && pidRaw !== 'p2') return null;
        const cursorRaw: unknown = row['cursor'];
        const cursor = typeof cursorRaw === 'string' ? cursorRaw : lastSnap.cursor;
        const existing = lastSnap.locks;
        const p1Locked = existing?.p1Locked || pidRaw === 'p1';
        const p2Locked = existing?.p2Locked || pidRaw === 'p2';
        const revealed = p1Locked && p2Locked ? true : (existing?.revealed ?? false);
        const next: SeasonRoomPublicSnapshot = {
          ...lastSnap,
          revision: (lastSnap.revision ?? 0) + 1,
          locks: { p1Locked, p2Locked, revealed, cursor },
        };
        if (p1Locked && p2Locked && lastSnap.phase !== 'simulation') {
          next.phase = 'simulation';
        }
        lastSnap = next;
        return next;
      }
      function patchAttestationFromRow(
        row: Record<string, unknown>,
      ): SeasonRoomPublicSnapshot | null {
        if (!lastSnap) return null;
        const attemptRaw: unknown = row['attempt'];
        const attempt =
          typeof attemptRaw === 'number' && Number.isFinite(attemptRaw) ? attemptRaw : 1;
        const pidRaw: unknown = row['participant_id'] ?? row['participantId'];
        if (pidRaw !== 'p1' && pidRaw !== 'p2') return null;
        const prev = lastSnap.attestationSummary;
        const cursorRaw: unknown = row['cursor'];
        const cursor = typeof cursorRaw === 'string' ? cursorRaw : lastSnap.cursor;
        const inputRaw: unknown = row['input_digest'];
        const inputDigest = typeof inputRaw === 'string' ? inputRaw : null;
        const resultRaw: unknown = row['result_digest'];
        const resultDigest = typeof resultRaw === 'string' ? resultRaw : null;
        let nextSummary: SeasonRoomPublicSnapshot['attestationSummary'];
        if (!prev || prev.cursor !== cursor || prev.attempt !== attempt) {
          nextSummary = {
            cursor,
            attempt,
            count: 1,
            verified: null,
            inputDigest,
            resultDigest,
          };
        } else {
          const count = 2;
          const aDigest = prev.inputDigest;
          const bDigest = inputDigest;
          const aRes = prev.resultDigest;
          const bRes = resultDigest;
          const verified =
            aDigest && bDigest && aRes && bRes ? aDigest === bDigest && aRes === bRes : null;
          nextSummary = {
            cursor,
            attempt,
            count,
            verified,
            inputDigest: prev.inputDigest,
            resultDigest: prev.resultDigest,
          };
        }
        const next: SeasonRoomPublicSnapshot = {
          ...lastSnap,
          attestationSummary: nextSummary,
          revision: (lastSnap.revision ?? 0) + 1,
        };
        lastSnap = next;
        return next;
      }
      const coalescedFetchSnap = async (): Promise<SeasonRoomPublicSnapshot | null> => {
        const existing = inflightSnapByRoom.get(roomId);
        if (existing) return existing;
        const p = fetchSnap().finally(() => {
          if (inflightSnapByRoom.get(roomId) === p) inflightSnapByRoom.delete(roomId);
        });
        inflightSnapByRoom.set(roomId, p);
        return p;
      };
      function cacheEnvelope(env: SeasonPublicCommandEnvelope): void {
        let byOrd = envelopeCacheByRoom.get(roomId);
        if (!byOrd) {
          byOrd = new Map();
          envelopeCacheByRoom.set(roomId, byOrd);
        }
        byOrd.set(env.ordinal, env);
        if (byOrd.size > 200) {
          const sorted = [...byOrd.keys()].sort((a, b) => a - b);
          for (let i = 0; i < sorted.length - 200; i += 1) byOrd.delete(sorted[i]!);
        }
      }
      const start = async () => {
        await ensureAnonAuth(client);
        let realtimeOk = false;
        const startPoll = () => {
          if (pollTimer || closed) return;
          let pollInFlight = false;
          pollTimer = setInterval(async () => {
            if (closed || pollInFlight) return;
            pollInFlight = true;
            try {
              const snap = await fetchSnap();
              if (snap && !closed) handler(snap);
            } finally {
              pollInFlight = false;
            }
          }, 5000);
        };
        const startBackgroundPoll = () => {
          if (backgroundPollTimer || closed) return;
          let bgInFlight = false;
          const intervalMs = (() => {
            const phase = lastSnap?.phase;
            if (phase === 'waiting' || phase === 'drafting') return 5000;
            return 10000;
          })();
          backgroundPollTimer = setInterval(async () => {
            if (closed || bgInFlight) return;
            bgInFlight = true;
            try {
              const snap = await fetchSnap();
              if (snap && !closed) handler(snap);
            } finally {
              bgInFlight = false;
            }
          }, intervalMs);
        };
        const restartBackgroundPoll = () => {
          if (backgroundPollTimer) {
            clearInterval(backgroundPollTimer);
            backgroundPollTimer = null;
          }
          startBackgroundPoll();
        };
        const stopBackgroundPoll = () => {
          if (backgroundPollTimer) {
            clearInterval(backgroundPollTimer);
            backgroundPollTimer = null;
          }
        };
        try {
          channel = client
            .channel(`season-room-${roomId}`)
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'season_rooms', filter: `id=eq.${roomId}` },
              (payload: unknown) => {
                void (async () => {
                  try {
                    const row = realtimeNewRow(payload);
                    if (row) {
                      const optimistic = synthesizeRoomsSnapshot(row);
                      if (optimistic && !closed) {
                        lastSnap = optimistic;
                        handler(optimistic);
                      }
                    }
                  } catch {}
                  const snap = await coalescedFetchSnap();
                  if (snap && !closed) {
                    handler(snap);
                    restartBackgroundPoll();
                  }
                })();
              },
            )
            .on(
              'postgres_changes',
              {
                event: 'INSERT',
                schema: 'public',
                table: 'season_room_commands',
                filter: `room_id=eq.${roomId}`,
              },
              (payload: unknown) => {
                void (async () => {
                  let cachedEnv: SeasonPublicCommandEnvelope | null = null;
                  try {
                    const row = realtimeNewRow(payload);
                    if (row && typeof row['ordinal'] === 'number') {
                      const env = envelopeFromRealtimeRow(row);
                      if (env && Number.isFinite(env.ordinal)) {
                        cacheEnvelope(env);
                        cachedEnv = env;
                      }
                    }
                  } catch {}
                  if (cachedEnv && lastSnap && !closed) {
                    const optimisticSnap: SeasonRoomPublicSnapshot = {
                      ...lastSnap,
                      revision: (lastSnap.revision ?? 0) + 1,
                    };
                    lastSnap = optimisticSnap;
                    handler(optimisticSnap);
                  }
                  const snap = await coalescedFetchSnap();
                  if (snap && !closed) handler(snap);
                })();
              },
            )
            .on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'season_private_decisions',
                filter: `room_id=eq.${roomId}`,
              },
              (payload: unknown) => {
                void (async () => {
                  try {
                    const row = realtimeNewRow(payload);
                    if (row) {
                      const optimistic = patchLocksFromDecision(row);
                      if (optimistic && !closed) handler(optimistic);
                    }
                  } catch {}
                  const snap = await coalescedFetchSnap();
                  if (snap && !closed) handler(snap);
                })();
              },
            )
            .on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'season_checkpoint_attestations',
                filter: `room_id=eq.${roomId}`,
              },
              (payload: unknown) => {
                void (async () => {
                  try {
                    const row = realtimeNewRow(payload);
                    if (row) {
                      const optimistic = patchAttestationFromRow(row);
                      if (optimistic && !closed) handler(optimistic);
                    }
                  } catch {}
                  const snap = await coalescedFetchSnap();
                  if (snap && !closed) handler(snap);
                })();
              },
            )
            .subscribe((status) => {
              if (status === 'SUBSCRIBED') {
                realtimeOk = true;
                if (pollTimer) {
                  clearInterval(pollTimer);
                  pollTimer = null;
                }
                restartBackgroundPoll();
              } else if (
                status === 'CHANNEL_ERROR' ||
                status === 'TIMED_OUT' ||
                status === 'CLOSED'
              ) {
                realtimeOk = false;
                stopBackgroundPoll();
                startPoll();
              }
            });
          startBackgroundPoll();
        } catch {
          startPoll();
          startBackgroundPoll();
        }
        setTimeout(() => {
          if (!closed && !realtimeOk) startPoll();
        }, 1000);
        void fetchSnap()
          .then((s) => {
            if (s && !closed) handler(s);
          })
          .catch(() => {});
      };
      void start();
      return {
        unsubscribe() {
          closed = true;
          if (channel) void client.removeChannel(channel);
          if (pollTimer) clearInterval(pollTimer);
          if (backgroundPollTimer) clearInterval(backgroundPollTimer);
        },
      };
    },
    async refetch(roomId: string, afterOrdinal: number): Promise<SeasonPublicCommandEnvelope[]> {
      const after = Number.isFinite(afterOrdinal) ? afterOrdinal : -1;
      const byOrd = envelopeCacheByRoom.get(roomId);
      if (byOrd && byOrd.size > 0) {
        const sorted = [...byOrd.values()]
          .filter((e) => e.ordinal > after)
          .sort((a, b) => a.ordinal - b.ordinal);
        if (sorted.length > 0 && sorted[0]!.ordinal === after + 1) {
          let contiguous = true;
          for (let i = 1; i < sorted.length; i += 1) {
            if (sorted[i]!.ordinal !== sorted[i - 1]!.ordinal + 1) {
              contiguous = false;
              break;
            }
          }
          if (contiguous) {
            return sorted;
          }
        }
      }
      const res = await callEdge(
        client,
        config,
        'season-room-refetch',
        { roomId, afterOrdinal: after },
        refetchResponseSchema,
      );
      const cmds = Array.isArray(res.commands) ? res.commands : [];
      if (cmds.length > 0) {
        let map = envelopeCacheByRoom.get(roomId);
        if (!map) {
          map = new Map();
          envelopeCacheByRoom.set(roomId, map);
        }
        for (const c of cmds) map.set(c.ordinal, c);
        if (map.size > 200) {
          const sortedKeys = [...map.keys()].sort((a, b) => a - b);
          for (let i = 0; i < sortedKeys.length - 200; i += 1) map.delete(sortedKeys[i]!);
        }
      }
      return cmds;
    },
    async submitCommand(envelope: SeasonPublicCommandEnvelope): Promise<SeasonCommandReceipt> {
      const res = await callEdge(
        client,
        config,
        'season-room-command',
        { envelope },
        receiptResponseSchema,
      );
      return res.receipt;
    },
    async submitPrivateDecision(submission: SeasonPrivateDecisionSubmission): Promise<{
      locked: boolean;
    }> {
      const res = await callEdge(
        client,
        config,
        'season-private-decision',
        {
          submission,
        },
        lockedResponseSchema,
      );
      return res;
    },
    async publishAttestation(
      attestation: SeasonCheckpointAttestation,
    ): Promise<SeasonAcceptedCheckpoint | SeasonRerunRequest | SeasonIntegrityFailure2> {
      const res = await callEdge(
        client,
        config,
        'season-checkpoint-attest',
        { attestation },
        attestResponseSchema,
      );
      switch (res.kind) {
        case 'accepted':
          return res.accepted;
        case 'rerun':
          return {
            roomId: attestation.roomId,
            cursor: attestation.cursor,
            reason: res.reason,
            attempt: res.attempt,
          };
        case 'integrity-failed':
          return res.failure;
      }
    },
    async requestReclaim(roomId: string, participantId: 'p1' | 'p2'): Promise<void> {
      await callEdge(
        client,
        config,
        'season-room-reclaim',
        {
          roomId,
          participantId,
        },
        okResponseSchema,
      );
    },
    async surrender(roomId: string, participantId: 'p1' | 'p2'): Promise<void> {
      await callEdge(
        client,
        config,
        'season-room-surrender',
        {
          roomId,
          participantId,
        },
        okResponseSchema,
      );
    },
    async preDraftRemoval(
      roomId: string,
      targetParticipantId: 'p1' | 'p2',
    ): Promise<SeasonRoomCode> {
      const res = await callEdge(
        client,
        config,
        'season-room-pre-draft-removal',
        { roomId, targetParticipantId },
        codeResponseSchema,
      );
      return res.code;
    },
    async close(roomId: string): Promise<void> {
      await callEdge(client, config, 'season-room-close', { roomId }, okResponseSchema);
    },
    async startDraft(roomId: string): Promise<SeasonRoomPublicSnapshot> {
      const res = await callEdge(
        client,
        config,
        'season-room-start-draft',
        { roomId },
        snapshotOnlySchema,
      );
      return res.snapshot;
    },
    async updateSettings(
      roomId: string,
      settings: {
        mode: SeasonRoomMode;
        pace: SeasonRoomPace;
      },
      expectedSettingsRevision?: number,
    ): Promise<SeasonRoomPublicSnapshot> {
      try {
        const res = await callEdge(
          client,
          config,
          'season-room-update-settings',
          {
            roomId,
            mode: settings.mode,
            pace: settings.pace,
            expectedSettingsRevision,
          },
          snapshotOnlySchema,
        );
        return res.snapshot;
      } catch (err) {
        const code = getErrorCode(err);
        if (code === 'outdated-room' || code === 'authorization' || code === 'stale-revision')
          throw err;
        throw err;
      }
    },
    async setReady(
      roomId: string,
      participantId: 'p1' | 'p2',
      ready: boolean,
      expectedSettingsRevision?: number,
    ): Promise<SeasonRoomPublicSnapshot> {
      const res = await callEdge(
        client,
        config,
        'season-room-set-ready',
        {
          roomId,
          participantId,
          ready,
          expectedSettingsRevision,
        },
        snapshotOnlySchema,
      );
      return res.snapshot;
    },
    async heartbeat(roomId: string, participantId: 'p1' | 'p2'): Promise<void> {
      if (heartbeatFnMissing) {
        await callEdge(
          client,
          config,
          'season-room-resume',
          { roomId },
          unknownPassthroughSchema,
        ).catch(() => {});
        return;
      }
      try {
        await callEdge(
          client,
          config,
          'season-room-heartbeat',
          {
            roomId,
            participantId,
          },
          okResponseSchema,
        );
      } catch (err) {
        let status: number | undefined;
        if (typeof err === 'object' && err !== null && 'status' in err) {
          const candidate: unknown = err.status;
          if (typeof candidate === 'number' && Number.isFinite(candidate)) status = candidate;
        }
        if (status && status !== 404) return;
        heartbeatFnMissing = true;
        await callEdge(
          client,
          config,
          'season-room-resume',
          { roomId },
          unknownPassthroughSchema,
        ).catch(() => {});
      }
    },
    async leave(roomId: string, participantId: 'p1' | 'p2'): Promise<void> {
      await callEdge(
        client,
        config,
        'season-room-leave',
        {
          roomId,
          participantId,
        },
        okResponseSchema,
      );
    },
  };
}
export function isSupabaseConfigured(): boolean {
  const env = import.meta.env;
  const url = env?.VITE_SUPABASE_URL;
  const key = env?.VITE_SUPABASE_PUBLISHABLE_KEY;
  const flag = env?.VITE_ENABLE_MULTIPLAYER;
  return Boolean(url && key && flag !== 'false');
}
export function multiplayerDisabledMessage(): string {
  return 'Multiplayer is not configured. Set VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_SUPABASE_CAPTCHA_SITE_KEY and VITE_ENABLE_MULTIPLAYER=true, or continue in solo mode.';
}
